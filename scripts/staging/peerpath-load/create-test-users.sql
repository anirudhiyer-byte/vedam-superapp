-- STAGING ONLY · create PeerPath load-test users (default 1,000) + one load-test senior.
--
-- Users:  pp-load-0001@example.invalid … pp-load-1000@example.invalid
--         (.invalid can never receive mail; no OTP/email/SMS is sent: rows are inserted
--          directly, Supabase Auth never runs a sign-up flow)
--         ids are deterministic: md5('pp-load-<n>') shaped as a uuid — mint-tokens.mjs
--         computes the same ids, so no list has to be exported.
-- Each user has a lead_manager row + an application_manager row (= "registered"),
-- a phone and an email, and NO vsat_payments row (= unpaid).
-- Senior:  "PPLoad", id = md5('pp-load-senior'), free every day 00:00–23:30.
--
-- Remove everything with cleanup-test-users.sql.

do $$
declare
  n_users int := 1000;      -- ← change if needed
  i int;
  v_uid uuid;
  v_sen uuid := (select (substr(h,1,8)||'-'||substr(h,9,4)||'-4'||substr(h,14,3)||'-8'||substr(h,18,3)||'-'||substr(h,21,12))::uuid
                 from (select md5('pp-load-senior') h) x);
begin
  if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
    raise exception 'Refusing to run: this is not the staging database (app_flags.environment <> staging).';
  end if;

  for i in 1..n_users loop
    v_uid := (select (substr(h,1,8)||'-'||substr(h,9,4)||'-4'||substr(h,14,3)||'-8'||substr(h,18,3)||'-'||substr(h,21,12))::uuid
              from (select md5('pp-load-' || i) h) x);
    insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
    values (v_uid, 'pp-load-' || lpad(i::text, 4, '0') || '@example.invalid', 'authenticated', 'authenticated', now(), '{}'::jsonb)
    on conflict (id) do nothing;
    insert into public.profiles (id, email) values (v_uid, 'pp-load-' || lpad(i::text, 4, '0') || '@example.invalid')
    on conflict (id) do nothing;
    insert into public.lead_manager (lead_id) values (v_uid) on conflict (lead_id) do nothing;
    insert into public.application_manager (application_id, lead_id, registered_name, registered_email, registered_mobile)
    values ('PPLOAD-' || lpad(i::text, 4, '0'), v_uid, 'Load Test ' || i,
            'pp-load-' || lpad(i::text, 4, '0') || '@example.invalid', '+9190' || lpad(i::text, 8, '0'))
    on conflict (application_id) do nothing;
  end loop;

  -- 5 users with NO application (case 3 "not registered"): pp-load-9001 … pp-load-9005
  for i in 9001..9005 loop
    v_uid := (select (substr(h,1,8)||'-'||substr(h,9,4)||'-4'||substr(h,14,3)||'-8'||substr(h,18,3)||'-'||substr(h,21,12))::uuid
              from (select md5('pp-load-' || i) h) x);
    insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
    values (v_uid, 'pp-load-' || i || '@example.invalid', 'authenticated', 'authenticated', now(), '{}'::jsonb)
    on conflict (id) do nothing;
    insert into public.profiles (id, email, phone) values (v_uid, 'pp-load-' || i || '@example.invalid', '+9199' || lpad(i::text, 8, '0'))
    on conflict (id) do nothing;
  end loop;

  insert into public.pp_seniors (id, first_name, campus, year, contact_email, status, session_types, durations,
                                 daily_cap, weekly_cap, min_notice_hours)
  values (v_sen, 'PPLoad', 'Pune', 2, 'pp-load-senior@example.invalid', 'active', '{1:1,Group}', '{15,30}', 10, 20, 12)
  on conflict (id) do nothing;
  insert into public.pp_availability (senior_id, weekday, from_time, to_time, type)
  select v_sen, d, '00:00', '23:30', t from generate_series(0, 6) d, unnest(array['1:1', 'Group']) t
  where not exists (select 1 from public.pp_availability a where a.senior_id = v_sen);

  raise notice 'Load-test users: %, senior: %', n_users, v_sen;
end $$;

select (select count(*) from auth.users where email like 'pp-load-%@example.invalid') as load_users,
       (select count(*) from public.application_manager where application_id like 'PPLOAD-%') as applications,
       (select id from public.pp_seniors where contact_email = 'pp-load-senior@example.invalid') as load_senior;
