-- PeerPath admin Impact trends · database tests (migration 0185, pp_admin_impact_trend)
--
-- How to run (STAGING ONLY): paste this whole file into the staging SQL editor, or run it
-- through the Supabase MCP / psql. The last statement returns one row per test: test | pass | detail.
--
-- Nothing is left behind: everything runs inside a block that is rolled back at the end (ZDONE).
-- Test users use @example.invalid emails and never receive mail/SMS.
--
-- Staging is shared, so counts are checked as the CHANGE caused by this file's fixtures
-- (after − before, inside the same transaction). The "tie-out" tests need no baseline: whatever
-- is in the database, the trend numbers must add up to pp_admin_insights (0176).
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

create or replace function pg_temp.mk_paid(p_uid uuid, p_at timestamptz)
returns void language sql as $$
  insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider, amount)
  values (p_uid, p_at, 'PPTREND-' || p_uid::text, 'cashfree', 1000);
$$;

create or replace function pg_temp.mk_senior(p_campus text)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.pp_seniors (first_name, campus, year, contact_email, status, session_types, durations,
                                 daily_cap, weekly_cap, min_notice_hours)
  values ('PPTrend', p_campus, 2, 'pptrend-' || substr(md5(random()::text), 1, 8) || '@example.invalid',
          'active', '{1:1}', '{30}', 10, 20, 12)
  returning id into v;
  return v;
end $$;

-- a 30-minute booking starting at p_start; returns its end
create or replace function pg_temp.mk_chat(p_senior uuid, p_uid uuid, p_start timestamptz, p_status text)
returns timestamptz language plpgsql as $$
begin
  insert into public.pp_bookings (senior_id, start_at, end_at, type, applicant_name, applicant_email, status, applicant_user_id)
  values (p_senior, p_start, p_start + interval '30 minutes', '1:1', 'Trend Test', 'trend@example.invalid', p_status, p_uid);
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

create or replace function pg_temp.tr(p_uid uuid, p_body text)
returns jsonb language sql as $$
  select pg_temp.call_as(p_uid, format('select public.pp_admin_impact_trend(%L::jsonb)', p_body));
$$;

create or replace function pg_temp.ins(p_uid uuid, p_body text)
returns jsonb language sql as $$
  select pg_temp.call_as(p_uid, format('select public.pp_admin_insights(%L::jsonb)', p_body));
$$;

-- number at path, 0 when missing
create or replace function pg_temp.n(j jsonb, variadic p text[])
returns numeric language sql immutable as $$ select coalesce((j #>> p)::numeric, 0) $$;

-- sum of one key over all days
create or replace function pg_temp.ds(j jsonb, k text)
returns numeric language sql immutable as $$
  select coalesce(sum((e ->> k)::numeric), 0) from jsonb_array_elements(j -> 'days') e
$$;

-- value of one key on the IST day of ts (0 when that day is not in the list)
create or replace function pg_temp.dv(j jsonb, ts timestamptz, k text)
returns numeric language sql stable as $$
  select coalesce((select (e ->> k)::numeric from jsonb_array_elements(j -> 'days') e
                   where e ->> 'd' = to_char(ts at time zone 'Asia/Kolkata', 'YYYY-MM-DD') limit 1), 0)
$$;

-- one bin (0-based) of the days-to-pay histogram of a range
create or replace function pg_temp.pb(j jsonb, r text, i int)
returns numeric language sql immutable as $$ select coalesce((j #>> array['pay_bins', r, i::text])::numeric, 0) $$;

-- sum of all six bins of a range
create or replace function pg_temp.pbs(j jsonb, r text)
returns numeric language sql immutable as $$
  select coalesce(sum(x::numeric), 0) from jsonb_array_elements_text(j #> array['pay_bins', r]) x
$$;

-- ── the tests ──────────────────────────────────────────────────────────────────
create or replace function pg_temp.run_peerpath_admin_impact_trend_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; usr uuid; fake_staff uuid; senP uuid; senG uuid;
  u1 uuid; u2 uuid; u3 uuid; u4 uuid; u5 uuid; ux uuid;
  e1 timestamptz; e2 timestamptz; e3 timestamptz; e4 timestamptz; e5 timestamptz;
  ends timestamptz[]; paid_flags boolean[] := array[false, true, false, true, true];
  b_all jsonb; b_pune jsonb; b_gur jsonb; a_all jsonb; a_pune jsonb; a_gur jsonb;
  i_all jsonb; i_pune jsonb; i_gur jsonb;
  r jsonb; body text; n0 bigint; n1 bigint; ok boolean; k int; rg text; sc text;
  c_now constant timestamptz := now();
begin
  begin -- everything below is rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('trend-admin@example.invalid');
    perform pg_temp.mk_admin(adm);
    usr := pg_temp.mk_user('trend-user@example.invalid');
    fake_staff := pg_temp.mk_user('trend-unconfirmed@vedam.org', false); -- vedam.org but email NOT verified

    -- ════ access ════
    r := pg_temp.tr(usr, '{}');
    t_name := t_name || text 'A signed-in non-admin -> FORBIDDEN (42501)'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'sqlstate' = '42501' and r->>'message' = 'FORBIDDEN');

    r := pg_temp.tr(fake_staff, '{}');
    t_name := t_name || text 'A @vedam.org with unverified email -> FORBIDDEN'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'sqlstate' = '42501');

    r := pg_temp.tr(null, '{}');
    t_name := t_name || text 'A authenticated role without a user -> FORBIDDEN'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'sqlstate' = '42501');

    r := pg_temp.call_as(null, 'select public.pp_admin_impact_trend(''{}''::jsonb)', true);
    t_name := t_name || text 'A anon -> permission denied (no execute)'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'sqlstate' = '42501' and r->>'message' <> 'FORBIDDEN');

    ok := not has_function_privilege('anon', 'public.pp_admin_impact_trend(jsonb)', 'execute')
          and has_function_privilege('authenticated', 'public.pp_admin_impact_trend(jsonb)', 'execute')
          and not exists (select 1 from information_schema.routine_privileges
                          where routine_schema = 'public' and routine_name = 'pp_admin_impact_trend' and grantee = 'PUBLIC');
    t_name := t_name || text 'A grants: anon no, PUBLIC no, authenticated yes'; t_det := t_det || ok::text;
    t_pass := t_pass || ok;

    select p.prosecdef and p.provolatile = 's' and coalesce(array_to_string(p.proconfig, ','), '') = 'search_path=""'
      into ok from pg_proc p where p.oid = 'public.pp_admin_impact_trend(jsonb)'::regprocedure;
    t_name := t_name || text 'A security definer, stable, search_path empty'; t_det := t_det || ok::text;
    t_pass := t_pass || ok;

    -- ════ input whitelist ════
    foreach body in array array['{"days":30}', '{"campus":"pune"}', '{"campus":"PUNE"}', '{"campus":"Both"}',
                                '{"campus":5}', '{"campus":["Pune"]}', '{"campus":"Pune'' or ''1''=''1"}',
                                '{"campus":"Pune","x":1}', '[]', '"Pune"', '5', 'null'] loop
      r := pg_temp.tr(adm, body);
      t_name := t_name || ('I ' || body || ' -> BAD_VALUE (22023)'); t_det := t_det || r::text;
      t_pass := t_pass || (r->>'sqlstate' = '22023' and r->>'message' = 'BAD_VALUE');
    end loop;

    r := pg_temp.call_as(adm, 'select public.pp_admin_impact_trend(null)');
    t_name := t_name || text 'I SQL NULL (no argument) -> ok, has days and pay_bins'; t_det := t_det || left(r::text, 200);
    t_pass := t_pass || (r ? 'days' and r ? 'pay_bins' and not (r ? 'sqlstate'));

    foreach body in array array['{}', '{"campus":null}', '{"campus":"Pune"}', '{"campus":"Gurugram"}'] loop
      r := pg_temp.tr(adm, body);
      t_name := t_name || ('I ' || body || ' -> ok, has days and pay_bins'); t_det := t_det || left(r::text, 200);
      t_pass := t_pass || (r ? 'mode' and r ? 'days' and r #> '{pay_bins}' ?& array['7', '30', '90'] and not (r ? 'sqlstate'));
    end loop;

    -- ════ shape ════
    r := pg_temp.tr(adm, '{}');
    select count(*) = (max((e->>'d')::date) - min((e->>'d')::date)) + 1
           and count(*) between 90 and 91
           and max((e->>'d')::date) = (c_now at time zone 'Asia/Kolkata')::date
           and bool_and(e ?& array['d', 'tries', 'booked', 'chats', 'paid_after'])
      into ok from jsonb_array_elements(r -> 'days') e;
    t_name := t_name || text 'S days: 90-91 rows, one per IST day with no gaps, newest = today, all five keys';
    t_det := t_det || (jsonb_array_length(r -> 'days') || ' rows');
    t_pass := t_pass || coalesce(ok, false);

    select bool_and(jsonb_typeof(r #> array['pay_bins', x]) = 'array' and jsonb_array_length(r #> array['pay_bins', x]) = 6)
      into ok from unnest(array['7', '30', '90']) x;
    t_name := t_name || text 'S pay_bins: 6 numbers for each of 7, 30 and 90 days'; t_det := t_det || (r -> 'pay_bins')::text;
    t_pass := t_pass || coalesce(ok, false);

    -- ════ baseline (staging is shared; compare the change) ════
    b_all  := pg_temp.tr(adm, '{}');
    b_pune := pg_temp.tr(adm, '{"campus":"Pune"}');
    b_gur  := pg_temp.tr(adm, '{"campus":"Gurugram"}');

    -- ════ fixtures ════
    senP := pg_temp.mk_senior('Pune');
    senG := pg_temp.mk_senior('Gurugram');
    u1 := pg_temp.mk_user('trend-u1@example.invalid');
    u2 := pg_temp.mk_user('trend-u2@example.invalid');
    u3 := pg_temp.mk_user('trend-u3@example.invalid');
    u4 := pg_temp.mk_user('trend-u4@example.invalid');
    u5 := pg_temp.mk_user('trend-u5@example.invalid');

    -- u1 Pune: chat 10 days ago, paid 20 days ago (BEFORE)
    e1 := pg_temp.mk_chat(senP, u1, c_now - interval '10 days', 'completed');
    perform pg_temp.mk_paid(u1, c_now - interval '20 days');
    -- u2 Pune: confirmed chat that is over (5 days ago), paid exactly 3 days AFTER   -> bin 3-7 (index 2)
    e2 := pg_temp.mk_chat(senP, u2, c_now - interval '5 days', 'confirmed');
    perform pg_temp.mk_paid(u2, e2 + interval '3 days');
    -- u3 Pune: chat 20 days ago, never paid
    e3 := pg_temp.mk_chat(senP, u3, c_now - interval '20 days', 'completed');
    -- u4 Pune: two chats (25 and 2 days ago), paid 10 days ago: AFTER the first chat (30/90 days, ~15 days -> bin 14-30, index 4), BEFORE in 7
    e4 := pg_temp.mk_chat(senP, u4, c_now - interval '25 days', 'completed');
    perform pg_temp.mk_chat(senP, u4, c_now - interval '2 days', 'completed');
    perform pg_temp.mk_paid(u4, c_now - interval '10 days');
    -- u5 Gurugram: chat 3 days ago, paid exactly 1 day AFTER                         -> bin 1-3 (index 1)
    e5 := pg_temp.mk_chat(senG, u5, c_now - interval '3 days', 'completed');
    perform pg_temp.mk_paid(u5, e5 + interval '1 day');
    ends := array[e1, e2, e3, e4, e5];

    -- NOT chats (each user has paid, so a wrong rule would show up in the counts)
    ux := pg_temp.mk_user('trend-x1@example.invalid'); perform pg_temp.mk_chat(senP, ux, c_now - interval '4 days', 'cancelled');         perform pg_temp.mk_paid(ux, c_now);
    ux := pg_temp.mk_user('trend-x2@example.invalid'); perform pg_temp.mk_chat(senP, ux, c_now - interval '4 days' + interval '1 hour', 'rescheduled'); perform pg_temp.mk_paid(ux, c_now);
    ux := pg_temp.mk_user('trend-x3@example.invalid'); perform pg_temp.mk_chat(senP, ux, c_now - interval '4 days' + interval '2 hours', 'no_show_applicant'); perform pg_temp.mk_paid(ux, c_now);
    ux := pg_temp.mk_user('trend-x4@example.invalid'); perform pg_temp.mk_chat(senP, ux, c_now + interval '2 days', 'confirmed');         perform pg_temp.mk_paid(ux, c_now);
    ux := pg_temp.mk_user('trend-x5@example.invalid'); perform pg_temp.mk_chat(senP, ux, c_now - interval '10 minutes', 'confirmed');    perform pg_temp.mk_paid(ux, c_now); -- still running
    ux := pg_temp.mk_user('trend-x6@example.invalid'); perform pg_temp.mk_chat(senP, ux, c_now - interval '100 days', 'completed');      perform pg_temp.mk_paid(ux, c_now); -- older than 90 days
    perform pg_temp.mk_chat(senP, null, c_now - interval '4 days' + interval '3 hours', 'completed');                                       -- pre-login booking (no user)

    -- attempts (90 days: 10 in All, 8 in Pune, 1 in Gurugram) + one 91 days old that must not count
    perform pg_temp.mk_try(u1, 'OK', senP, c_now - interval '1 day', 2);                  -- booked + repeat
    perform pg_temp.mk_try(u2, 'SLOT_UNAVAILABLE', senP, c_now - interval '2 days', 3);   -- one person, 3 tries
    perform pg_temp.mk_try(null, 'NOT_LOGGED_IN', senP, c_now - interval '3 days', 2);    -- signed-out
    perform pg_temp.mk_try(null, 'RATE_LIMITED', null, c_now - interval '1 day', 1);      -- per-IP block, no senior -> All only
    perform pg_temp.mk_try(u5, 'PAYMENT_PENDING', senG, c_now - interval '12 days', 1);
    perform pg_temp.mk_try(u3, 'OK', senP, c_now - interval '40 days', 1);
    perform pg_temp.mk_try(u1, 'OK', senP, c_now - interval '91 days', 1);                -- outside the window

    select count(*) into n0 from public.pp_book_attempts;
    a_all  := pg_temp.tr(adm, '{}');
    a_pune := pg_temp.tr(adm, '{"campus":"Pune"}');
    a_gur  := pg_temp.tr(adm, '{"campus":"Gurugram"}');
    select count(*) into n1 from public.pp_book_attempts;

    t_name := t_name || text 'R calling it writes nothing (attempt log unchanged)'; t_det := t_det || (n0 || ' -> ' || n1);
    t_pass := t_pass || (n0 = n1);

    -- ════ totals over the 90 days ════
    t_name := t_name || text 'T All: +10 tries (the 91-day-old one is left out), +3 booked, +5 first chats, +3 paid after';
    t_det := t_det || (pg_temp.ds(a_all, 'tries') - pg_temp.ds(b_all, 'tries') || '/' || pg_temp.ds(a_all, 'booked') - pg_temp.ds(b_all, 'booked') || '/'
                       || pg_temp.ds(a_all, 'chats') - pg_temp.ds(b_all, 'chats') || '/' || pg_temp.ds(a_all, 'paid_after') - pg_temp.ds(b_all, 'paid_after'));
    t_pass := t_pass || (pg_temp.ds(a_all, 'tries') - pg_temp.ds(b_all, 'tries') = 10
                     and pg_temp.ds(a_all, 'booked') - pg_temp.ds(b_all, 'booked') = 3
                     and pg_temp.ds(a_all, 'chats') - pg_temp.ds(b_all, 'chats') = 5
                     and pg_temp.ds(a_all, 'paid_after') - pg_temp.ds(b_all, 'paid_after') = 3);

    t_name := t_name || text 'T Pune: +8 tries (no senior-less try), +3 booked, +4 chats, +2 paid after';
    t_det := t_det || (pg_temp.ds(a_pune, 'tries') - pg_temp.ds(b_pune, 'tries') || '/' || pg_temp.ds(a_pune, 'chats') - pg_temp.ds(b_pune, 'chats'));
    t_pass := t_pass || (pg_temp.ds(a_pune, 'tries') - pg_temp.ds(b_pune, 'tries') = 8
                     and pg_temp.ds(a_pune, 'booked') - pg_temp.ds(b_pune, 'booked') = 3
                     and pg_temp.ds(a_pune, 'chats') - pg_temp.ds(b_pune, 'chats') = 4
                     and pg_temp.ds(a_pune, 'paid_after') - pg_temp.ds(b_pune, 'paid_after') = 2);

    t_name := t_name || text 'T Gurugram: +1 try, +0 booked, +1 chat, +1 paid after';
    t_det := t_det || (pg_temp.ds(a_gur, 'tries') - pg_temp.ds(b_gur, 'tries') || '/' || pg_temp.ds(a_gur, 'chats') - pg_temp.ds(b_gur, 'chats'));
    t_pass := t_pass || (pg_temp.ds(a_gur, 'tries') - pg_temp.ds(b_gur, 'tries') = 1
                     and pg_temp.ds(a_gur, 'booked') - pg_temp.ds(b_gur, 'booked') = 0
                     and pg_temp.ds(a_gur, 'chats') - pg_temp.ds(b_gur, 'chats') = 1
                     and pg_temp.ds(a_gur, 'paid_after') - pg_temp.ds(b_gur, 'paid_after') = 1);

    -- ════ per day ════
    t_name := t_name || text 'D tries land on their IST day: -1 day +3 tries/+2 booked (All), +2 (Pune); -2 days +3; -3 days +2; -12 days +1 (Gurugram); -40 days +1 booked';
    t_det := t_det || (pg_temp.dv(a_all, c_now - interval '1 day', 'tries') - pg_temp.dv(b_all, c_now - interval '1 day', 'tries') || ' / '
                       || pg_temp.dv(a_pune, c_now - interval '1 day', 'tries') - pg_temp.dv(b_pune, c_now - interval '1 day', 'tries'));
    t_pass := t_pass || (pg_temp.dv(a_all,  c_now - interval '1 day',   'tries')  - pg_temp.dv(b_all,  c_now - interval '1 day',   'tries')  = 3
                     and pg_temp.dv(a_all,  c_now - interval '1 day',   'booked') - pg_temp.dv(b_all,  c_now - interval '1 day',   'booked') = 2
                     and pg_temp.dv(a_pune, c_now - interval '1 day',   'tries')  - pg_temp.dv(b_pune, c_now - interval '1 day',   'tries')  = 2
                     and pg_temp.dv(a_all,  c_now - interval '2 days',  'tries')  - pg_temp.dv(b_all,  c_now - interval '2 days',  'tries')  = 3
                     and pg_temp.dv(a_all,  c_now - interval '3 days',  'tries')  - pg_temp.dv(b_all,  c_now - interval '3 days',  'tries')  = 2
                     and pg_temp.dv(a_all,  c_now - interval '12 days', 'tries')  - pg_temp.dv(b_all,  c_now - interval '12 days', 'tries')  = 1
                     and pg_temp.dv(a_gur,  c_now - interval '12 days', 'tries')  - pg_temp.dv(b_gur,  c_now - interval '12 days', 'tries')  = 1
                     and pg_temp.dv(a_pune, c_now - interval '12 days', 'tries')  - pg_temp.dv(b_pune, c_now - interval '12 days', 'tries')  = 0
                     and pg_temp.dv(a_all,  c_now - interval '40 days', 'booked') - pg_temp.dv(b_all,  c_now - interval '40 days', 'booked') = 1);

    -- first chats: each person once, on the IST day their first chat ended
    ok := true;
    for k in 1 .. 5 loop
      ok := ok
        and pg_temp.dv(a_all, ends[k], 'chats') - pg_temp.dv(b_all, ends[k], 'chats')
            = (select count(*) from unnest(ends) x where (x at time zone 'Asia/Kolkata')::date = (ends[k] at time zone 'Asia/Kolkata')::date)
        and pg_temp.dv(a_all, ends[k], 'paid_after') - pg_temp.dv(b_all, ends[k], 'paid_after')
            = (select count(*) from unnest(ends) with ordinality x(t, i)
               where (x.t at time zone 'Asia/Kolkata')::date = (ends[k] at time zone 'Asia/Kolkata')::date and paid_flags[x.i]);
    end loop;
    t_name := t_name || text 'D first chats and paid-after land on the IST day the first chat ended (u4 counts once, on its 25-day-old chat)';
    t_det := t_det || ok::text;
    t_pass := t_pass || ok;

    -- ════ days from the chat to paying ════
    t_name := t_name || text 'B All 30d: +1 in 1-3 (u5, exactly 1 day), +1 in 3-7 (u2, exactly 3 days), +1 in 14-30 (u4); 90d the same';
    t_det := t_det || ((a_all #> '{pay_bins,30}')::text || ' | ' || (a_all #> '{pay_bins,90}')::text);
    t_pass := t_pass || (pg_temp.pb(a_all, '30', 0) - pg_temp.pb(b_all, '30', 0) = 0
                     and pg_temp.pb(a_all, '30', 1) - pg_temp.pb(b_all, '30', 1) = 1
                     and pg_temp.pb(a_all, '30', 2) - pg_temp.pb(b_all, '30', 2) = 1
                     and pg_temp.pb(a_all, '30', 3) - pg_temp.pb(b_all, '30', 3) = 0
                     and pg_temp.pb(a_all, '30', 4) - pg_temp.pb(b_all, '30', 4) = 1
                     and pg_temp.pb(a_all, '30', 5) - pg_temp.pb(b_all, '30', 5) = 0
                     and pg_temp.pbs(a_all, '90') - pg_temp.pbs(b_all, '90') = 3
                     and pg_temp.pb(a_all, '90', 4) - pg_temp.pb(b_all, '90', 4) = 1);

    t_name := t_name || text 'B All 7d: u4 paid BEFORE its 2-day-old chat so it is not here: +1 in 1-3, +1 in 3-7, nothing in 14-30';
    t_det := t_det || (a_all #> '{pay_bins,7}')::text;
    t_pass := t_pass || (pg_temp.pb(a_all, '7', 1) - pg_temp.pb(b_all, '7', 1) = 1
                     and pg_temp.pb(a_all, '7', 2) - pg_temp.pb(b_all, '7', 2) = 1
                     and pg_temp.pb(a_all, '7', 4) - pg_temp.pb(b_all, '7', 4) = 0
                     and pg_temp.pbs(a_all, '7') - pg_temp.pbs(b_all, '7') = 2);

    t_name := t_name || text 'B campus: Pune 30d +1 in 3-7 and +1 in 14-30; Gurugram 30d +1 in 1-3';
    t_det := t_det || ((a_pune #> '{pay_bins,30}')::text || ' | ' || (a_gur #> '{pay_bins,30}')::text);
    t_pass := t_pass || (pg_temp.pb(a_pune, '30', 2) - pg_temp.pb(b_pune, '30', 2) = 1
                     and pg_temp.pb(a_pune, '30', 4) - pg_temp.pb(b_pune, '30', 4) = 1
                     and pg_temp.pbs(a_pune, '30') - pg_temp.pbs(b_pune, '30') = 2
                     and pg_temp.pb(a_gur, '30', 1) - pg_temp.pb(b_gur, '30', 1) = 1
                     and pg_temp.pbs(a_gur, '30') - pg_temp.pbs(b_gur, '30') = 1);

    -- ════ tie-out with pp_admin_insights (0176): the trend adds up to the totals ════
    i_all  := pg_temp.ins(adm, '{}');
    i_pune := pg_temp.ins(adm, '{"campus":"Pune"}');
    i_gur  := pg_temp.ins(adm, '{"campus":"Gurugram"}');
    ok := true;
    for sc in select unnest(array['All', 'Pune', 'Gurugram']) loop
      r := case sc when 'All' then a_all when 'Pune' then a_pune else a_gur end;
      ok := ok
        and pg_temp.ds(r, 'tries')      = pg_temp.n(case sc when 'All' then i_all when 'Pune' then i_pune else i_gur end, 'ranges', '90', 'demand', 'attempts')
        and pg_temp.ds(r, 'booked')     = pg_temp.n(case sc when 'All' then i_all when 'Pune' then i_pune else i_gur end, 'ranges', '90', 'demand', 'booked')
        and pg_temp.ds(r, 'chats')      = pg_temp.n(case sc when 'All' then i_all when 'Pune' then i_pune else i_gur end, 'ranges', '90', 'outcome', 'applicants')
        and pg_temp.ds(r, 'paid_after') = pg_temp.n(case sc when 'All' then i_all when 'Pune' then i_pune else i_gur end, 'ranges', '90', 'outcome', 'paid_after');
      foreach rg in array array['7', '30', '90'] loop
        ok := ok and pg_temp.pbs(r, rg) = pg_temp.n(case sc when 'All' then i_all when 'Pune' then i_pune else i_gur end, 'ranges', rg, 'outcome', 'paid_after');
      end loop;
    end loop;
    t_name := t_name || text 'X tie-out (whatever is in the database): per campus, 90-day tries/booked/chats/paid-after and the bins of 7/30/90 days equal pp_admin_insights';
    t_det := t_det || ok::text;
    t_pass := t_pass || ok;

    -- ════ privacy: counts only ════
    t_name := t_name || text 'P output has no ids, emails or names (no uuid, no @, no fixture name)';
    t_det := t_det || length(a_all::text || a_pune::text || a_gur::text)::text;
    t_pass := t_pass || ((a_all::text || a_pune::text || a_gur::text) !~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
                     and position('@' in a_all::text || a_pune::text || a_gur::text) = 0
                     and position('Trend' in a_all::text || a_pune::text || a_gur::text) = 0
                     and position('PPTrend' in a_all::text) = 0);

    t_name := t_name || text 'P mode is the eligibility flag';
    t_det := t_det || coalesce(a_all->>'mode', 'null');
    t_pass := t_pass || (a_all->>'mode' = coalesce((select value from public.app_flags where key = 'peerpath_eligibility'), 'off'));

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select * from pg_temp.run_peerpath_admin_impact_trend_tests();
