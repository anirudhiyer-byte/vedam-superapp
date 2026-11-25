-- PeerPath admin Impact numbers · database tests (migration 0176, pp_admin_insights)
--
-- How to run (STAGING ONLY): paste this whole file into the staging SQL editor, or run it
-- through the Supabase MCP / psql. The last statement returns one row per test: test | pass | detail.
--
-- Nothing is left behind: everything runs inside a block that is rolled back at the end (ZDONE).
-- Test users use @example.invalid emails and never receive mail/SMS.
--
-- Staging is shared, so counts are checked as the CHANGE caused by this file's fixtures
-- (after − before, inside the same transaction). Medians are checked exactly when the range had
-- no "after" users before the fixtures (true on a quiet staging), otherwise only for not-null.
--
-- Logged-in calls are simulated the way PostgREST does it: SET ROLE authenticated +
-- request.jwt.claims {"sub": <uid>}. auth.uid() reads that claim.

-- ── helpers (session-temporary) ────────────────────────────────────────────────
create or replace function pg_temp.mk_user(p_email text, p_confirmed boolean default true)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  values (v, p_email, 'authenticated', 'authenticated', case when p_confirmed then now() end, '{}'::jsonb);
  insert into public.profiles (id, email) values (v, p_email)
  on conflict (id) do update set email = excluded.email;
  return v;
end $$;

create or replace function pg_temp.mk_admin(p_uid uuid)
returns void language sql as $$
  insert into public.user_roles (user_id, role) values (p_uid, 'admin');
$$;

-- application_manager.lead_id has a FK to lead_manager, so the lead row comes first
create or replace function pg_temp.mk_app(p_uid uuid, p_stage text default null, p_enroll_paid timestamptz default null)
returns void language plpgsql as $$
begin
  insert into public.lead_manager (lead_id) values (p_uid) on conflict (lead_id) do nothing;
  insert into public.application_manager (application_id, lead_id, registered_name, registered_email)
  values ('PPIMPACT-' || substr(md5(random()::text), 1, 10), p_uid, 'Impact Test', 'impact@example.invalid');
  if p_stage is not null then   -- enrollment_stage is NOT NULL with a default, so only set it when asked
    update public.application_manager set enrollment_stage = p_stage, enrollment_paid_at = p_enroll_paid where lead_id = p_uid;
  end if;
end $$;

create or replace function pg_temp.mk_paid(p_uid uuid, p_at timestamptz)
returns void language sql as $$
  insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider, amount)
  values (p_uid, p_at, 'PPIMPACT-' || p_uid::text, 'cashfree', 1000);
$$;

create or replace function pg_temp.mk_senior(p_campus text)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.pp_seniors (first_name, campus, year, contact_email, status, session_types, durations,
                                 daily_cap, weekly_cap, min_notice_hours)
  values ('PPImpact', p_campus, 2, 'ppimpact-' || substr(md5(random()::text), 1, 8) || '@example.invalid',
          'active', '{1:1}', '{30}', 10, 20, 12)
  returning id into v;
  return v;
end $$;

-- a 30-minute booking starting at p_start
create or replace function pg_temp.mk_chat(p_senior uuid, p_uid uuid, p_start timestamptz, p_status text)
returns timestamptz language plpgsql as $$
begin
  insert into public.pp_bookings (senior_id, start_at, end_at, type, applicant_name, applicant_email, status, applicant_user_id)
  values (p_senior, p_start, p_start + interval '30 minutes', '1:1', 'Impact Test', 'impact@example.invalid', p_status, p_uid);
  return p_start + interval '30 minutes';
end $$;

create or replace function pg_temp.mk_try(p_uid uuid, p_code text, p_senior uuid, p_at timestamptz, p_n int default 1)
returns void language sql as $$
  insert into public.pp_book_attempts (user_id, code, senior_id, created_at, source)
  select p_uid, p_code, p_senior, p_at, case when p_senior is null and p_uid is null then 'route' else 'db' end
  from generate_series(1, p_n);
$$;

-- run SQL as a logged-in user (or as anon); returns the result or {"sqlstate": …}
create or replace function pg_temp.call_as(p_uid uuid, p_sql text, p_anon boolean default false)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  if p_anon then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    set local role anon;
  else
    perform set_config('request.jwt.claims',
      case when p_uid is null then '{"role":"authenticated"}'
           else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
    set local role authenticated;
  end if;
  execute p_sql into r;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return coalesce(r, 'null'::jsonb);
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('sqlstate', sqlstate, 'message', sqlerrm);
end $$;

create or replace function pg_temp.ins(p_uid uuid, p_body text)
returns jsonb language sql as $$
  select pg_temp.call_as(p_uid, format('select public.pp_admin_insights(%L::jsonb)', p_body));
$$;

-- number at path, 0 when missing
create or replace function pg_temp.n(j jsonb, variadic p text[])
returns numeric language sql immutable as $$ select coalesce((j #>> p)::numeric, 0) $$;

-- ── the tests ──────────────────────────────────────────────────────────────────
create or replace function pg_temp.run_peerpath_admin_insights_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; usr uuid; fake_staff uuid; senP uuid; senG uuid;
  u1 uuid; u2 uuid; u3 uuid; u4 uuid; u5 uuid; ux uuid;
  e1 timestamptz; e2 timestamptz; e3 timestamptz; e4 timestamptz; e5 timestamptz;
  b_all jsonb; b_pune jsonb; b_gur jsonb; a_all jsonb; a_pune jsonb; a_gur jsonb;
  r jsonb; body text; n0 bigint; n1 bigint; ok boolean;
  c_now constant timestamptz := now();
begin
  begin -- everything below is rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('impact-admin@example.invalid');
    perform pg_temp.mk_admin(adm);
    usr := pg_temp.mk_user('impact-user@example.invalid');
    fake_staff := pg_temp.mk_user('impact-unconfirmed@vedam.org', false); -- vedam.org but email NOT verified

    -- ════ access ════
    r := pg_temp.ins(usr, '{}');
    t_name := t_name || text 'A signed-in non-admin -> FORBIDDEN (42501)'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'sqlstate' = '42501' and r->>'message' = 'FORBIDDEN');

    r := pg_temp.ins(fake_staff, '{}');
    t_name := t_name || text 'A @vedam.org with unverified email -> FORBIDDEN'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'sqlstate' = '42501');

    r := pg_temp.ins(null, '{}');
    t_name := t_name || text 'A authenticated role without a user -> FORBIDDEN'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'sqlstate' = '42501');

    r := pg_temp.call_as(null, 'select public.pp_admin_insights(''{}''::jsonb)', true);
    t_name := t_name || text 'A anon -> permission denied (no execute)'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'sqlstate' = '42501' and r->>'message' <> 'FORBIDDEN');

    ok := not has_function_privilege('anon', 'public.pp_admin_insights(jsonb)', 'execute')
          and has_function_privilege('authenticated', 'public.pp_admin_insights(jsonb)', 'execute')
          and not exists (select 1 from information_schema.routine_privileges
                          where routine_schema = 'public' and routine_name = 'pp_admin_insights' and grantee = 'PUBLIC');
    t_name := t_name || text 'A grants: anon no, PUBLIC no, authenticated yes'; t_det := t_det || ok::text;
    t_pass := t_pass || ok;

    select p.prosecdef and p.provolatile = 's' and coalesce(array_to_string(p.proconfig, ','), '') = 'search_path=""'
      into ok from pg_proc p where p.oid = 'public.pp_admin_insights(jsonb)'::regprocedure;
    t_name := t_name || text 'A security definer, stable, search_path empty'; t_det := t_det || ok::text;
    t_pass := t_pass || ok;

    -- ════ input whitelist ════
    foreach body in array array['{"days":30}', '{"campus":"pune"}', '{"campus":"PUNE"}', '{"campus":"Both"}',
                                '{"campus":5}', '{"campus":["Pune"]}', '{"campus":"Pune'' or ''1''=''1"}',
                                '{"campus":"Pune","x":1}', '[]', '"Pune"', '5', 'null'] loop
      r := pg_temp.ins(adm, body);
      t_name := t_name || ('I ' || body || ' -> BAD_VALUE (22023)'); t_det := t_det || r::text;
      t_pass := t_pass || (r->>'sqlstate' = '22023' and r->>'message' = 'BAD_VALUE');
    end loop;

    r := pg_temp.call_as(adm, 'select public.pp_admin_insights(null)');
    t_name := t_name || text 'I SQL NULL (no argument) -> ok, 3 ranges'; t_det := t_det || left(r::text, 200);
    t_pass := t_pass || (r #> '{ranges}' ?& array['7', '30', '90']);

    foreach body in array array['{}', '{"campus":null}', '{"campus":"Pune"}', '{"campus":"Gurugram"}'] loop
      r := pg_temp.ins(adm, body);
      t_name := t_name || ('I ' || body || ' -> ok, 3 ranges'); t_det := t_det || left(r::text, 200);
      t_pass := t_pass || (r ? 'mode' and r #> '{ranges}' ?& array['7', '30', '90'] and not (r ? 'sqlstate'));
    end loop;

    -- ════ baseline (staging is shared; compare the change) ════
    b_all  := pg_temp.ins(adm, '{}');
    b_pune := pg_temp.ins(adm, '{"campus":"Pune"}');
    b_gur  := pg_temp.ins(adm, '{"campus":"Gurugram"}');

    -- ════ fixtures ════
    senP := pg_temp.mk_senior('Pune');
    senG := pg_temp.mk_senior('Gurugram');
    u1 := pg_temp.mk_user('impact-u1@example.invalid');
    u2 := pg_temp.mk_user('impact-u2@example.invalid');
    u3 := pg_temp.mk_user('impact-u3@example.invalid');
    u4 := pg_temp.mk_user('impact-u4@example.invalid');
    u5 := pg_temp.mk_user('impact-u5@example.invalid');

    -- u1 Pune: chat 10 days ago, paid 20 days ago (BEFORE), not enrolled
    e1 := pg_temp.mk_chat(senP, u1, c_now - interval '10 days', 'completed');
    perform pg_temp.mk_paid(u1, c_now - interval '20 days');
    -- u2 Pune: confirmed chat that is over (5 days ago), paid 3 days AFTER, enrolled 4 days after
    e2 := pg_temp.mk_chat(senP, u2, c_now - interval '5 days', 'confirmed');
    perform pg_temp.mk_paid(u2, e2 + interval '3 days');
    perform pg_temp.mk_app(u2, 'approved', e2 + interval '4 days');
    -- u3 Pune: chat 20 days ago, never paid, enrolled BEFORE the chat
    e3 := pg_temp.mk_chat(senP, u3, c_now - interval '20 days', 'completed');
    perform pg_temp.mk_app(u3, 'approved', e3 - interval '1 day');
    -- u4 Pune: two chats (25 and 2 days ago), paid 10 days ago: AFTER the first chat in 30/90, BEFORE in 7
    e4 := pg_temp.mk_chat(senP, u4, c_now - interval '25 days', 'completed');
    perform pg_temp.mk_chat(senP, u4, c_now - interval '2 days', 'completed');
    perform pg_temp.mk_paid(u4, c_now - interval '10 days');
    perform pg_temp.mk_app(u4);
    -- u5 Gurugram: chat 3 days ago, paid 1 day AFTER
    e5 := pg_temp.mk_chat(senG, u5, c_now - interval '3 days', 'completed');
    perform pg_temp.mk_paid(u5, e5 + interval '1 day');

    -- NOT chats (each user has paid, so a wrong rule would show up in the counts)
    ux := pg_temp.mk_user('impact-x1@example.invalid'); perform pg_temp.mk_chat(senP, ux, c_now - interval '4 days', 'cancelled');         perform pg_temp.mk_paid(ux, c_now);
    ux := pg_temp.mk_user('impact-x2@example.invalid'); perform pg_temp.mk_chat(senP, ux, c_now - interval '4 days' + interval '1 hour', 'rescheduled'); perform pg_temp.mk_paid(ux, c_now);
    ux := pg_temp.mk_user('impact-x3@example.invalid'); perform pg_temp.mk_chat(senP, ux, c_now - interval '4 days' + interval '2 hours', 'no_show_applicant'); perform pg_temp.mk_paid(ux, c_now);
    ux := pg_temp.mk_user('impact-x4@example.invalid'); perform pg_temp.mk_chat(senP, ux, c_now + interval '2 days', 'confirmed');         perform pg_temp.mk_paid(ux, c_now);
    ux := pg_temp.mk_user('impact-x5@example.invalid'); perform pg_temp.mk_chat(senP, ux, c_now - interval '10 minutes', 'confirmed');    perform pg_temp.mk_paid(ux, c_now); -- still running
    ux := pg_temp.mk_user('impact-x6@example.invalid'); perform pg_temp.mk_chat(senP, ux, c_now - interval '100 days', 'completed');      perform pg_temp.mk_paid(ux, c_now); -- older than 90 days
    perform pg_temp.mk_chat(senP, null, c_now - interval '4 days' + interval '3 hours', 'completed');                                       -- pre-login booking (no user)

    -- attempts (30-day window: 9 in All, 7 in Pune, 1 in Gurugram)
    perform pg_temp.mk_try(u1, 'OK', senP, c_now - interval '1 day', 2);                  -- booked + repeat
    perform pg_temp.mk_try(u2, 'SLOT_UNAVAILABLE', senP, c_now - interval '2 days', 3);   -- one person, 3 tries
    perform pg_temp.mk_try(null, 'NOT_LOGGED_IN', senP, c_now - interval '3 days', 2);    -- signed-out: each try = one person
    perform pg_temp.mk_try(null, 'RATE_LIMITED', null, c_now - interval '1 day', 1);      -- per-IP block, no senior → All only
    perform pg_temp.mk_try(u5, 'PAYMENT_PENDING', senG, c_now - interval '12 days', 1);   -- 30/90 only
    perform pg_temp.mk_try(u3, 'OK', senP, c_now - interval '40 days', 1);                -- 90 only

    select count(*) into n0 from public.pp_book_attempts;
    a_all  := pg_temp.ins(adm, '{}');
    a_pune := pg_temp.ins(adm, '{"campus":"Pune"}');
    a_gur  := pg_temp.ins(adm, '{"campus":"Gurugram"}');
    select count(*) into n1 from public.pp_book_attempts;

    t_name := t_name || text 'R calling it writes nothing (attempt log unchanged)'; t_det := t_det || (n0 || ' -> ' || n1);
    t_pass := t_pass || (n0 = n1);

    -- ════ demand ════
    t_name := t_name || text 'D All 30d: +9 attempts, +6 people, +2 booked, +1 person booked';
    t_det := t_det || (a_all #> '{ranges,30,demand}')::text;
    t_pass := t_pass || (pg_temp.n(a_all, 'ranges','30','demand','attempts') - pg_temp.n(b_all, 'ranges','30','demand','attempts') = 9
                     and pg_temp.n(a_all, 'ranges','30','demand','people') - pg_temp.n(b_all, 'ranges','30','demand','people') = 6
                     and pg_temp.n(a_all, 'ranges','30','demand','booked') - pg_temp.n(b_all, 'ranges','30','demand','booked') = 2
                     and pg_temp.n(a_all, 'ranges','30','demand','people_booked') - pg_temp.n(b_all, 'ranges','30','demand','people_booked') = 1);

    t_name := t_name || text 'D All 30d blocked by code: SLOT 3 tries/1 person, NOT_LOGGED_IN 2/2, RATE_LIMITED 1/1, PAYMENT_PENDING 1/1, OK not listed';
    t_det := t_det || (a_all #> '{ranges,30,demand,blocked}')::text;
    t_pass := t_pass || (pg_temp.n(a_all, 'ranges','30','demand','blocked','SLOT_UNAVAILABLE','attempts') - pg_temp.n(b_all, 'ranges','30','demand','blocked','SLOT_UNAVAILABLE','attempts') = 3
                     and pg_temp.n(a_all, 'ranges','30','demand','blocked','SLOT_UNAVAILABLE','people') - pg_temp.n(b_all, 'ranges','30','demand','blocked','SLOT_UNAVAILABLE','people') = 1
                     and pg_temp.n(a_all, 'ranges','30','demand','blocked','NOT_LOGGED_IN','people') - pg_temp.n(b_all, 'ranges','30','demand','blocked','NOT_LOGGED_IN','people') = 2
                     and pg_temp.n(a_all, 'ranges','30','demand','blocked','RATE_LIMITED','people') - pg_temp.n(b_all, 'ranges','30','demand','blocked','RATE_LIMITED','people') = 1
                     and pg_temp.n(a_all, 'ranges','30','demand','blocked','PAYMENT_PENDING','people') - pg_temp.n(b_all, 'ranges','30','demand','blocked','PAYMENT_PENDING','people') = 1
                     and not (a_all #> '{ranges,30,demand,blocked}' ? 'OK'));

    t_name := t_name || text 'D ranges: 7d +8 attempts (no 12-day try), 90d +10 (40-day OK counted)';
    t_det := t_det || ((a_all #>> '{ranges,7,demand,attempts}') || ' / ' || (a_all #>> '{ranges,90,demand,attempts}'));
    t_pass := t_pass || (pg_temp.n(a_all, 'ranges','7','demand','attempts') - pg_temp.n(b_all, 'ranges','7','demand','attempts') = 8
                     and pg_temp.n(a_all, 'ranges','90','demand','attempts') - pg_temp.n(b_all, 'ranges','90','demand','attempts') = 10
                     and pg_temp.n(a_all, 'ranges','90','demand','booked') - pg_temp.n(b_all, 'ranges','90','demand','booked') = 3);

    t_name := t_name || text 'D campus: Pune 30d +7 (no senior-less try, no Gurugram try), Gurugram 30d +1';
    t_det := t_det || ((a_pune #>> '{ranges,30,demand,attempts}') || ' / ' || (a_gur #>> '{ranges,30,demand,attempts}'));
    t_pass := t_pass || (pg_temp.n(a_pune, 'ranges','30','demand','attempts') - pg_temp.n(b_pune, 'ranges','30','demand','attempts') = 7
                     and pg_temp.n(a_gur, 'ranges','30','demand','attempts') - pg_temp.n(b_gur, 'ranges','30','demand','attempts') = 1
                     and pg_temp.n(a_pune, 'ranges','30','demand','blocked','RATE_LIMITED','attempts') - pg_temp.n(b_pune, 'ranges','30','demand','blocked','RATE_LIMITED','attempts') = 0);

    -- ════ outcome ════
    t_name := t_name || text 'O All 30d: +5 applicants, +1 paid before, +3 paid after, +1 not paid, +2 enrolled, +1 enrolled after';
    t_det := t_det || (a_all #> '{ranges,30,outcome}')::text;
    t_pass := t_pass || (pg_temp.n(a_all, 'ranges','30','outcome','applicants') - pg_temp.n(b_all, 'ranges','30','outcome','applicants') = 5
                     and pg_temp.n(a_all, 'ranges','30','outcome','paid_before') - pg_temp.n(b_all, 'ranges','30','outcome','paid_before') = 1
                     and pg_temp.n(a_all, 'ranges','30','outcome','paid_after') - pg_temp.n(b_all, 'ranges','30','outcome','paid_after') = 3
                     and pg_temp.n(a_all, 'ranges','30','outcome','not_paid') - pg_temp.n(b_all, 'ranges','30','outcome','not_paid') = 1
                     and pg_temp.n(a_all, 'ranges','30','outcome','enrolled') - pg_temp.n(b_all, 'ranges','30','outcome','enrolled') = 2
                     and pg_temp.n(a_all, 'ranges','30','outcome','enrolled_after') - pg_temp.n(b_all, 'ranges','30','outcome','enrolled_after') = 1);

    t_name := t_name || text 'O cancelled, moved, no-show, future, running, >90 days and pre-login bookings are not chats (90d also +5)';
    t_det := t_det || (a_all #> '{ranges,90,outcome}')::text;
    t_pass := t_pass || (pg_temp.n(a_all, 'ranges','90','outcome','applicants') - pg_temp.n(b_all, 'ranges','90','outcome','applicants') = 5);

    t_name := t_name || text 'O 7d uses the first chat IN the range: u4 paid before its 2-day-old chat -> +3 applicants, +1 before, +2 after';
    t_det := t_det || (a_all #> '{ranges,7,outcome}')::text;
    t_pass := t_pass || (pg_temp.n(a_all, 'ranges','7','outcome','applicants') - pg_temp.n(b_all, 'ranges','7','outcome','applicants') = 3
                     and pg_temp.n(a_all, 'ranges','7','outcome','paid_before') - pg_temp.n(b_all, 'ranges','7','outcome','paid_before') = 1
                     and pg_temp.n(a_all, 'ranges','7','outcome','paid_after') - pg_temp.n(b_all, 'ranges','7','outcome','paid_after') = 2);

    t_name := t_name || text 'O campus: Pune 30d +4 applicants / +2 after, Gurugram 30d +1 / +1 after';
    t_det := t_det || ((a_pune #> '{ranges,30,outcome}')::text || ' | ' || (a_gur #> '{ranges,30,outcome}')::text);
    t_pass := t_pass || (pg_temp.n(a_pune, 'ranges','30','outcome','applicants') - pg_temp.n(b_pune, 'ranges','30','outcome','applicants') = 4
                     and pg_temp.n(a_pune, 'ranges','30','outcome','paid_after') - pg_temp.n(b_pune, 'ranges','30','outcome','paid_after') = 2
                     and pg_temp.n(a_gur, 'ranges','30','outcome','applicants') - pg_temp.n(b_gur, 'ranges','30','outcome','applicants') = 1
                     and pg_temp.n(a_gur, 'ranges','30','outcome','paid_after') - pg_temp.n(b_gur, 'ranges','30','outcome','paid_after') = 1);

    -- medians: exact when the range had no "after" users before the fixtures
    t_name := t_name || text 'O medians All 30d: days to pay 3.0 (of 1, 3, ~15), days to enroll 4.0';
    t_det := t_det || ((a_all #>> '{ranges,30,outcome,median_days_to_pay}') || ' / ' || (a_all #>> '{ranges,30,outcome,median_days_to_enroll}')
                       || ' baseline after=' || pg_temp.n(b_all, 'ranges','30','outcome','paid_after'));
    t_pass := t_pass || case when pg_temp.n(b_all, 'ranges','30','outcome','paid_after') = 0 and pg_temp.n(b_all, 'ranges','30','outcome','enrolled_after') = 0
                             then (a_all #>> '{ranges,30,outcome,median_days_to_pay}')::numeric = 3.0
                                  and (a_all #>> '{ranges,30,outcome,median_days_to_enroll}')::numeric = 4.0
                             else (a_all #> '{ranges,30,outcome,median_days_to_pay}') <> 'null'::jsonb end;

    t_name := t_name || text 'O medians 7d: days to pay 2.0 (of 1, 3); Pune 30d 9.0 (of 3, ~15); Gurugram 30d 1.0';
    t_det := t_det || ((a_all #>> '{ranges,7,outcome,median_days_to_pay}') || ' / ' || (a_pune #>> '{ranges,30,outcome,median_days_to_pay}')
                       || ' / ' || (a_gur #>> '{ranges,30,outcome,median_days_to_pay}'));
    t_pass := t_pass || case when pg_temp.n(b_all, 'ranges','7','outcome','paid_after') = 0 and pg_temp.n(b_pune, 'ranges','30','outcome','paid_after') = 0
                                  and pg_temp.n(b_gur, 'ranges','30','outcome','paid_after') = 0
                             then (a_all #>> '{ranges,7,outcome,median_days_to_pay}')::numeric = 2.0
                                  and (a_pune #>> '{ranges,30,outcome,median_days_to_pay}')::numeric = 9.0
                                  and (a_gur #>> '{ranges,30,outcome,median_days_to_pay}')::numeric = 1.0
                             else (a_all #> '{ranges,7,outcome,median_days_to_pay}') <> 'null'::jsonb end;

    -- ════ privacy: counts only ════
    t_name := t_name || text 'P output has no ids, emails or names (no uuid, no @, no fixture name)';
    t_det := t_det || length(a_all::text || a_pune::text || a_gur::text)::text;
    t_pass := t_pass || ((a_all::text || a_pune::text || a_gur::text) !~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
                     and position('@' in a_all::text || a_pune::text || a_gur::text) = 0
                     and position('Impact' in a_all::text || a_pune::text || a_gur::text) = 0
                     and position('PPImpact' in a_all::text) = 0);

    t_name := t_name || text 'P mode is the eligibility flag';
    t_det := t_det || coalesce(a_all->>'mode', 'null');
    t_pass := t_pass || (a_all->>'mode' = coalesce((select value from public.app_flags where key = 'peerpath_eligibility'), 'off'));

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select * from pg_temp.run_peerpath_admin_insights_tests();
