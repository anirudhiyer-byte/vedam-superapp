-- Growth → VSAT Campaign Report · tests for migration 0116 (STAGING ONLY)
--
-- How to run: apply 0116 on staging first, then paste this whole file into the staging SQL editor
-- or run it through the Supabase MCP. The last statement returns one row per test: test | pass | detail.
-- Everything is created inside a block that is rolled back at the end (ZDONE): nothing stays.
-- Fake data only (@example.invalid, ZZTEST names), all dated in the year 2090 so real rows never mix in.
-- "Today" is passed to the private helper so the windows are fixed; the public function uses the real IST date.
-- It refuses to run unless app_flags.environment = 'staging'.

create or replace function pg_temp.mk_user(p_email text)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  values (v, p_email, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id, email, full_name) values (v, p_email, 'ZZTEST ' || split_part(p_email, '@', 1))
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
  return v;
end $$;

create or replace function pg_temp.call_as(p_uid uuid, p_sql text, p_anon boolean default false)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  if p_anon then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    set local role anon;
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
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

create or replace function pg_temp.rpc(p_fn text, p jsonb)
returns text language sql as $$ select format('select public.%I(%L::jsonb)', p_fn, p::text) $$;

-- one lead (a lead is a profile: lead_manager.lead_id → profiles.id), registered at p_at, with an optional payment
create or replace function pg_temp.mk_lead(p_tag text, p_email text, p_campus text, p_at timestamptz,
                                           p_paid_at timestamptz default null, p_app_campus text default null)
returns uuid language plpgsql as $$
declare v uuid := pg_temp.mk_user('zztest-vcamp-' || p_tag || '@example.invalid');
begin
  delete from public.lead_manager where lead_id = v;   -- in case a sign-up trigger already made an empty row
  insert into public.lead_manager (lead_id, registered_name, registered_email, campus_preference, created_at, user_registration_date)
  values (v, 'ZZTEST ' || p_tag, p_email, p_campus, p_at, p_at);
  if p_paid_at is not null then
    insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider, amount, currency)
    values (v, p_paid_at, 'ZZTEST-VCAMP-' || p_tag, 'simulated', 500, 'INR');
  end if;
  if p_app_campus is not null then
    insert into public.application_manager (application_id, lead_id, application_no, registered_name, campus_applied)
    values ('ZZTEST-VCAMP-' || p_tag, v, 'ZZV' || p_tag, 'ZZTEST ' || p_tag, p_app_campus);
  end if;
  return v;
end $$;

create or replace function pg_temp.split(r jsonb, k text) returns text language sql as $$
  select format('%s/%s/%s/%s', r->'rows'->k->>'total', r->'rows'->k->>'ggn', r->'rows'->k->>'pune', r->'rows'->k->>'other') $$;

create or replace function pg_temp.run_vcamp_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; staff uuid; r jsonb; camp uuid; c_one uuid; c_end uuid; c_fut uuid; c_new uuid; x uuid;
  gg constant text := 'Sushant University — Gurugram';
  pu constant text := 'Ajeenkya DY Patil University — Pune';
begin
  begin -- rolled back at the end (ZDONE)
    if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
      raise exception 'Refusing to run: this is not the staging database.';
    end if;
    adm := pg_temp.mk_user('zztest-vcamp-admin@example.invalid');
    insert into public.user_roles (user_id, role) values (adm, 'admin');
    staff := pg_temp.mk_user('zztest-vcamp-staff@vedam.org');   -- @vedam.org but not an admin

    -- ── fake campaign: 2090-06-01 .. 2090-06-20, target 10; "today" in the tests = 2090-06-10 (IST) ──
    insert into public.vsat_campaigns (name, campaign_start, campaign_end, exam_date, application_target)
      values ('ZZTEST VCR Main', '2090-06-01', '2090-06-20', '2090-06-25', 10) returning id into camp;
    perform set_config('vedam.allow_simulated_payments', 'on', true);

    -- leads (IST registration times) · payments (IST paid times) · campus
    perform pg_temp.mk_lead('a', 'zz-a@example.invalid', gg, '2090-06-10 09:00+05:30');                                  -- today, GGN
    perform pg_temp.mk_lead('b', 'zz-b@example.invalid', pu, '2090-06-10 00:00+05:30');                                  -- today 00:00 IST (UTC: Jun 9), Pune
    perform pg_temp.mk_lead('c', 'zz-c@example.invalid', null, '2090-06-09 23:59+05:30');                                -- yesterday, no campus
    perform pg_temp.mk_lead('d', 'zz-d@vedam.org', gg, '2090-06-10 10:00+05:30');                                        -- @vedam.org: never a lead
    perform pg_temp.mk_lead('e', 'zz-e@VEDAM.ORG', pu, '2090-06-09 10:00+05:30');                                        -- @vedam.org any case: never a lead
    perform pg_temp.mk_lead('f', null, '', '2090-06-02 10:00+05:30');                                                    -- no email: still a lead, campus ''
    perform pg_temp.mk_lead('g', 'zz-g@example.invalid', gg, '2090-05-31 23:59+05:30');                                  -- day before the campaign
    perform pg_temp.mk_lead('h', 'zz-h@example.invalid', pu, '2090-06-11 00:00+05:30');                                  -- tomorrow (after "today")
    -- payments: paid campus = application campus, else the lead's campus
    perform pg_temp.mk_lead('p1', 'zz-p1@example.invalid', null, '2090-05-01 10:00+05:30', '2090-06-10 11:00+05:30', gg); -- paid today, app GGN
    perform pg_temp.mk_lead('p2', 'zz-p2@example.invalid', pu,   '2090-05-01 10:00+05:30', '2090-06-09 11:00+05:30');     -- paid yesterday, lead Pune
    perform pg_temp.mk_lead('p3', 'zz-p3@example.invalid', gg,   '2090-05-01 10:00+05:30', '2090-06-08 11:00+05:30', pu); -- paid -2d, app Pune wins
    perform pg_temp.mk_lead('p4', 'zz-p4@vedam.org',       null, '2090-05-01 10:00+05:30', '2090-06-07 11:00+05:30', '');  -- paid -3d, no campus; vedam.org still counts as paid
    perform pg_temp.mk_lead('p5', 'zz-p5@example.invalid', gg,   '2090-05-01 10:00+05:30', '2090-06-06 11:00+05:30');     -- paid -4d (outside last 3 days)
    perform pg_temp.mk_lead('p6', 'zz-p6@example.invalid', gg,   '2090-05-01 10:00+05:30', '2090-05-31 23:00+05:30');     -- paid before the campaign
    perform pg_temp.mk_lead('p7', 'zz-p7@example.invalid', gg,   '2090-05-01 10:00+05:30', '2090-06-11 10:00+05:30');     -- paid after "today"
    -- a payment whose lead is not in lead_manager is never counted (same rule as the Season Dashboard, 0109)
    x := pg_temp.mk_user('zztest-vcamp-ghost@example.invalid');
    delete from public.lead_manager where lead_id = x;
    insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider, amount, currency)
      values (x, '2090-06-10 12:00+05:30', 'ZZTEST-VCAMP-ghost', 'simulated', 500, 'INR');

    -- ════ A. who may use it ════
    r := pg_temp.call_as(null, pg_temp.rpc('growth_vcamp_report', '{}'), true);
    t_name := t_name || text 'A anon cannot read the report'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_as(staff, pg_temp.rpc('growth_vcamp_report', '{}'));
    t_name := t_name || text 'A a @vedam.org login that is not an admin is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(adm, 'select public.growth__vcamp_data(gen_random_uuid(), ''2090-06-10'')');
    t_name := t_name || text 'A private helper growth__vcamp_data is not callable by a browser role'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_as(adm, 'select to_jsonb(count(*)) from public.growth__paid_rows(''2090-06-01'', ''2090-06-20'')');
    t_name := t_name || text 'A private helper growth__paid_rows is not callable by a browser role'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_as(adm, 'select to_jsonb(count(*)) from public.growth__lead_rows(''2090-06-01'', ''2090-06-20'')');
    t_name := t_name || text 'A private helper growth__lead_rows is not callable by a browser role'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    t_name := t_name || text 'A grants: anon none; authenticated only growth_vcamp_report; helpers closed';
    t_det := t_det || text 'see test';
    t_pass := t_pass || (not has_function_privilege('anon', 'public.growth_vcamp_report(jsonb)', 'execute')
                     and has_function_privilege('authenticated', 'public.growth_vcamp_report(jsonb)', 'execute')
                     and not has_function_privilege('authenticated', 'public.growth__vcamp_data(uuid, date)', 'execute')
                     and not has_function_privilege('authenticated', 'public.growth__vcamp_default(date)', 'execute')
                     and not has_function_privilege('authenticated', 'public.growth__paid_rows(date, date)', 'execute')
                     and not has_function_privilege('authenticated', 'public.growth__lead_rows(date, date)', 'execute')
                     and not has_function_privilege('authenticated', 'public.growth__campus(text)', 'execute')
                     and not has_function_privilege('anon', 'public.growth__campus(text)', 'execute'));
    t_name := t_name || text 'A the 5 SECURITY DEFINER functions all have search_path empty';
    t_det := t_det || text 'see test';
    t_pass := t_pass || ((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
                           and p.proname in ('growth_vcamp_report','growth__vcamp_data','growth__vcamp_default','growth__paid_rows','growth__lead_rows')
                           and p.prosecdef and p.proconfig @> array['search_path=""']) = 5);
    r := pg_temp.call_as(adm, 'select to_jsonb(count(*)) from public.vsat_payments');
    t_name := t_name || text 'A the tables stay closed to the browser role (RLS / no grant)'; t_det := t_det || r::text; t_pass := t_pass || (r::text = '0' or r->>'sqlstate' = '42501');

    -- ════ B. request checks ════
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_vcamp_report', '{"hack":1}'));
    t_name := t_name || text 'B unknown keys are refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'UNKNOWN_KEY: hack');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_vcamp_report', '{"campaign_id":"not-a-real-id"}'));
    t_name := t_name || text 'B a bad campaign id is BAD_VALUE'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: campaign_id');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_vcamp_report', '{"campaign_id":123}'));
    t_name := t_name || text 'B a number as campaign id is BAD_VALUE'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: campaign_id');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_vcamp_report', jsonb_build_object('campaign_id', gen_random_uuid())));
    t_name := t_name || text 'B an unknown campaign is NOT_FOUND'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'NOT_FOUND');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_vcamp_report', jsonb_build_object('campaign_id', repeat('x', 100000))));
    t_name := t_name || text 'B an oversized value is refused, not crashed'; t_det := t_det || left(r::text, 120); t_pass := t_pass || (r->>'message' = 'BAD_VALUE: campaign_id');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_vcamp_report', '[]'));
    t_name := t_name || text 'B a non-object request is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_REQUEST');
    r := pg_temp.call_as(adm, 'select public.growth_vcamp_report(null)');
    t_name := t_name || text 'B no request body works (default campaign)'; t_det := t_det || left(r::text, 160); t_pass := t_pass || (jsonb_typeof(r) = 'object' and r ? 'today' and r ? 'campaign');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_vcamp_report', jsonb_build_object('campaign_id', camp)));
    t_name := t_name || text 'B the public function uses the real IST date as today';
    t_det := t_det || (r->>'today'); t_pass := t_pass || (r->>'today' = ((now() at time zone 'Asia/Kolkata')::date)::text and r->'campaign'->>'id' = camp::text);

    -- ════ C. the numbers (today = 2090-06-10) ════
    r := public.growth__vcamp_data(camp, '2090-06-10');
    t_name := t_name || text 'C campaign block: name, dates, target'; t_det := t_det || (r->'campaign')::text;
    t_pass := t_pass || (r->'campaign'->>'name' = 'ZZTEST VCR Main' and r->'campaign'->>'campaign_start' = '2090-06-01'
                         and r->'campaign'->>'campaign_end' = '2090-06-20' and (r->'campaign'->>'application_target')::int = 10
                         and r->>'today' = '2090-06-10' and r->>'over' = 'false' and r->>'last3_valid' = 'true');
    t_name := t_name || text 'C achievement = paid 06-01..today: p1 GGN(app), p2 Pune, p3 Pune(app wins), p4 other, p5 GGN = 5/2/2/1';
    t_det := t_det || pg_temp.split(r, 'achievement'); t_pass := t_pass || (pg_temp.split(r, 'achievement') = '5/2/2/1');
    t_name := t_name || text 'C today''s payments = p1 (ghost lead not counted)'; t_det := t_det || pg_temp.split(r, 'today_pay'); t_pass := t_pass || (pg_temp.split(r, 'today_pay') = '1/1/0/0');
    t_name := t_name || text 'C yesterday''s payments = p2'; t_det := t_det || pg_temp.split(r, 'yday_pay'); t_pass := t_pass || (pg_temp.split(r, 'yday_pay') = '1/0/1/0');
    t_name := t_name || text 'C last 3 days = 06-07..06-09 (not today): p2, p3, p4'; t_det := t_det || pg_temp.split(r, 'last3_pay'); t_pass := t_pass || (pg_temp.split(r, 'last3_pay') = '3/0/2/1');
    t_name := t_name || text 'C today''s leads = a (GGN) + b (00:00 IST); vedam.org d not counted'; t_det := t_det || pg_temp.split(r, 'today_leads'); t_pass := t_pass || (pg_temp.split(r, 'today_leads') = '2/1/1/0');
    t_name := t_name || text 'C yesterday''s leads = c (23:59 IST, no campus); vedam.org e (any case) not counted'; t_det := t_det || pg_temp.split(r, 'yday_leads'); t_pass := t_pass || (pg_temp.split(r, 'yday_leads') = '1/0/0/1');
    t_name := t_name || text 'C total leads 06-01..today = a, b, c, f (no email, campus '''') = 4/1/1/2; g (day before) and h (tomorrow) not counted';
    t_det := t_det || pg_temp.split(r, 'total_leads'); t_pass := t_pass || (pg_temp.split(r, 'total_leads') = '4/1/1/2');

    -- ════ D. window edges ════
    r := public.growth__vcamp_data(camp, '2090-06-25');   -- 5 days after the end
    t_name := t_name || text 'D ended campaign: over, achievement stops at the end date (p7 counted, it paid 06-11), today/yesterday 0, last 3 days outside';
    t_det := t_det || r::text;
    t_pass := t_pass || (r->>'over' = 'true' and r->>'last3_valid' = 'false' and pg_temp.split(r, 'achievement') = '6/3/2/1'
                         and pg_temp.split(r, 'today_pay') = '0/0/0/0' and pg_temp.split(r, 'yday_pay') = '0/0/0/0'
                         and pg_temp.split(r, 'last3_pay') = '0/0/0/0' and pg_temp.split(r, 'today_leads') = '0/0/0/0'
                         and pg_temp.split(r, 'total_leads') = '5/1/2/2');
    r := public.growth__vcamp_data(camp, '2090-06-21');   -- the day after the end: yesterday is the last day
    t_name := t_name || text 'D day after the end: over; yesterday (06-20) still inside; last 3 days 06-18..06-20 valid';
    t_det := t_det || r::text; t_pass := t_pass || (r->>'over' = 'true' and r->>'last3_valid' = 'true');
    r := public.growth__vcamp_data(camp, '2090-06-01');   -- first day: last 3 days are all before the start
    t_name := t_name || text 'D first day: today counted, yesterday outside (0), last 3 days outside';
    t_det := t_det || r::text; t_pass := t_pass || (r->>'over' = 'false' and r->>'last3_valid' = 'false' and pg_temp.split(r, 'yday_pay') = '0/0/0/0');
    r := public.growth__vcamp_data(camp, '2090-06-02');   -- second day: last 3 days clamp to 06-01..06-01
    t_name := t_name || text 'D second day: last 3 days clamp to the start (06-01 only), valid';
    t_det := t_det || r::text; t_pass := t_pass || (r->>'last3_valid' = 'true');
    r := public.growth__vcamp_data(camp, '2090-05-20');   -- campaign not started yet
    t_name := t_name || text 'D future campaign: everything 0, not over';
    t_det := t_det || r::text;
    t_pass := t_pass || (r->>'over' = 'false' and r->>'last3_valid' = 'false' and pg_temp.split(r, 'achievement') = '0/0/0/0' and pg_temp.split(r, 'total_leads') = '0/0/0/0');
    insert into public.vsat_campaigns (name, campaign_start, campaign_end, exam_date) values ('ZZTEST VCR One', '2090-06-10', '2090-06-10', '2090-06-25') returning id into c_one;
    r := public.growth__vcamp_data(c_one, '2090-06-10');
    t_name := t_name || text 'D one-day campaign on its day: only today counts; target missing → 0';
    t_det := t_det || r::text;
    t_pass := t_pass || (r->>'over' = 'false' and r->>'last3_valid' = 'false' and pg_temp.split(r, 'achievement') = '1/1/0/0'
                         and pg_temp.split(r, 'total_leads') = '2/1/1/0' and (r->'campaign'->>'application_target')::int = 0);

    insert into public.vsat_campaigns (name, campaign_start, campaign_end, exam_date) values ('ZZTEST VCR NoDates', null, null, '2090-06-25') returning id into x;
    r := public.growth__vcamp_data(x, '2090-06-10');
    t_name := t_name || text 'D a campaign without dates: all 0, not over, last 3 days not valid (no error)';
    t_det := t_det || r::text;
    t_pass := t_pass || (r->>'over' = 'false' and r->>'last3_valid' = 'false' and pg_temp.split(r, 'achievement') = '0/0/0/0'
                         and pg_temp.split(r, 'total_leads') = '0/0/0/0' and pg_temp.split(r, 'today_leads') = '0/0/0/0');

    -- ════ E. default campaign (CRM rule) ════
    insert into public.vsat_campaigns (name, campaign_start, campaign_end, exam_date) values ('ZZTEST VCR Ended', '2090-07-01', '2090-07-05', '2090-07-10') returning id into c_end;
    insert into public.vsat_campaigns (name, campaign_start, campaign_end, exam_date) values ('ZZTEST VCR Future', '2090-08-01', '2090-08-10', '2090-08-15') returning id into c_fut;
    t_name := t_name || text 'E running today wins (06-10: Main and One both run; One started later)';
    t_det := t_det || coalesce(public.growth__vcamp_default('2090-06-10')::text, 'null'); t_pass := t_pass || (public.growth__vcamp_default('2090-06-10') = c_one);
    t_name := t_name || text 'E running today wins over a later-started ended campaign (06-15: only Main runs)';
    t_det := t_det || coalesce(public.growth__vcamp_default('2090-06-15')::text, 'null'); t_pass := t_pass || (public.growth__vcamp_default('2090-06-15') = camp);
    t_name := t_name || text 'E nothing running → most recently started (07-20 → Ended, not Future)';
    t_det := t_det || coalesce(public.growth__vcamp_default('2090-07-20')::text, 'null'); t_pass := t_pass || (public.growth__vcamp_default('2090-07-20') = c_end);
    t_name := t_name || text 'E a campaign without dates is never the default';
    t_det := t_det || coalesce(public.growth__vcamp_default('2090-07-20')::text, 'null'); t_pass := t_pass || (public.growth__vcamp_default('2090-07-20') <> x);
    insert into public.vsat_campaigns (name, campaign_start, campaign_end, exam_date) values ('ZZTEST VCR Today', ((now() at time zone 'Asia/Kolkata')::date), ((now() at time zone 'Asia/Kolkata')::date + 1), '2090-12-31') returning id into c_new;
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_vcamp_report', '{}'));
    t_name := t_name || text 'E the public function without an id opens the campaign running today (latest start)';
    t_det := t_det || coalesce(r->'campaign'->>'name', r::text); t_pass := t_pass || (r->'campaign'->>'id' = c_new::text);

    -- ════ F. the public function returns the same numbers as the helper ════
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_vcamp_report', jsonb_build_object('campaign_id', camp)));
    t_name := t_name || text 'F every row has total/ggn/pune/other and total = ggn + pune + other';
    t_det := t_det || (r->'rows')::text;
    t_pass := t_pass || ((select count(*) from jsonb_each(r->'rows') e
                           where (e.value->>'total')::int = (e.value->>'ggn')::int + (e.value->>'pune')::int + (e.value->>'other')::int) = 7);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;
  return query select * from unnest(t_name, t_pass, t_det);
end $$;

select * from pg_temp.run_vcamp_tests();
