-- Growth → Campaigns + Season Dashboard · tests for migration 0120 (STAGING ONLY)
--
-- 0120: a campaign no longer needs an exam date, and the Season Dashboard counts Paid and Enrolments of a
-- campaign by the campaign's own start and end dates (the same rule as a plain date range, as on the CRM).
-- How to run: apply 0120 on staging, then paste this whole file into the staging SQL editor (or the Supabase MCP).
-- The last statement returns one row per test: test | pass | detail. Everything is rolled back at the end (ZDONE).
-- Fake data only (@example.invalid, ZZTEST names), dated 2090. Refuses to run unless app_flags.environment = 'staging'.

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

create or replace function pg_temp.run_campaign_exam_optional_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; staff uuid; l1 uuid; l2 uuid; l3 uuid; l4 uuid; e1 uuid; ca uuid; cb uuid; c1 uuid; c2 uuid;
  r jsonb; r2 jsonb; d jsonb; n int;
begin
  begin -- rolled back at the end (ZDONE)
    if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
      raise exception 'Refusing to run: this is not the staging database.';
    end if;
    adm := pg_temp.mk_user('zztest-ceo-admin@example.invalid');
    insert into public.user_roles (user_id, role) values (adm, 'admin');
    staff := pg_temp.mk_user('zztest-ceo-staff@vedam.org');   -- @vedam.org but not an admin

    -- ════ A. the column and who may use the functions ════
    t_name := t_name || text 'A vsat_campaigns.exam_date still exists and is optional (nullable)';
    t_det := t_det || coalesce((select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'vsat_campaigns' and column_name = 'exam_date'), 'missing');
    t_pass := t_pass || coalesce((select is_nullable = 'YES' from information_schema.columns where table_schema = 'public' and table_name = 'vsat_campaigns' and column_name = 'exam_date'), false);
    r := pg_temp.call_as(null, pg_temp.rpc('growth_campaign_save', '{"name":"ZZTEST CEO hack","campaign_start":"2090-01-01","campaign_end":"2090-01-02"}'), true);
    t_name := t_name || text 'A anon cannot save a campaign'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_as(staff, pg_temp.rpc('growth_campaign_save', '{"name":"ZZTEST CEO hack","campaign_start":"2090-01-01","campaign_end":"2090-01-02"}'));
    t_name := t_name || text 'A a @vedam.org login that is not an admin cannot save'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    t_name := t_name || text 'A grants unchanged: save for logged-in only, the window helper for nobody in the browser';
    t_det := t_det || (select string_agg(p.proname || ' ' || coalesce(p.proacl::text, 'null'), ' | ' order by p.proname) from pg_proc p
                        where p.pronamespace = 'public'::regnamespace and p.proname in ('growth_campaign_save', 'growth__season_window'));
    t_pass := t_pass || (not has_function_privilege('anon', 'public.growth_campaign_save(jsonb)', 'execute')
                     and has_function_privilege('authenticated', 'public.growth_campaign_save(jsonb)', 'execute')
                     and not has_function_privilege('anon', 'public.growth__season_window(jsonb)', 'execute')
                     and not has_function_privilege('authenticated', 'public.growth__season_window(jsonb)', 'execute'));
    t_name := t_name || text 'A both functions are still SECURITY DEFINER with search_path empty';
    t_det := t_det || (select string_agg(p.proname || ' ' || p.prosecdef::text || ' ' || coalesce(p.proconfig::text, 'null'), ' | ' order by p.proname) from pg_proc p
                        where p.pronamespace = 'public'::regnamespace and p.proname in ('growth_campaign_save', 'growth__season_window'));
    t_pass := t_pass || ((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
                           and p.proname in ('growth_campaign_save', 'growth__season_window') and p.prosecdef and p.proconfig = array['search_path=""']) = 2);

    -- ════ B. saving a campaign ════
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_save', '{"name":"ZZTEST CEO One","campaign_start":"2090-05-01","campaign_end":"2090-05-12","budget":"5,00,000","application_target":400}'));
    c1 := (r->>'id')::uuid;
    t_name := t_name || text 'B a campaign is saved without an exam date (stored empty)'; t_det := t_det || r::text;
    t_pass := t_pass || (c1 is not null and coalesce((select exam_date is null and campaign_start = '2090-05-01' and campaign_end = '2090-05-12' and budget = 500000 and application_target = 400
                                                        from public.vsat_campaigns where id = c1), false));
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_save', '{"name":"ZZTEST CEO Two","campaign_start":"2090-06-01","campaign_end":"2090-06-10","exam_date":"2090-06-20"}'));
    c2 := (r->>'id')::uuid;
    t_name := t_name || text 'B the old form (it still sends an exam date) keeps working and the date is stored'; t_det := t_det || r::text;
    t_pass := t_pass || (c2 is not null and coalesce((select exam_date = '2090-06-20' from public.vsat_campaigns where id = c2), false));
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_save', jsonb_build_object('id', c2, 'name', 'ZZTEST CEO Two', 'campaign_start', '2090-06-01', 'campaign_end', '2090-06-11', 'budget', 100)));
    t_name := t_name || text 'B an edit from the new form (no exam date key) keeps the stored exam date'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'id' = c2::text and coalesce((select exam_date = '2090-06-20' and campaign_end = '2090-06-11' and budget = 100 from public.vsat_campaigns where id = c2), false));
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_save', jsonb_build_object('id', c2, 'name', 'ZZTEST CEO Two', 'campaign_start', '2090-06-01', 'campaign_end', '2090-06-11', 'exam_date', '2090-06-25')));
    t_name := t_name || text 'B an edit that sends an exam date changes it'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'id' = c2::text and coalesce((select exam_date = '2090-06-25' from public.vsat_campaigns where id = c2), false));
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_save', jsonb_build_object('id', c2, 'name', 'ZZTEST CEO Two', 'campaign_start', '2090-06-01', 'campaign_end', '2090-06-11', 'exam_date', '')));
    t_name := t_name || text 'B an edit that sends the exam date empty clears it'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'id' = c2::text and coalesce((select exam_date is null from public.vsat_campaigns where id = c2), false));
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_save', '{"name":"ZZTEST CEO bad","campaign_start":"2090-06-01","campaign_end":"2090-06-10","exam_date":"2090-31-06"}'));
    t_name := t_name || text 'B a malformed exam date is still refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: exam_date');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_save', '{"name":"ZZTEST CEO bad","campaign_start":"2090-06-01","campaign_end":"2090-06-10","hack":1}'));
    t_name := t_name || text 'B unknown keys are still refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'UNKNOWN_KEY: hack');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_save', '{"name":"ZZTEST CEO bad","campaign_start":"2090-06-01"}'));
    t_name := t_name || text 'B name, start and end are still required (end missing)'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'REQUIRED: campaign_end');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_save', '{"name":"ZZTEST CEO bad","campaign_start":"2090-06-10","campaign_end":"2090-06-01"}'));
    t_name := t_name || text 'B end before start is still refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: campaign_end');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_campaign_save', '{"name":"zztest ceo one","campaign_start":"2090-07-01","campaign_end":"2090-07-02"}'));
    t_name := t_name || text 'B a duplicate name (any case) is still refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'DUPLICATE');
    select count(*) into n from public.vsat_campaigns where name = 'ZZTEST CEO bad';
    t_name := t_name || text 'B a refused save writes nothing'; t_det := t_det || n::text; t_pass := t_pass || (n = 0);

    -- ════ C. Season Dashboard: a campaign counts by its own dates ════
    -- l1: lead 5 Jan, paid 12 Jan, exam booked on 1 Mar, enrolled 20 Jan
    -- l2: lead 10 Jan, paid 25 Jan, no application (no exam booked)
    -- l4: lead 15 Jan, paid 20 Jan, no application
    -- l3: lead 10 Feb, paid 12 Feb, exam booked on 1 Mar, enrolled 15 Feb   (outside the campaign's dates)
    l1 := pg_temp.mk_user('zztest-ceo-l1@example.invalid'); l2 := pg_temp.mk_user('zztest-ceo-l2@example.invalid');
    l3 := pg_temp.mk_user('zztest-ceo-l3@example.invalid'); l4 := pg_temp.mk_user('zztest-ceo-l4@example.invalid');
    delete from public.lead_manager where lead_id in (l1, l2, l3, l4);
    insert into public.lead_manager (lead_id, registered_name, registered_email, created_at) values
      (l1, 'ZZTEST CEO One',   'zzceo1@example.invalid', '2090-01-05 12:00:00+05:30'),
      (l2, 'ZZTEST CEO Two',   'zzceo2@example.invalid', '2090-01-10 12:00:00+05:30'),
      (l4, 'ZZTEST CEO Four',  'zzceo4@example.invalid', '2090-01-15 12:00:00+05:30'),
      (l3, 'ZZTEST CEO Three', 'zzceo3@example.invalid', '2090-02-10 12:00:00+05:30');
    update public.lead_manager set user_registration_date = created_at where lead_id in (l1, l2, l3, l4);
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at) values
      ('ZZTEST CEO E1', 'ZZTEST-CEO-1', '2090-03-01', '2090-03-01 10:00:00+05:30', '2090-03-01 12:00:00+05:30') returning id into e1;
    -- ca: an old campaign that has an exam date (1 Mar, the day l1 and l3 sit the exam); cb: a new one without
    insert into public.vsat_campaigns (name, campaign_start, campaign_end, exam_date) values ('ZZTEST CEO Old', '2090-01-01', '2090-01-31', '2090-03-01') returning id into ca;
    begin
      insert into public.vsat_campaigns (name, campaign_start, campaign_end) values ('ZZTEST CEO New', '2090-01-01', '2090-01-31') returning id into cb;
    exception when not_null_violation then cb := null;   -- before 0120: the tests that need it fail
    end;
    insert into public.application_manager (application_id, lead_id, application_no, registered_name, exam_date_id, enrollment_stage, enrollment_paid_at, last_updated_date) values
      ('ZZTEST-CEO-APP-1', l1, 'ZZCEOA1', 'ZZTEST CEO One',   e1, 'approved', '2090-01-20 12:00:00+05:30', '2090-01-20 12:00:00+05:30'),
      ('ZZTEST-CEO-APP-3', l3, 'ZZCEOA3', 'ZZTEST CEO Three', e1, 'approved', '2090-02-15 12:00:00+05:30', '2090-02-15 12:00:00+05:30');
    perform set_config('vedam.allow_simulated_payments', 'on', true);
    insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider, amount, currency) values
      (l1, '2090-01-12 12:00:00+05:30', 'ZZTEST-CEO-PAY-1', 'simulated', 500, 'INR'),
      (l2, '2090-01-25 12:00:00+05:30', 'ZZTEST-CEO-PAY-2', 'simulated', 500, 'INR'),
      (l4, '2090-01-20 12:00:00+05:30', 'ZZTEST-CEO-PAY-4', 'simulated', 500, 'INR'),
      (l3, '2090-02-12 12:00:00+05:30', 'ZZTEST-CEO-PAY-3', 'simulated', 500, 'INR');

    r2 := pg_temp.call_as(adm, pg_temp.rpc('growth_season_counts', '{"from":"2090-01-01","to":"2090-01-31"}'));
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_counts', jsonb_build_object('campaign_id', ca)));
    t_name := t_name || text 'C campaign with an old exam date: Leads 3, Paid 3, Enrolments 1 — all by the campaign''s dates (the exam date is ignored)';
    t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'leads')::int = 3 and (r->>'paid')::int = 3 and (r->>'enrolled')::int = 1 and r->>'locked' = 'true'
                         and r->>'campaign' = 'ZZTEST CEO Old' and r->>'from' = '2090-01-01' and r->>'to' = '2090-01-31');
    t_name := t_name || text 'C campaign numbers = the same dates typed by hand'; t_det := t_det || (r::text || ' / ' || r2::text);
    t_pass := t_pass || (r->>'leads' = r2->>'leads' and r->>'paid' = r2->>'paid' and r->>'enrolled' = r2->>'enrolled' and (r2->>'paid')::int = 3);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_counts', jsonb_build_object('campaign_id', cb)));
    t_name := t_name || text 'C campaign without an exam date: the same Leads 3, Paid 3, Enrolments 1'; t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'leads')::int = 3 and (r->>'paid')::int = 3 and (r->>'enrolled')::int = 1 and r->>'locked' = 'true' and r->>'campaign' = 'ZZTEST CEO New');

    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_counts', jsonb_build_object('campaign_id', ca)));
    d := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jsonb_build_object('kind', 'paid', 'campaign_id', ca)));
    t_name := t_name || text 'C Paid list of a campaign = the card (3)'; t_det := t_det || (coalesce(r->>'paid', r::text) || ' vs ' || coalesce(d->>'total', d::text));
    t_pass := t_pass || ((d->>'total')::int = 3 and (r->>'paid')::int = 3);
    t_name := t_name || text 'C a lead who paid in the campaign but has no exam booked is in the Paid list';
    t_det := t_det || coalesce((select string_agg(x->>'registered_email', ', ' order by x->>'registered_email') from jsonb_array_elements(d->'rows') x), d::text);
    t_pass := t_pass || coalesce(exists (select 1 from jsonb_array_elements(d->'rows') x where x->>'registered_email' = 'zzceo2@example.invalid'), false);
    t_name := t_name || text 'C a lead who paid after the campaign is not in the Paid list, even with the exam on the old exam date';
    t_det := t_det || coalesce((select string_agg(x->>'registered_email', ', ' order by x->>'registered_email') from jsonb_array_elements(d->'rows') x), d::text);
    t_pass := t_pass || coalesce((d->>'total')::int = 3 and not exists (select 1 from jsonb_array_elements(d->'rows') x where x->>'registered_email' = 'zzceo3@example.invalid'), false);
    d := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jsonb_build_object('kind', 'enrolled', 'campaign_id', ca)));
    t_name := t_name || text 'C Enrolments list of a campaign = the card (1)'; t_det := t_det || (coalesce(r->>'enrolled', r::text) || ' vs ' || coalesce(d->>'total', d::text));
    t_pass := t_pass || ((d->>'total')::int = 1 and (r->>'enrolled')::int = 1);
    d := pg_temp.call_as(adm, pg_temp.rpc('growth_season_drill', jsonb_build_object('kind', 'leads', 'campaign_id', ca)));
    t_name := t_name || text 'C Leads list of a campaign = the card (3)'; t_det := t_det || (coalesce(r->>'leads', r::text) || ' vs ' || coalesce(d->>'total', d::text));
    t_pass := t_pass || ((d->>'total')::int = 3 and (r->>'leads')::int = 3);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_counts', jsonb_build_object('campaign_id', ca, 'from', '2090-01-01')));
    t_name := t_name || text 'C a campaign together with dates is still refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: from');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_season_counts', jsonb_build_object('campaign_id', gen_random_uuid())));
    t_name := t_name || text 'C an unknown campaign is still NOT_FOUND'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'NOT_FOUND');

    -- ════ D. the other Growth pages work with a campaign that has no exam date ════
    r := pg_temp.call_as(adm, 'select public.growth_campaigns_list()');
    t_name := t_name || text 'D Campaigns list shows it (exam date empty)';
    t_det := t_det || coalesce((select x::text from jsonb_array_elements(case when jsonb_typeof(r) = 'array' then r else '[]'::jsonb end) x where x->>'id' = cb::text), left(r::text, 150));
    t_pass := t_pass || (jsonb_typeof(r) = 'array' and exists (select 1 from jsonb_array_elements(r) x where x->>'id' = cb::text and x ? 'exam_date' and x->>'exam_date' is null));
    r := pg_temp.call_as(adm, 'select public.growth_mkt_meta()');
    t_name := t_name || text 'D Ads / Influencers campaign dropdown shows it'; t_det := t_det || left(r::text, 150);
    t_pass := t_pass || coalesce(exists (select 1 from jsonb_array_elements(r->'campaigns') x where x->>'id' = cb::text and x->>'exam_date' is null), false);
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_vcamp_report', jsonb_build_object('campaign_id', cb)));
    t_name := t_name || text 'D VSAT Campaign Report opens for it'; t_det := t_det || left(r::text, 150); t_pass := t_pass || (cb is not null and r->>'sqlstate' is null and jsonb_typeof(r) = 'object');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_cohort_report', jsonb_build_object('campaign_id', cb)));
    t_name := t_name || text 'D Payment Cohort opens for it'; t_det := t_det || left(r::text, 150); t_pass := t_pass || (cb is not null and r->>'sqlstate' is null and jsonb_typeof(r) = 'object');
    r := pg_temp.call_as(adm, pg_temp.rpc('growth_perf', jsonb_build_object('channel', 'ads', 'campaign_ids', jsonb_build_array(cb))));
    t_name := t_name || text 'D Ad Performance opens for it'; t_det := t_det || left(r::text, 150); t_pass := t_pass || (cb is not null and r->>'sqlstate' is null and jsonb_typeof(r->'rows') = 'array');

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;
  return query select * from unnest(t_name, t_pass, t_det);
end $$;

select * from pg_temp.run_campaign_exam_optional_tests();
