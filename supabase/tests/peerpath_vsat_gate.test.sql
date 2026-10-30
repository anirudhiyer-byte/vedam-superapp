-- PeerPath VSAT gate · database tests (migrations 0031–0033)
--
-- How to run (STAGING ONLY): paste this whole file into the staging SQL editor,
-- or run it through the Supabase MCP / psql. The last statement returns one row
-- per test: test | pass | detail.
--
-- Nothing is left behind: every test runs inside sub-blocks that are rolled back
-- with a private error code, and the whole run is rolled back at the end. Test
-- users use @example.invalid emails and never receive mail/SMS.
--
-- Logged-in calls are simulated the same way PostgREST does it: SET ROLE
-- authenticated + request.jwt.claims {"sub": <uid>}. auth.uid() reads that claim.

-- ── helpers (session-temporary) ────────────────────────────────────────────────
-- a login. p_confirmed = email verified by OTP; p_phone_confirmed = phone verified by OTP
-- (Supabase Auth sets email_confirmed_at / phone_confirmed_at only after an OTP).
create or replace function pg_temp.mk_user(p_email text, p_phone text default null, p_confirmed boolean default true,
                                           p_phone_confirmed boolean default null)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, phone, aud, role, email_confirmed_at, phone_confirmed_at, raw_user_meta_data)
  values (v, p_email, p_phone, 'authenticated', 'authenticated', case when p_confirmed then now() end,
          case when p_phone is not null and coalesce(p_phone_confirmed, p_confirmed) then now() end, '{}'::jsonb);
  insert into public.profiles (id, email, phone) values (v, p_email, p_phone)
  on conflict (id) do update set email = excluded.email, phone = excluded.phone;
  return v;
end $$;

-- a VSAT application (application_manager.lead_id has a FK to lead_manager, so the lead row comes first)
create or replace function pg_temp.mk_app(p_uid uuid, p_name text, p_email text, p_mobile text)
returns void language sql as $$
  insert into public.lead_manager (lead_id) values (p_uid) on conflict (lead_id) do nothing;
  insert into public.application_manager (application_id, lead_id, registered_name, registered_email, registered_mobile)
  values ('PPTEST-' || substr(md5(random()::text), 1, 10), p_uid, p_name, p_email, p_mobile);
$$;

create or replace function pg_temp.mk_paid(p_uid uuid)
returns void language sql as $$
  insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider, amount)
  values (p_uid, now(), 'PPTEST-' || p_uid::text, 'cashfree', 1000);
$$;

create or replace function pg_temp.set_mode(p_mode text)
returns void language sql as $$
  insert into public.app_flags (key, value, updated_by) values ('peerpath_eligibility', p_mode, 'db-test')
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = 'db-test';
$$;

create or replace function pg_temp.mk_admin(p_uid uuid)
returns void language sql as $$
  insert into public.user_roles (user_id, role) values (p_uid, 'admin');
$$;

-- an active test senior who is free every day 00:00–23:30 (1:1 and Group, 15/30 min)
create or replace function pg_temp.mk_senior()
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.pp_seniors (first_name, campus, year, contact_email, status, session_types, durations,
                                 daily_cap, weekly_cap, min_notice_hours)
  values ('PPTest', 'Pune', 2, 'pptest-senior-' || substr(md5(random()::text), 1, 8) || '@example.invalid',
          'active', '{1:1,Group}', '{15,30}', 10, 20, 12)
  returning id into v;
  insert into public.pp_availability (senior_id, weekday, from_time, to_time, type)
  select v, d, '00:00', '23:30', t from generate_series(0, 6) d, unnest(array['1:1', 'Group']) t;
  return v;
end $$;

-- ISO start time: N days from today (IST) at HH:MM IST
create or replace function pg_temp.slot(p_days int, p_hhmm text)
returns text language sql as $$
  select to_char((((now() at time zone 'Asia/Kolkata')::date + p_days) + p_hhmm::time) at time zone 'Asia/Kolkata',
                 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
$$;

-- run fn as a logged-in user (or as anon when p_uid is null and p_anon is true)
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
  return jsonb_build_object('sqlstate', sqlstate);
end $$;

create or replace function pg_temp.book_as(p_uid uuid, p_body jsonb)
returns jsonb language sql as $$
  select pg_temp.call_as(p_uid, format('select public.pp_book(%L::jsonb)', p_body::text));
$$;

-- ── the tests ──────────────────────────────────────────────────────────────────
create or replace function pg_temp.run_peerpath_vsat_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  sen uuid; u uuid; u2 uuid; adm uuid; r jsonb; r2 jsonb; n int; n2 int; s text; ok boolean;
  body jsonb; id1 text; mode text; i int;
begin
  begin -- everything below is rolled back at the end (ZDONE)
    sen := pg_temp.mk_senior();

    -- ════ pp_vsat_eligible — 3 modes × {not registered, registered, registered+paid} ════
    foreach mode in array array['off', 'registered', 'paid'] loop
      begin
        perform pg_temp.set_mode(mode);
        u := pg_temp.mk_user('e-none@example.invalid');
        r := to_jsonb(public.pp_vsat_eligible(u));
        t_name := t_name || ('E mode=' || mode || ' not registered'); t_det := t_det || r::text;
        t_pass := t_pass || (r #>> '{}' = case mode when 'off' then 'BOOKING_CLOSED' else 'NOT_REGISTERED' end);

        u := pg_temp.mk_user('e-reg@example.invalid');
        perform pg_temp.mk_app(u, 'Reg User', 'e-reg@example.invalid', '+919000000001');
        r := to_jsonb(public.pp_vsat_eligible(u));
        t_name := t_name || ('E mode=' || mode || ' registered, unpaid'); t_det := t_det || r::text;
        t_pass := t_pass || (r #>> '{}' = case mode when 'off' then 'BOOKING_CLOSED' when 'registered' then 'OK' else 'PAYMENT_PENDING' end);

        u := pg_temp.mk_user('e-paid@example.invalid');
        perform pg_temp.mk_app(u, 'Paid User', 'e-paid@example.invalid', '+919000000002');
        perform pg_temp.mk_paid(u);
        r := to_jsonb(public.pp_vsat_eligible(u));
        t_name := t_name || ('E mode=' || mode || ' registered + paid'); t_det := t_det || r::text;
        t_pass := t_pass || (r #>> '{}' = case mode when 'off' then 'BOOKING_CLOSED' else 'OK' end);

        adm := pg_temp.mk_user('e-admin@example.invalid');
        perform pg_temp.mk_admin(adm);
        r := to_jsonb(public.pp_vsat_eligible(adm));
        t_name := t_name || ('E mode=' || mode || ' admin (no application)'); t_det := t_det || r::text;
        t_pass := t_pass || (r #>> '{}' = case mode when 'off' then 'BOOKING_CLOSED' else 'OK' end);
        raise exception using errcode = 'ZUNDO';
      exception when sqlstate 'ZUNDO' then null;
      end;
    end loop;

    begin
      perform pg_temp.set_mode('paid');
      r := to_jsonb(public.pp_vsat_eligible(null));
      t_name := t_name || text 'E null uid -> NOT_LOGGED_IN'; t_det := t_det || r::text; t_pass := t_pass || (r #>> '{}' = 'NOT_LOGGED_IN');

      r := to_jsonb(public.pp_vsat_eligible(gen_random_uuid()));
      t_name := t_name || text 'E unknown uid -> NOT_REGISTERED'; t_det := t_det || r::text; t_pass := t_pass || (r #>> '{}' = 'NOT_REGISTERED');

      u := pg_temp.mk_user('e-paidonly@example.invalid');
      perform pg_temp.mk_paid(u);
      r := to_jsonb(public.pp_vsat_eligible(u));
      t_name := t_name || text 'E paid but no application row -> NOT_REGISTERED'; t_det := t_det || r::text; t_pass := t_pass || (r #>> '{}' = 'NOT_REGISTERED');

      u := pg_temp.mk_user('pptest-staff-q7z@vedam.org', null, true);
      r := to_jsonb(public.pp_vsat_eligible(u));
      t_name := t_name || text 'E confirmed @vedam.org staff = admin -> OK'; t_det := t_det || r::text; t_pass := t_pass || (r #>> '{}' = 'OK');

      u := pg_temp.mk_user('pptest-unconfirmed-q7z@vedam.org', null, false);
      r := to_jsonb(public.pp_vsat_eligible(u));
      t_name := t_name || text 'E unconfirmed @vedam.org is NOT admin'; t_det := t_det || r::text; t_pass := t_pass || (r #>> '{}' = 'NOT_REGISTERED');

      delete from public.app_flags where key = 'peerpath_eligibility';
      u := pg_temp.mk_user('e-noflag@example.invalid');
      perform pg_temp.mk_app(u, 'No Flag', 'e-noflag@example.invalid', '+919000000003');
      r := to_jsonb(public.pp_vsat_eligible(u));
      t_name := t_name || text 'E flag row missing -> BOOKING_CLOSED (fail safe)'; t_det := t_det || r::text; t_pass := t_pass || (r #>> '{}' = 'BOOKING_CLOSED');
      raise exception using errcode = 'ZUNDO';
    exception when sqlstate 'ZUNDO' then null;
    end;

    -- ════ permissions ════
    begin
      u := pg_temp.mk_user('p-user@example.invalid');
      r := pg_temp.call_as(null, format('select to_jsonb(public.pp_vsat_eligible(%L::uuid))', u), true);
      t_name := t_name || text 'P anon cannot run pp_vsat_eligible'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(u, format('select to_jsonb(public.pp_vsat_eligible(%L::uuid))', u));
      t_name := t_name || text 'P logged-in user cannot run pp_vsat_eligible'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(null, 'select public.pp_book(''{}''::jsonb)', true);
      t_name := t_name || text 'P anon cannot run pp_book'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(u, format('select public.pp_book_core(%L::uuid, ''{}''::jsonb)', u));
      t_name := t_name || text 'P logged-in user cannot run pp_book_core'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(u, 'select to_jsonb(public.pp_rate_hit(''x'', 1, 60))');
      t_name := t_name || text 'P logged-in user cannot run pp_rate_hit'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(null, 'select to_jsonb(public.pp_rate_hit(''x'', 1, 60))', true);
      t_name := t_name || text 'P anon cannot run pp_rate_hit'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');

      r := pg_temp.call_as(u, 'select to_jsonb(count(*)) from public.app_flags');
      t_name := t_name || text 'P logged-in user cannot read app_flags'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(u, 'with x as (update public.app_flags set value = ''registered'' returning 1) select to_jsonb(count(*)) from x');
      t_name := t_name || text 'P logged-in user cannot update app_flags'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(null, 'with x as (update public.app_flags set value = ''registered'' returning 1) select to_jsonb(count(*)) from x', true);
      t_name := t_name || text 'P anon cannot update app_flags'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(u, format('with x as (insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider) values (%L, now(), ''self'', ''cashfree'') returning 1) select to_jsonb(count(*)) from x', u));
      t_name := t_name || text 'P logged-in user cannot write vsat_payments'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(u, 'select to_jsonb(count(*)) from public.vsat_payments');
      t_name := t_name || text 'P logged-in user cannot read vsat_payments'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(u, 'select to_jsonb(count(*)) from public.pp_book_attempts');
      t_name := t_name || text 'P logged-in user cannot read pp_book_attempts'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      raise exception using errcode = 'ZUNDO';
    exception when sqlstate 'ZUNDO' then null;
    end;

    -- vsat_payments is write-once
    begin
      u := pg_temp.mk_user('p-paid@example.invalid');
      perform pg_temp.mk_paid(u);
      begin
        update public.vsat_payments set paid_at = now() - interval '1 day' where lead_id = u;
        s := 'updated';
      exception when others then s := sqlstate;
      end;
      t_name := t_name || text 'P vsat_payments rows cannot be updated'; t_det := t_det || s; t_pass := t_pass || (s = '42501');
      begin
        delete from public.vsat_payments where lead_id = u;
        s := 'deleted';
      exception when others then s := sqlstate;
      end;
      t_name := t_name || text 'P vsat_payments rows cannot be deleted'; t_det := t_det || s; t_pass := t_pass || (s = '42501');
      begin
        truncate public.vsat_payments;
        s := 'truncated';
      exception when others then s := sqlstate;
      end;
      t_name := t_name || text 'P vsat_payments cannot be truncated'; t_det := t_det || s; t_pass := t_pass || (s = '42501');
      begin
        insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider) values (u, now(), 'dup', 'cashfree');
        s := 'inserted twice';
      exception when others then s := sqlstate;
      end;
      t_name := t_name || text 'P one vsat_payments row per user'; t_det := t_det || s; t_pass := t_pass || (s = '23505');
      begin
        insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider) values (gen_random_uuid(), now(), 'sim-1', 'simulated');
        s := 'inserted';
      exception when others then s := sqlstate;
      end;
      t_name := t_name || text 'P simulated payment refused without the staging switch'; t_det := t_det || s; t_pass := t_pass || (s = '42501');
      begin
        update public.app_flags set value = 'yes' where key = 'peerpath_eligibility';
        s := 'updated';
      exception when others then s := sqlstate;
      end;
      t_name := t_name || text 'P app_flags rejects an unknown mode'; t_det := t_det || s; t_pass := t_pass || (s = '23514');
      raise exception using errcode = 'ZUNDO';
    exception when sqlstate 'ZUNDO' then null;
    end;

    select count(*) into n from pg_class c where c.relnamespace = 'public'::regnamespace
      and c.relname in ('app_flags', 'vsat_payments', 'pp_book_attempts', 'pp_rate_limits') and c.relrowsecurity;
    t_name := t_name || text 'P RLS on for app_flags, vsat_payments, pp_book_attempts, pp_rate_limits'; t_det := t_det || (n || '/4'); t_pass := t_pass || (n = 4);

    select count(*), string_agg(p.proname, ',') into n, s from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.prosecdef and (p.proname like 'pp\_%' or p.proname like 'vsat\_%')
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
    t_name := t_name || text 'P every SECURITY DEFINER pp_/vsat_ function pins search_path'; t_det := t_det || coalesce(s, 'none'); t_pass := t_pass || (n = 0);

    select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.oid::regprocedure::text in ('pp_cancel(uuid,text,text)', 'pp_booking_by_id(uuid,text,text)',
        'pp_give_feedback(uuid,text,text,integer,boolean,boolean,text)', 'pp_find_bookings(text,text)', 'pp_owner_ok(pp_bookings,text,text)');
    t_name := t_name || text 'P old email+phone functions are gone'; t_det := t_det || (n || ' left'); t_pass := t_pass || (n = 0);

    -- ════ pp_book ════
    -- B: codes per case
    begin
      perform pg_temp.set_mode('paid');
      body := jsonb_build_object('seniorId', sen, 'start', pg_temp.slot(3, '10:00'), 'type', '1:1', 'duration', 30);

      r := pg_temp.book_as(null, body);
      t_name := t_name || text 'B no login (no uid) -> NOT_LOGGED_IN'; t_det := t_det || r::text; t_pass := t_pass || (r->>'code' = 'NOT_LOGGED_IN');

      u := pg_temp.mk_user('b-none@example.invalid', '+919100000001');
      r := pg_temp.book_as(u, body);
      select count(*) into n from public.pp_bookings where applicant_user_id = u;
      t_name := t_name || text 'B case 3 not registered -> NOT_REGISTERED, no row'; t_det := t_det || (r::text || ' rows=' || n);
      t_pass := t_pass || (r->>'code' = 'NOT_REGISTERED' and (r->>'ok')::boolean = false and n = 0);

      u := pg_temp.mk_user('b-unpaid@example.invalid', '+919100000002');
      perform pg_temp.mk_app(u, 'Unpaid Applicant', 'b-unpaid@example.invalid', '+919100000002');
      r := pg_temp.book_as(u, body);
      select count(*) into n from public.pp_bookings where applicant_user_id = u;
      t_name := t_name || text 'B case 2 registered, unpaid (mode paid) -> PAYMENT_PENDING, no row'; t_det := t_det || (r::text || ' rows=' || n);
      t_pass := t_pass || (r->>'code' = 'PAYMENT_PENDING' and n = 0);

      u := pg_temp.mk_user('b-paid-login@example.invalid', '+919100000003');
      perform pg_temp.mk_app(u, 'Paid Applicant', 'b-paid-app@example.invalid', '+919100000033');
      perform pg_temp.mk_paid(u);
      r := pg_temp.book_as(u, body);
      select count(*), max(applicant_email), max(applicant_phone), max(applicant_name)
        into n, s, id1, mode from public.pp_bookings where applicant_user_id = u;
      t_name := t_name || text 'B case 1 registered + paid -> OK, one row owned by uid'; t_det := t_det || (r::text || ' rows=' || n);
      t_pass := t_pass || (r->>'code' = 'OK' and (r->>'ok')::boolean and n = 1 and r->>'id' is not null);
      t_name := t_name || text 'B email + phone come from the VERIFIED login (application values ignored), name from the application'; t_det := t_det || (s || ' ' || id1 || ' ' || mode);
      t_pass := t_pass || (s = 'b-paid-login@example.invalid' and id1 = '+919100000003' and mode = 'Paid Applicant');

      select count(*) into n from public.pp_book_attempts where user_id = u;
      t_name := t_name || text 'B attempt logged for allowed booking'; t_det := t_det || (n || ' log rows'); t_pass := t_pass || (n = 1);
      raise exception using errcode = 'ZUNDO';
    exception when sqlstate 'ZUNDO' then null;
    end;

    begin
      perform pg_temp.set_mode('registered');
      body := jsonb_build_object('seniorId', sen, 'start', pg_temp.slot(3, '11:00'), 'type', '1:1', 'duration', 30);
      u := pg_temp.mk_user('b-reg@example.invalid', '+919100000004');
      perform pg_temp.mk_app(u, 'Registered Applicant', 'b-reg@example.invalid', '+919100000004');
      r := pg_temp.book_as(u, body);
      t_name := t_name || text 'B mode registered: registered, unpaid -> OK'; t_det := t_det || r::text; t_pass := t_pass || (r->>'code' = 'OK');

      perform pg_temp.set_mode('off');
      u2 := pg_temp.mk_user('b-off@example.invalid', '+919100000005');
      perform pg_temp.mk_app(u2, 'Off Applicant', 'b-off@example.invalid', '+919100000005');
      perform pg_temp.mk_paid(u2);
      r := pg_temp.book_as(u2, jsonb_set(body, '{start}', to_jsonb(pg_temp.slot(3, '12:00'))));
      select count(*) into n from public.pp_bookings where applicant_user_id = u2;
      t_name := t_name || text 'B mode off -> BOOKING_CLOSED, no row'; t_det := t_det || (r::text || ' rows=' || n); t_pass := t_pass || (r->>'code' = 'BOOKING_CLOSED' and n = 0);
      select count(*) into n from public.pp_book_attempts where user_id = u2 and code = 'BOOKING_CLOSED';
      t_name := t_name || text 'B blocked attempt is logged too'; t_det := t_det || (n || ' log rows'); t_pass := t_pass || (n = 1);

      perform pg_temp.set_mode('paid');
      adm := pg_temp.mk_user('b-admin@example.invalid', '+919100000006');
      perform pg_temp.mk_admin(adm);
      r := pg_temp.book_as(adm, jsonb_set(body, '{start}', to_jsonb(pg_temp.slot(3, '13:00'))));
      t_name := t_name || text 'B admin skips the VSAT check (no application) -> OK'; t_det := t_det || r::text; t_pass := t_pass || (r->>'code' = 'OK');

      u := pg_temp.mk_user('b-nophone@example.invalid', null);
      perform pg_temp.mk_app(u, 'No Phone', 'b-nophone@example.invalid', null);
      perform pg_temp.mk_paid(u);
      r := pg_temp.book_as(u, jsonb_set(body, '{start}', to_jsonb(pg_temp.slot(3, '14:00'))));
      select count(*), bool_and(applicant_phone is null) into n, ok from public.pp_bookings where applicant_user_id = u;
      t_name := t_name || text 'B no phone anywhere -> OK, booking stored with no phone (phone optional)'; t_det := t_det || (r::text || ' rows=' || n || ' phone_null=' || coalesce(ok::text, 'n/a'));
      t_pass := t_pass || (r->>'code' = 'OK' and n = 1 and ok);

      u := pg_temp.mk_user(null, '+919100000007');
      perform pg_temp.mk_app(u, 'No Email', null, '+919100000007');
      perform pg_temp.mk_paid(u);
      r := pg_temp.book_as(u, jsonb_set(body, '{start}', to_jsonb(pg_temp.slot(3, '14:30'))));
      select count(*) into n from public.pp_bookings where applicant_user_id = u;
      t_name := t_name || text 'B no email anywhere -> EMAIL_NOT_VERIFIED, no row'; t_det := t_det || (r::text || ' rows=' || n); t_pass := t_pass || (r->>'code' = 'EMAIL_NOT_VERIFIED' and n = 0);

      -- verified-only contact details (security review, 30 Oct): typed values are never used
      u := pg_temp.mk_user('b-emailunv@example.invalid', '+919100000008', false, true);
      perform pg_temp.mk_app(u, 'Email Unverified', 'b-emailunv@example.invalid', '+919100000008');
      perform pg_temp.mk_paid(u);
      r := pg_temp.book_as(u, jsonb_set(body, '{start}', to_jsonb(pg_temp.slot(3, '15:00'))));
      t_name := t_name || text 'B login email not verified (phone verified) -> EMAIL_NOT_VERIFIED'; t_det := t_det || r::text; t_pass := t_pass || (r->>'code' = 'EMAIL_NOT_VERIFIED');

      u := pg_temp.mk_user('b-phoneunv@example.invalid', '+919100000009', true, false);
      perform pg_temp.mk_app(u, 'Phone Unverified', 'b-phoneunv@example.invalid', '+919100000009');
      perform pg_temp.mk_paid(u);
      r := pg_temp.book_as(u, jsonb_set(body, '{start}', to_jsonb(pg_temp.slot(3, '19:00'))));
      select max(applicant_email), count(*) filter (where applicant_phone is not null) into s, n from public.pp_bookings where applicant_user_id = u;
      t_name := t_name || text 'B login phone not verified -> OK, unverified phone NOT stored'; t_det := t_det || (r::text || ' email=' || coalesce(s, 'null') || ' phones=' || n);
      t_pass := t_pass || (r->>'code' = 'OK' and s = 'b-phoneunv@example.invalid' and n = 0);

      u := pg_temp.mk_user('b-profflags@example.invalid', null);
      update public.profiles set phone = '+919100000011', mobile_verified = true, email_verified = true where id = u;
      perform pg_temp.mk_app(u, 'Profile Flags', 'b-profflags@example.invalid', '+919100000011');
      perform pg_temp.mk_paid(u);
      r := pg_temp.book_as(u, jsonb_set(body, '{start}', to_jsonb(pg_temp.slot(3, '20:00'))));
      select count(*) filter (where applicant_phone is not null) into n from public.pp_bookings where applicant_user_id = u;
      t_name := t_name || text 'B profile mobile_verified flag (user-editable) not trusted -> profile phone NOT stored'; t_det := t_det || (r::text || ' phones=' || n);
      t_pass := t_pass || (r->>'code' = 'OK' and n = 0);

      u := pg_temp.mk_user('b-profemail@example.invalid', null, false);
      update public.profiles set email_verified = true where id = u;
      perform pg_temp.mk_app(u, 'Profile Email Flag', 'b-profemail@example.invalid', null);
      perform pg_temp.mk_paid(u);
      r := pg_temp.book_as(u, jsonb_set(body, '{start}', to_jsonb(pg_temp.slot(3, '17:00'))));
      t_name := t_name || text 'B profile email_verified flag (user-editable) not trusted -> EMAIL_NOT_VERIFIED'; t_det := t_det || r::text; t_pass := t_pass || (r->>'code' = 'EMAIL_NOT_VERIFIED');

      u := pg_temp.mk_user('b-noplus@example.invalid', '919100000012');
      perform pg_temp.mk_app(u, 'No Plus', 'b-noplus@example.invalid', null);
      perform pg_temp.mk_paid(u);
      r := pg_temp.book_as(u, jsonb_set(body, '{start}', to_jsonb(pg_temp.slot(3, '16:30'))));
      select max(applicant_phone) into s from public.pp_bookings where applicant_user_id = u;
      t_name := t_name || text 'B login phone stored in E.164 (+ added)'; t_det := t_det || (r::text || ' ' || coalesce(s, 'null')); t_pass := t_pass || (r->>'code' = 'OK' and s = '+919100000012');
      raise exception using errcode = 'ZUNDO';
    exception when sqlstate 'ZUNDO' then null;
    end;

    -- B: invalid input is rejected and nothing is written.
    -- A fresh user every 10 inputs: one user sending 22 requests would (correctly) hit the
    -- 20-per-hour limit first and get RATE_LIMITED, which would hide the INVALID check.
    begin
      perform pg_temp.set_mode('registered');
      body := jsonb_build_object('seniorId', sen, 'start', pg_temp.slot(4, '10:00'), 'type', '1:1', 'duration', 30);
      i := 0;
      foreach s in array array[
        'null', '[]', '"text"', '42', '{}',
        jsonb_set(body, '{email}', '"attacker@example.invalid"')::text,
        jsonb_set(body, '{phone}', '"+919999999999"')::text,
        jsonb_set(body, '{payment_stage_1}', '"payment_approved"')::text,
        jsonb_set(body, '{vsat_paid_at}', '"2026-01-01"')::text,
        jsonb_set(body, '{status}', '"completed"')::text,
        jsonb_set(body, '{applicant_user_id}', to_jsonb(gen_random_uuid()))::text,
        jsonb_set(body, '{seniorId}', '12345')::text,
        jsonb_set(body, '{seniorId}', '"not-a-uuid"')::text,
        jsonb_set(body, '{start}', '"garbage"')::text,
        jsonb_set(body, '{start}', 'null')::text,
        jsonb_set(body, '{type}', '"VIP"')::text,
        jsonb_set(body, '{duration}', '45')::text,
        jsonb_set(body, '{duration}', '"30"')::text,
        jsonb_set(body, '{question}', to_jsonb(repeat('x', 501)))::text,
        jsonb_set(body, '{question}', '{"a":1}')::text,
        jsonb_set(body, '{rescheduleOf}', '"not-a-uuid"')::text,
        jsonb_set(body, '{pad}', to_jsonb(repeat('y', 5000)))::text
      ] loop
        i := i + 1;
        if (i - 1) % 10 = 0 then
          u := pg_temp.mk_user('b-bad-' || i || '@example.invalid', '+91910000' || lpad((100 + i)::text, 4, '0'));
          perform pg_temp.mk_app(u, 'Bad Input', 'b-bad-' || i || '@example.invalid', '+91910000' || lpad((100 + i)::text, 4, '0'));
        end if;
        if s = 'null' then r := pg_temp.book_as(u, null); else r := pg_temp.book_as(u, s::jsonb); end if;
        t_name := t_name || ('B invalid input #' || i || ' rejected: ' || left(s, 60));
        t_det := t_det || r::text;
        t_pass := t_pass || (r->>'code' = 'INVALID');
      end loop;
      select count(*) into n from public.pp_bookings where applicant_email like 'b-bad-%@example.invalid';
      t_name := t_name || text 'B no rows written for any invalid input'; t_det := t_det || (n || ' rows'); t_pass := t_pass || (n = 0);
      raise exception using errcode = 'ZUNDO';
    exception when sqlstate 'ZUNDO' then null;
    end;

    -- B: slots, double-click, limits, rate limit, reschedule
    begin
      perform pg_temp.set_mode('registered');
      u := pg_temp.mk_user('b-slot@example.invalid', '+919100000020');
      perform pg_temp.mk_app(u, 'Slot User', 'b-slot@example.invalid', '+919100000020');
      u2 := pg_temp.mk_user('b-other@example.invalid', '+919100000021');
      perform pg_temp.mk_app(u2, 'Other User', 'b-other@example.invalid', '+919100000021');

      r := pg_temp.book_as(u, jsonb_build_object('seniorId', gen_random_uuid(), 'start', pg_temp.slot(5, '10:00'), 'type', '1:1', 'duration', 30));
      t_name := t_name || text 'B unknown senior -> SLOT_UNAVAILABLE'; t_det := t_det || r::text; t_pass := t_pass || (r->>'code' = 'SLOT_UNAVAILABLE');
      r := pg_temp.book_as(u, jsonb_build_object('seniorId', sen, 'start', pg_temp.slot(-1, '10:00'), 'type', '1:1', 'duration', 30));
      t_name := t_name || text 'B time in the past -> SLOT_UNAVAILABLE'; t_det := t_det || r::text; t_pass := t_pass || (r->>'code' = 'SLOT_UNAVAILABLE');
      r := pg_temp.book_as(u, jsonb_build_object('seniorId', sen, 'start', pg_temp.slot(5, '10:10'), 'type', '1:1', 'duration', 30));
      t_name := t_name || text 'B time off the 30-min grid -> SLOT_UNAVAILABLE'; t_det := t_det || r::text; t_pass := t_pass || (r->>'code' = 'SLOT_UNAVAILABLE');
      r := pg_temp.book_as(u, jsonb_build_object('seniorId', sen, 'start', pg_temp.slot(20, '10:00'), 'type', '1:1', 'duration', 30));
      t_name := t_name || text 'B beyond the 14-day window -> SLOT_UNAVAILABLE'; t_det := t_det || r::text; t_pass := t_pass || (r->>'code' = 'SLOT_UNAVAILABLE');

      body := jsonb_build_object('seniorId', sen, 'start', pg_temp.slot(5, '10:00'), 'type', '1:1', 'duration', 30);
      r := pg_temp.book_as(u, body);
      r2 := pg_temp.book_as(u, body);
      select count(*) into n from public.pp_bookings where applicant_user_id = u and status = 'confirmed';
      t_name := t_name || text 'B double-click: same id twice, ONE row'; t_det := t_det || (r::text || ' / ' || r2::text || ' rows=' || n);
      t_pass := t_pass || (r->>'code' = 'OK' and r2->>'code' = 'OK' and r->>'id' = r2->>'id' and n = 1);
      id1 := r->>'id';

      r := pg_temp.book_as(u2, body);
      t_name := t_name || text 'B 1:1 slot taken by someone else -> SLOT_UNAVAILABLE'; t_det := t_det || r::text; t_pass := t_pass || (r->>'code' = 'SLOT_UNAVAILABLE');

      r := pg_temp.book_as(u, jsonb_set(body, '{start}', to_jsonb(pg_temp.slot(5, '12:00'))));
      r2 := pg_temp.book_as(u, jsonb_set(body, '{start}', to_jsonb(pg_temp.slot(5, '14:00'))));
      t_name := t_name || text 'B 3rd upcoming chat -> LIMIT_REACHED'; t_det := t_det || (r::text || ' / ' || r2::text);
      t_pass := t_pass || (r->>'code' = 'OK' and r2->>'code' = 'LIMIT_REACHED');

      r := pg_temp.book_as(u2, jsonb_build_object('seniorId', sen, 'start', pg_temp.slot(6, '10:00'), 'type', '1:1', 'duration', 30, 'rescheduleOf', id1));
      select status into s from public.pp_bookings where id = id1::uuid;
      t_name := t_name || text 'B cannot reschedule someone else''s chat -> RESCHEDULE_CLOSED'; t_det := t_det || (r::text || ' old=' || s);
      t_pass := t_pass || (r->>'code' = 'RESCHEDULE_CLOSED' and s = 'confirmed');

      r := pg_temp.book_as(u, jsonb_build_object('seniorId', sen, 'start', pg_temp.slot(6, '10:00'), 'type', '1:1', 'duration', 30, 'rescheduleOf', id1));
      select status into s from public.pp_bookings where id = id1::uuid;
      select count(*) into n from public.pp_bookings where id = (r->>'id')::uuid and applicant_user_id = u and moved_from = id1::uuid;
      t_name := t_name || text 'B reschedule own chat -> OK, old one marked rescheduled'; t_det := t_det || (r::text || ' old=' || s || ' new=' || n);
      t_pass := t_pass || (r->>'code' = 'OK' and s = 'rescheduled' and n = 1);
      raise exception using errcode = 'ZUNDO';
    exception when sqlstate 'ZUNDO' then null;
    end;

    -- review fix: moving a chat onto a Group time where you already hold a seat must fail, not "succeed"
    begin
      perform pg_temp.set_mode('registered');
      u := pg_temp.mk_user('b-gmove@example.invalid', '+919100000025');
      perform pg_temp.mk_app(u, 'Group Mover', 'b-gmove@example.invalid', '+919100000025');
      r := pg_temp.book_as(u, jsonb_build_object('seniorId', sen, 'start', pg_temp.slot(10, '10:00'), 'type', 'Group', 'duration', 30));
      r2 := pg_temp.book_as(u, jsonb_build_object('seniorId', sen, 'start', pg_temp.slot(10, '12:00'), 'type', 'Group', 'duration', 30));
      id1 := r2->>'id';
      r2 := pg_temp.book_as(u, jsonb_build_object('seniorId', sen, 'start', pg_temp.slot(10, '10:00'), 'type', 'Group', 'duration', 30, 'rescheduleOf', id1));
      select status into s from public.pp_bookings where id = id1::uuid;
      t_name := t_name || text 'B move onto a Group time you already hold -> RESCHEDULE_CLOSED, old chat untouched'; t_det := t_det || (r2::text || ' old=' || coalesce(s, 'null'));
      t_pass := t_pass || (r2->>'code' = 'RESCHEDULE_CLOSED' and (r2->>'ok')::boolean = false and s = 'confirmed');
      raise exception using errcode = 'ZUNDO';
    exception when sqlstate 'ZUNDO' then null;
    end;

    begin
      perform pg_temp.set_mode('registered');
      u := pg_temp.mk_user('b-rate@example.invalid', '+919100000030');
      perform pg_temp.mk_app(u, 'Rate User', 'b-rate@example.invalid', '+919100000030');
      for i in 1..21 loop
        r := pg_temp.book_as(u, '{}'::jsonb);
      end loop;
      t_name := t_name || text 'B 21st attempt in an hour -> RATE_LIMITED'; t_det := t_det || r::text; t_pass := t_pass || (r->>'code' = 'RATE_LIMITED');
      select count(*) into n from public.pp_book_attempts where user_id = u;
      t_name := t_name || text 'B all 21 attempts logged'; t_det := t_det || (n || ' log rows'); t_pass := t_pass || (n = 21);
      raise exception using errcode = 'ZUNDO';
    exception when sqlstate 'ZUNDO' then null;
    end;

    -- ════ ownership: view, cancel, feedback, my bookings ════
    begin
      perform pg_temp.set_mode('registered');
      u := pg_temp.mk_user('o-owner@example.invalid', '+919100000040');
      perform pg_temp.mk_app(u, 'Owner', 'o-owner@example.invalid', '+919100000040');
      u2 := pg_temp.mk_user('o-other@example.invalid', '+919100000041');
      adm := pg_temp.mk_user('o-admin@example.invalid', '+919100000042');
      perform pg_temp.mk_admin(adm);
      r := pg_temp.book_as(u, jsonb_build_object('seniorId', sen, 'start', pg_temp.slot(7, '10:00'), 'type', '1:1', 'duration', 30));
      id1 := r->>'id';
      -- a legacy (no-login) booking with the owner's own email + phone
      insert into public.pp_bookings (senior_id, start_at, end_at, type, applicant_name, applicant_email, applicant_phone)
      values (sen, (pg_temp.slot(8, '10:00'))::timestamptz, (pg_temp.slot(8, '10:30'))::timestamptz, '1:1', 'Owner', 'o-owner@example.invalid', '+919100000040')
      returning id::text into s;

      r := pg_temp.call_as(u, format('select public.pp_booking_by_id(%L::uuid)', id1));
      t_name := t_name || text 'O owner can view own booking'; t_det := t_det || left(r::text, 120); t_pass := t_pass || (r->>'id' = id1);
      r := pg_temp.call_as(u2, format('select public.pp_booking_by_id(%L::uuid)', id1));
      t_name := t_name || text 'O another user gets nothing (same as not found)'; t_det := t_det || r::text; t_pass := t_pass || (r = 'null'::jsonb);
      r := pg_temp.call_as(adm, format('select public.pp_booking_by_id(%L::uuid)', id1));
      t_name := t_name || text 'O admin can view any booking'; t_det := t_det || left(r::text, 60); t_pass := t_pass || (r->>'id' = id1);
      r := pg_temp.call_as(u, format('select public.pp_booking_by_id(%L::uuid)', s));
      t_name := t_name || text 'O legacy no-login booking is admin-only (owner by email sees nothing)'; t_det := t_det || r::text; t_pass := t_pass || (r = 'null'::jsonb);
      r := pg_temp.call_as(adm, format('select public.pp_booking_by_id(%L::uuid)', s));
      t_name := t_name || text 'O admin can still view legacy booking'; t_det := t_det || left(r::text, 60); t_pass := t_pass || (r->>'id' = s);
      r := pg_temp.call_as(null, format('select public.pp_booking_by_id(%L::uuid)', id1), true);
      t_name := t_name || text 'O anon cannot run pp_booking_by_id'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');

      r := pg_temp.call_as(u, 'select public.pp_my_bookings()');
      t_name := t_name || text 'O my bookings: only own login bookings'; t_det := t_det || (jsonb_array_length(r) || ' items');
      t_pass := t_pass || (jsonb_array_length(r) = 1 and r->0->>'id' = id1);
      r := pg_temp.call_as(u2, 'select public.pp_my_bookings()');
      t_name := t_name || text 'O my bookings: other user sees none'; t_det := t_det || r::text; t_pass := t_pass || (r = '[]'::jsonb);
      r := pg_temp.call_as(null, 'select public.pp_my_bookings()', true);
      t_name := t_name || text 'O anon cannot run pp_my_bookings'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');

      r := pg_temp.call_as(u2, format('select public.pp_give_feedback(%L::uuid, 5, true, false, ''x'')', id1));
      t_name := t_name || text 'O another user cannot leave feedback'; t_det := t_det || r::text; t_pass := t_pass || (r->>'error' = 'not_found');

      r := pg_temp.call_as(u2, format('select public.pp_cancel(%L::uuid)', id1));
      select status into mode from public.pp_bookings where id = id1::uuid;
      t_name := t_name || text 'O another user cannot cancel'; t_det := t_det || (r::text || ' status=' || mode); t_pass := t_pass || (r->>'error' = 'not_found' and mode = 'confirmed');
      r := pg_temp.call_as(u, format('select public.pp_cancel(%L::uuid)', s));
      t_name := t_name || text 'O owner cannot cancel a legacy booking'; t_det := t_det || r::text; t_pass := t_pass || (r->>'error' = 'not_found');
      r := pg_temp.call_as(null, format('select public.pp_cancel(%L::uuid)', id1), true);
      t_name := t_name || text 'O anon cannot run pp_cancel'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(u, format('select public.pp_cancel(%L::uuid)', id1));
      select status into mode from public.pp_bookings where id = id1::uuid;
      t_name := t_name || text 'O owner can cancel own booking'; t_det := t_det || (r::text || ' status=' || mode); t_pass := t_pass || ((r->>'ok')::boolean and mode = 'cancelled');
      r := pg_temp.call_as(u, format('select public.pp_cancel(%L::uuid)', gen_random_uuid()));
      t_name := t_name || text 'O cancel unknown id -> not_found'; t_det := t_det || r::text; t_pass := t_pass || (r->>'error' = 'not_found');
      raise exception using errcode = 'ZUNDO';
    exception when sqlstate 'ZUNDO' then null;
    end;

    -- ════ review hardening (0035) ════
    begin
      u := pg_temp.mk_user('h-svc@example.invalid', '+919100000060');
      insert into public.pp_book_attempts (user_id, code) values (u, 'OK');
      begin
        set local role service_role;
        begin update public.pp_book_attempts set code = 'X' where user_id = u; s := 'updated'; exception when others then s := sqlstate; end;
        reset role;
      end;
      t_name := t_name || text 'H service role cannot edit the attempt log'; t_det := t_det || s; t_pass := t_pass || (s = '42501');
      begin
        set local role service_role;
        begin delete from public.pp_book_attempts where user_id = u; s := 'deleted'; exception when others then s := sqlstate; end;
        reset role;
      end;
      t_name := t_name || text 'H service role cannot delete from the attempt log'; t_det := t_det || s; t_pass := t_pass || (s = '42501');
      begin
        set local role service_role;
        begin perform count(*) from public.pp_rate_limits; s := 'read'; exception when others then s := sqlstate; end;
        reset role;
      end;
      t_name := t_name || text 'H service role has no direct access to pp_rate_limits'; t_det := t_det || s; t_pass := t_pass || (s = '42501');
      begin
        set local role service_role;
        begin insert into public.pp_book_attempts (user_id, code, source) values (u, 'RATE_LIMITED', 'route'); s := 'inserted'; exception when others then s := sqlstate; end;
        reset role;
      end;
      t_name := t_name || text 'H service role can still append to the attempt log (route IP blocks)'; t_det := t_det || s; t_pass := t_pass || (s = 'inserted');

      delete from public.app_flags where key = 'environment';
      perform set_config('vedam.allow_simulated_payments', 'on', true);
      begin
        insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider) values (u, now(), 'sim-x', 'simulated');
        s := 'inserted';
      exception when others then s := sqlstate;
      end;
      perform set_config('vedam.allow_simulated_payments', '', true);
      t_name := t_name || text 'H simulated payment refused without the staging marker (even with the switch on)'; t_det := t_det || s; t_pass := t_pass || (s = '42501');

      insert into public.pp_book_attempts (user_id, code, created_at) values (u, 'OLD', now() - interval '91 days'), (u, 'RECENT', now() - interval '89 days');
      insert into public.pp_rate_limits (key, window_start, count) values ('h-old:' || u, now() - interval '3 days', 1), ('h-new:' || u, now(), 1);
      perform public.pp_cleanup_logs();
      select count(*) filter (where code = 'OLD'), count(*) filter (where code = 'RECENT') into n, n2 from public.pp_book_attempts where user_id = u;
      t_name := t_name || text 'H cleanup removes attempts older than 90 days, keeps newer'; t_det := t_det || (n || ' old / ' || n2 || ' recent'); t_pass := t_pass || (n = 0 and n2 = 1);
      select count(*) filter (where key like 'h-old:%'), count(*) filter (where key like 'h-new:%') into n, n2 from public.pp_rate_limits where key like 'h-%:' || u;
      t_name := t_name || text 'H cleanup removes stale rate-limit rows, keeps current'; t_det := t_det || (n || ' stale / ' || n2 || ' current'); t_pass := t_pass || (n = 0 and n2 = 1);
      r := pg_temp.call_as(u, 'select to_jsonb(public.pp_cleanup_logs())');
      t_name := t_name || text 'H logged-in user cannot run the cleanup'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');

      -- phone optional (0035): NULL allowed, but a bad phone is still refused by the format check
      select is_nullable into s from information_schema.columns
       where table_schema = 'public' and table_name = 'pp_bookings' and column_name = 'applicant_phone';
      begin
        insert into public.pp_bookings (senior_id, start_at, end_at, type, applicant_name, applicant_email, applicant_phone)
        values (sen, now() + interval '20 days', now() + interval '20 days 30 minutes', '1:1', 'Bad Phone', 'h-badphone@example.invalid', 'abc');
        ok := false; id1 := 'inserted';
      exception
        when check_violation then ok := true; id1 := 'check_violation';
        when others then ok := false; id1 := sqlstate || ' ' || sqlerrm;
      end;
      t_name := t_name || text 'H applicant_phone: NULL allowed, bad format still refused'; t_det := t_det || ('nullable=' || s || ' bad=' || id1);
      t_pass := t_pass || (s = 'YES' and ok);
      raise exception using errcode = 'ZUNDO';
    exception when sqlstate 'ZUNDO' then null;
    end;

    -- ════ pp_my_contact (0034): what the booking page shows = what pp_book stores ════
    begin
      perform pg_temp.set_mode('registered');
      u := pg_temp.mk_user('c-login@example.invalid', '+919100000050');
      perform pg_temp.mk_app(u, 'Contact App Name', 'c-app@example.invalid', '+91 91000-00051');
      u2 := pg_temp.mk_user('c-profile@example.invalid', '+919100000052');
      perform pg_temp.mk_app(u2, '', null, null);

      r := pg_temp.call_as(u, 'select public.pp_my_contact()');
      r2 := pg_temp.book_as(u, jsonb_build_object('seniorId', sen, 'start', pg_temp.slot(9, '10:00'), 'type', '1:1', 'duration', 30));
      select jsonb_build_object('name', applicant_name, 'email', applicant_email, 'phone', applicant_phone) into body
        from public.pp_bookings where id = (r2->>'id')::uuid;
      t_name := t_name || text 'C contact shown = contact stored (verified login email/phone, application name)'; t_det := t_det || (r::text || ' vs ' || coalesce(body::text, 'no booking'));
      t_pass := t_pass || (r->>'name' = body->>'name' and r->>'email' = body->>'email' and r->>'phone' = body->>'phone' and (r->>'complete')::boolean
                           and r->>'email' = 'c-login@example.invalid' and r->>'phone' = '+919100000050' and r->>'name' = 'Contact App Name');

      r := pg_temp.call_as(u2, 'select public.pp_my_contact()');
      r2 := pg_temp.book_as(u2, jsonb_build_object('seniorId', sen, 'start', pg_temp.slot(9, '11:00'), 'type', '1:1', 'duration', 30));
      select jsonb_build_object('name', applicant_name, 'email', applicant_email, 'phone', applicant_phone) into body
        from public.pp_bookings where id = (r2->>'id')::uuid;
      t_name := t_name || text 'C contact shown = contact stored (no name anywhere -> Applicant)'; t_det := t_det || (r::text || ' vs ' || coalesce(body::text, 'no booking'));
      t_pass := t_pass || (r->>'email' = body->>'email' and r->>'phone' = body->>'phone' and r->>'name' = body->>'name' and r->>'email' = 'c-profile@example.invalid' and r->>'name' = 'Applicant');

      adm := pg_temp.mk_user('c-nophone@example.invalid', null);
      r := pg_temp.call_as(adm, 'select public.pp_my_contact()');
      t_name := t_name || text 'C no phone, verified email -> complete = true (phone optional)'; t_det := t_det || r::text;
      t_pass := t_pass || (r->>'complete' = 'true' and r->>'phone' is null and r->>'email' = 'c-nophone@example.invalid');

      adm := pg_temp.mk_user('c-emailunv@example.invalid', '+919100000053', false, true);
      r := pg_temp.call_as(adm, 'select public.pp_my_contact()');
      t_name := t_name || text 'C email not verified -> complete = false, email hidden, verified phone shown'; t_det := t_det || r::text;
      t_pass := t_pass || (r->>'complete' = 'false' and r->>'email' is null and r->>'phone' = '+919100000053');

      r := pg_temp.call_as(null, 'select public.pp_my_contact()', true);
      t_name := t_name || text 'C anon cannot run pp_my_contact'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(null, 'select public.pp_my_contact()');
      t_name := t_name || text 'C no login -> nothing'; t_det := t_det || r::text; t_pass := t_pass || (r = 'null'::jsonb);
      raise exception using errcode = 'ZUNDO';
    exception when sqlstate 'ZUNDO' then null;
    end;

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select * from pg_temp.run_peerpath_vsat_tests();
