-- Growth → Consultants Channel → Consultant Performance · tests for migration 0131 (STAGING ONLY)
--
-- How to run: apply 0130 + 0131 on staging, then paste this whole file into the staging SQL editor (or the Supabase MCP).
-- The last statement returns one row per test: test | pass | detail. Everything is rolled back at the end (ZDONE).
-- Fake data only (ZZTEST names, zzcons* UTMs, ZZCPN* coupons, 2090 dates). Refuses to run unless app_flags.environment = 'staging'.

create or replace function pg_temp.gcp_user(p_email text)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  values (v, p_email, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id, email, full_name) values (v, p_email, 'ZZTEST ' || split_part(p_email, '@', 1))
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
  return v;
end $$;

-- a lead (registered 2090-01-05; paid 2090-01-10; enrolled 2090-01-20) with a first-touch UTM (null source = none),
-- optional paid VSAT fee, order coupon (+ order status), enrolment, application stage, campus text
create or replace function pg_temp.gcp_lead(p_tag text, p_email text, p_src text, p_camp text, p_paid boolean,
                                            p_coupon text default null, p_order text default 'paid', p_enrolled boolean default false,
                                            p_campus text default null)
returns uuid language plpgsql as $$
declare u uuid := pg_temp.gcp_user('zztest-gcp-' || p_tag || '@example.invalid');
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, utm_source, utm_medium, utm_campaign, campus_preference, created_at, user_registration_date)
  values (u, 'ZZTEST GCP ' || p_tag, p_email, p_src, case when p_src is null then null else 'zzmed' end, p_camp, p_campus,
          '2090-01-05 12:00+05:30', '2090-01-05 12:00+05:30')
  on conflict (lead_id) do update set registered_email = excluded.registered_email, utm_source = excluded.utm_source,
    utm_medium = excluded.utm_medium, utm_campaign = excluded.utm_campaign, campus_preference = excluded.campus_preference;
  if p_paid then
    insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider, amount, currency)
    values (u, '2090-01-10 12:00+05:30', 'ZZTEST-GCP-' || p_tag, 'simulated', 500, 'INR');
  end if;
  if p_coupon is not null then
    insert into public.vsat_payment_orders (cf_order_id, lead_id, base_amount, discount, discount_coupon, amount, status)
    values ('ZZTEST-GCP-' || p_tag, u, 1000, 500, p_coupon, 500, p_order);
  end if;
  if p_enrolled then
    insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email)
    values ('ZZGCP-' || p_tag, u, 'ZZGCP-' || p_tag, 'ZZTEST ' || p_tag, 'zztest-gcp-' || p_tag || '@example.invalid');
    update public.application_manager set enrollment_stage = 'approved', enrollment_paid_at = '2090-01-20 12:00+05:30'
     where application_id = 'ZZGCP-' || p_tag;
  end if;
  return u;
end $$;

create or replace function pg_temp.gcp_call(p_uid uuid, p_sql text, p_anon boolean default false)
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

create or replace function pg_temp.gcp_rpc(p_fn text, p jsonb)
returns text language sql as $$ select format('select public.%I(%L::jsonb)', p_fn, p::text) $$;

-- the performance row of one consultant (by name, case-insensitive)
create or replace function pg_temp.gcp_c(p_res jsonb, p_name text)
returns jsonb language sql as $$ select x from jsonb_array_elements(p_res->'consultants') x where lower(x->>'name') = lower(p_name) $$;

create or replace function pg_temp.gcp_fmt(p_c jsonb)
returns text language sql as $$
  select format('%s/%s/%s/%s', p_c->>'leads', p_c->>'apps_utm', p_c->>'apps_coupon', p_c->>'enrolled')
$$;

create or replace function pg_temp.run_growth_cons_perf_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  tn text[] := '{}'; tp boolean[] := '{}'; td text[] := '{}';
  adm uuid; usr uuid; r jsonb; r0 jsonb; x jsonb; s text; n int; r1 uuid; r2 uuid; lead_a uuid; bad int;
  u1 text := 'https://apply.vedam.org/?utm_source=ZZCONS&utm_medium=zzmed&utm_campaign=zz%20one';
  u2 text := 'https://apply.vedam.org/?utm_source=zzcons2&utm_medium=zzmed&utm_campaign=zz%20two';
  pub text[] := array['growth_cons_perf', 'growth_cons_perf_students', 'growth_cons_city_targets_get', 'growth_cons_city_target_set'];
  prv text[] := array['growth__cons_in', 'growth__cons_stage', 'growth__cons_people', 'growth__cons_window'];
begin
  begin -- rolled back at the end (ZDONE)
    if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
      raise exception 'Refusing to run: this is not the staging database.';
    end if;
    perform set_config('vedam.allow_simulated_payments', 'on', true);
    adm := pg_temp.gcp_user('zztest-gcp-admin@example.invalid');
    insert into public.user_roles (user_id, role) values (adm, 'admin');
    usr := pg_temp.gcp_user('zztest-gcp-user@example.invalid');

    -- ════ A. security ════
    for n in 1 .. 4 loop
      r := pg_temp.gcp_call(null, pg_temp.gcp_rpc(pub[n], '{}'), true);
      tn := tn || ('A anon cannot call ' || pub[n]); td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
      r := pg_temp.gcp_call(usr, pg_temp.gcp_rpc(pub[n], case when n = 4 then '{"city":"ZZ","target":1}'::jsonb else '{}'::jsonb end));
      tn := tn || ('A a signed-in non-admin gets FORBIDDEN from ' || pub[n]); td := td || r::text; tp := tp || (r->>'message' = 'FORBIDDEN');
      r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc(pub[n], '{"evil":1}'));
      tn := tn || ('A unknown request keys are refused by ' || pub[n]); td := td || r::text; tp := tp || (r->>'message' = 'UNKNOWN_KEY: evil');
    end loop;
    r := pg_temp.gcp_call(adm, 'select to_jsonb(count(*)) from public.growth__cons_people(null)');
    tn := tn || text 'A private helper growth__cons_people is not callable, even by an admin'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    r := pg_temp.gcp_call(adm, 'select to_jsonb(public.growth__cons_stage(gen_random_uuid()))');
    tn := tn || text 'A private helper growth__cons_stage is not callable, even by an admin'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    r := pg_temp.gcp_call(adm, 'select to_jsonb(count(*)) from public.growth_cons_city_targets');
    tn := tn || text 'A the city targets table is not readable from the browser, even by an admin'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any (pub)
       and p.prosecdef and p.proconfig = array['search_path=""']
       and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute');
    tn := tn || text 'A all 4 RPCs: SECURITY DEFINER, search_path empty, authenticated only'; td := td || n::text; tp := tp || (n = 4);
    select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any (prv)
       and p.proconfig = array['search_path=""']
       and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute');
    tn := tn || text 'A all 4 private helpers: search_path empty, no browser access'; td := td || n::text; tp := tp || (n = 4);
    select count(*) into n from pg_class c where c.oid = 'public.growth_cons_city_targets'::regclass
       and c.relrowsecurity and not exists (select 1 from pg_policy pl where pl.polrelid = c.oid)
       and not has_table_privilege('anon', c.oid, 'select') and not has_table_privilege('authenticated', c.oid, 'select')
       and not has_table_privilege('authenticated', c.oid, 'insert') and not has_table_privilege('authenticated', c.oid, 'update');
    tn := tn || text 'A city targets: RLS on, no policies, no grants'; td := td || n::text; tp := tp || (n = 1);
    select count(*) into n from pg_trigger where tgrelid = 'public.growth_cons_city_targets'::regclass and tgname = 'trg_audit_growth_cons_city_targets';
    tn := tn || text 'A city target changes are audited'; td := td || n::text; tp := tp || (n = 1);

    -- ════ B. request validation ════
    r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_perf', '{"start":"2090-02-01","end":"2090-01-01"}'));
    tn := tn || text 'B start after end is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: start');
    r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_perf', '{"start":"not-a-date"}'));
    tn := tn || text 'B a bad date is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: start');
    r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_perf', '{"campus":"MARS"}'));
    tn := tn || text 'B an unknown campus is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: campus');
    r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_perf_students', '{"end":"31-02-2090"}'));
    tn := tn || text 'B an impossible date (31-02) is refused by the students list too'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: end');
    r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_perf', '{"start":"01-01-2090","end":"2090-12-31","campus":"GGN"}'));
    tn := tn || text 'B DD-MM-YYYY and YYYY-MM-DD both work; window is echoed back'; td := td || coalesce((r->'window')::text, r::text);
    tp := tp || (r->'window' = '{"start":"2090-01-01","end":"2090-12-31","campus":"GGN"}'::jsonb);

    -- ════ C. data: two consultant rows + fake leads ════
    r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_save', jsonb_build_object('row', jsonb_build_object('consultant_name', 'ZZTEST Alpha', 'utm_link', u1,
           'category', 'Associated with Sunstone', 'coupon_code', 'ZZCPN1', 'city', 'ZZ City', 'bdm', 'ZZ BDM', 'enrollment_spend', '150000', 'slab_spend', '25000'))));
    r1 := (r->>'id')::uuid;
    r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_save', jsonb_build_object('row', jsonb_build_object('consultant_name', 'ZZTEST Beta', 'utm_link', u2,
           'category', 'Not Associated with Sunstone', 'coupon_code', 'zzcpn1', 'city', 'ZZ Town'))));
    r2 := (r->>'id')::uuid;
    update public.growth_cons_rows set created_at = now() - interval '2 days' where id = r1;   -- r1 is the older row (owns the shared coupon)
    lead_a := pg_temp.gcp_lead('a', 'zzgcp-a@example.invalid', 'zzcons', 'zz one', true, null, 'paid', true, 'Gurugram Campus');  -- R1 UTM, paid, enrolled, GGN
    perform pg_temp.gcp_lead('b', 'zzgcp-b@example.invalid', 'zzcons', 'zz one', false);                                  -- R1 UTM, not paid
    perform pg_temp.gcp_lead('s', 'zzgcp-s@VEDAM.org', 'zzcons', 'zz one', true);                                          -- staff on R1 UTM
    perform pg_temp.gcp_lead('c', 'zzgcp-c@example.invalid', 'zzother', 'zz x', true, 'zzcpn1', 'paid', true, 'Pune');    -- other UTM, paid with the coupon, enrolled, PUNE
    perform pg_temp.gcp_lead('d', 'zzgcp-d@example.invalid', 'zzcons2', 'zz two', true, 'ZZCPN1');                         -- R2 UTM + coupon: UTM only
    perform pg_temp.gcp_lead('e', 'zzgcp-e@example.invalid', null, null, false, 'ZZCPN1', 'created');                      -- unpaid order
    perform pg_temp.gcp_lead('f', 'zzgcp-f@example.invalid', 'zzother', 'zz x', false, 'ZZCPN1', 'paid');                  -- paid order but no vsat_payments row
    perform pg_temp.gcp_lead('g', 'zzgcp-g@vedam.org', null, null, true, 'ZZCPN1');                                        -- staff with the coupon
    perform pg_temp.gcp_lead('h', 'zzgcp-h@example.invalid', null, null, true, ' zzCpn1 ');                                -- no UTM, coupon with spaces

    r0 := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_perf', '{}'));
    x := pg_temp.gcp_c(r0, 'ZZTEST Alpha');
    tn := tn || text 'C all time, Alpha: 2 leads, 1 UTM app, 2 coupon apps (c, h), 2 enrolments (a, c); staff, unpaid order, no-payment left out';
    td := td || coalesce(pg_temp.gcp_fmt(x), r0::text); tp := tp || (pg_temp.gcp_fmt(x) = '2/1/2/2');
    tn := tn || text 'C Alpha: name, category, city, BDM, spends come through';
    td := td || coalesce(x::text, '');
    tp := tp || (x->>'category' = 'Associated with Sunstone' and x->'cities' = '["ZZ City"]'::jsonb and x->'bdms' = '["ZZ BDM"]'::jsonb
                 and (x->>'enrollment_spend')::numeric = 150000 and (x->>'slab_spend')::numeric = 25000 and (x->>'rows')::int = 1);
    x := pg_temp.gcp_c(r0, 'ZZTEST Beta');
    tn := tn || text 'C all time, Beta: lead d counted once, by UTM; the shared coupon belongs to the older row'; td := td || coalesce(pg_temp.gcp_fmt(x), r0::text);
    tp := tp || (pg_temp.gcp_fmt(x) = '1/1/0/0');
    x := pg_temp.gcp_c(r0, 'ZZTEST Alpha');
    tn := tn || text 'C stages of Alpha''s applications: enrolled 2 + no_application 1, and they add up to the applications';
    td := td || coalesce((x->'stages')::text, '');
    tp := tp || ((x->'stages'->>'enrolled')::int = 2 and (x->'stages'->>'no_application')::int = 1
                 and (select coalesce(sum(v::int), 0) from jsonb_each_text(x->'stages') e(k, v)) = (x->>'apps_utm')::int + (x->>'apps_coupon')::int);

    -- ════ D. periods ════
    r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_perf', '{"start":"2090-01-01","end":"2090-01-07"}'));
    x := pg_temp.gcp_c(r, 'ZZTEST Alpha');
    tn := tn || text 'D period around registration (5 Jan): leads only'; td := td || coalesce(pg_temp.gcp_fmt(x), r::text); tp := tp || (pg_temp.gcp_fmt(x) = '2/0/0/0');
    r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_perf', '{"start":"2090-01-08","end":"2090-01-15"}'));
    x := pg_temp.gcp_c(r, 'ZZTEST Alpha');
    tn := tn || text 'D period around payment (10 Jan): applications only, stages follow the applications'; td := td || coalesce(pg_temp.gcp_fmt(x), r::text);
    tp := tp || (pg_temp.gcp_fmt(x) = '0/1/2/0' and (x->'stages'->>'no_application')::int = 1);
    r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_perf', '{"start":"2090-01-16","end":"2090-01-31"}'));
    x := pg_temp.gcp_c(r, 'ZZTEST Alpha');
    tn := tn || text 'D period around enrolment (20 Jan): enrolments only'; td := td || coalesce(pg_temp.gcp_fmt(x), r::text); tp := tp || (pg_temp.gcp_fmt(x) = '0/0/0/2');
    r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_perf', '{"start":"2090-01-10","end":"2090-01-10"}'));
    x := pg_temp.gcp_c(r, 'ZZTEST Alpha');
    tn := tn || text 'D a one-day period includes that day (start = end)'; td := td || coalesce(pg_temp.gcp_fmt(x), r::text); tp := tp || (pg_temp.gcp_fmt(x) = '0/1/2/0');
    r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_perf', '{"start":"2090-01-06"}'));
    x := pg_temp.gcp_c(r, 'ZZTEST Alpha');
    tn := tn || text 'D open end: from 6 Jan on, no leads'; td := td || coalesce(pg_temp.gcp_fmt(x), r::text); tp := tp || (pg_temp.gcp_fmt(x) = '0/1/2/2');
    r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_perf', '{"start":"2091-01-01","end":"2091-01-31"}'));
    x := pg_temp.gcp_c(r, 'ZZTEST Alpha');
    tn := tn || text 'D a period with nothing in it: the consultant still shows, all zero'; td := td || coalesce(pg_temp.gcp_fmt(x), r::text); tp := tp || (pg_temp.gcp_fmt(x) = '0/0/0/0');

    -- ════ E. campus ════
    r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_perf', '{"campus":"GGN"}'));
    x := pg_temp.gcp_c(r, 'ZZTEST Alpha');
    tn := tn || text 'E campus GGN: only lead a (Gurugram)'; td := td || coalesce(pg_temp.gcp_fmt(x), r::text); tp := tp || (pg_temp.gcp_fmt(x) = '1/1/0/1');
    r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_perf', '{"campus":"PUNE"}'));
    x := pg_temp.gcp_c(r, 'ZZTEST Alpha');
    tn := tn || text 'E campus PUNE: only coupon lead c'; td := td || coalesce(pg_temp.gcp_fmt(x), r::text); tp := tp || (pg_temp.gcp_fmt(x) = '0/0/1/1');

    -- ════ F. reconciles with the Consultant Listing ════
    r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_list', '{"view":"active"}'));
    select count(*) into bad
      from jsonb_array_elements(r->'rows') l
      join lateral (select pg_temp.gcp_c(r0, l->>'consultant_name') c) pc on true
     where (select count(*) from jsonb_array_elements(r->'rows') z where lower(btrim(z->>'consultant_name')) = lower(btrim(l->>'consultant_name'))) = 1
       and pc.c is not null
       and ((l->>'leads')::int, (l->>'apps_utm')::int + (l->>'apps_coupon')::int, (l->>'enr_utm')::int + (l->>'enr_coupon')::int)
           is distinct from ((pc.c->>'leads')::int, (pc.c->>'apps_utm')::int + (pc.c->>'apps_coupon')::int, (pc.c->>'enrolled')::int);
    tn := tn || text 'F every single-row consultant: all-time Performance numbers = Listing numbers (leads, applications, enrolments)';
    td := td || (bad::text || ' differ'); tp := tp || (bad = 0);
    select count(*) into n from jsonb_array_elements(r->'rows') l where pg_temp.gcp_c(r0, l->>'consultant_name') is null;
    tn := tn || text 'F every live Listing consultant appears in Performance'; td := td || (n::text || ' missing'); tp := tp || (n = 0);

    -- ════ G. students ════
    r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_perf_students', '{"consultant":"zztest ALPHA"}'));
    tn := tn || text 'G students of Alpha (name matched without case): a, b, c, h'; td := td || coalesce(r->>'total', r::text);
    tp := tp || ((r->>'total')::int = 4 and jsonb_array_length(r->'students') = 4 and r->>'truncated' = 'false');
    tn := tn || text 'G staff are not listed';
    tp := tp || (not exists (select 1 from jsonb_array_elements(r->'students') v where v->>'email' ilike '%@vedam.org')); td := td || text 'ok';
    x := (select v from jsonb_array_elements(r->'students') v where v->>'lead_id' = lead_a::text);
    tn := tn || text 'G lead a: paid, enrolled, stage enrolled, via UTM, Gurugram, in all three windows'; td := td || coalesce(x::text, '');
    tp := tp || (x->>'via' = 'utm' and (x->>'is_paid')::boolean and (x->>'is_enrolled')::boolean and x->>'stage' = 'enrolled' and x->>'payment_status' = 'Paid'
                 and x->>'consultant_name' = 'ZZTEST Alpha' and x->>'city' = 'ZZ City' and x->>'bdm' = 'ZZ BDM'
                 and (x->>'in_lead_window')::boolean and (x->>'in_pay_window')::boolean and (x->>'in_enr_window')::boolean);
    x := (select v from jsonb_array_elements(r->'students') v where v->>'email' = 'zzgcp-b@example.invalid');
    tn := tn || text 'G lead b: not paid, no application stage'; td := td || coalesce(x::text, '');
    tp := tp || (not (x->>'is_paid')::boolean and x->>'payment_status' = 'Not paid' and x->>'stage' = 'no_application' and (x->>'in_lead_window')::boolean and not (x->>'in_pay_window')::boolean);
    x := (select v from jsonb_array_elements(r->'students') v where v->>'email' = 'zzgcp-h@example.invalid');
    tn := tn || text 'G lead h: reached through the coupon only (paid, not a lead of the UTM)'; td := td || coalesce(x::text, '');
    tp := tp || (x->>'via' = 'coupon' and (x->>'is_paid')::boolean and not (x->>'in_lead_window')::boolean and (x->>'in_pay_window')::boolean);
    r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_perf_students', '{"consultant":"ZZTEST Alpha","start":"2090-01-16","end":"2090-01-31"}'));
    tn := tn || text 'G students in an enrolment-only period: just a and c'; td := td || coalesce(r->>'total', r::text);
    tp := tp || ((r->>'total')::int = 2 and not exists (select 1 from jsonb_array_elements(r->'students') v where not (v->>'in_enr_window')::boolean));
    r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_perf_students', '{"consultant":"ZZTEST Alpha","campus":"PUNE"}'));
    tn := tn || text 'G students filtered by campus'; td := td || coalesce(r->>'total', r::text); tp := tp || ((r->>'total')::int = 1);
    r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_perf_students', '{"consultant":"ZZTEST nobody"}'));
    tn := tn || text 'G an unknown consultant gives an empty list'; td := td || r::text; tp := tp || ((r->>'total')::int = 0 and r->'students' = '[]'::jsonb);
    r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_perf_students', '{}'));
    tn := tn || text 'G no consultant = everyone; the list is capped at 5000 and says so'; td := td || coalesce(r->>'total', r::text);
    tp := tp || (jsonb_array_length(r->'students') <= 5000 and (r->>'truncated')::boolean = ((r->>'total')::int > 5000));

    -- ════ H. trashed rows drop out ════
    update public.growth_cons_rows set deleted_at = now() where id = r2;
    r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_perf', '{}'));
    tn := tn || text 'H a trashed row is not in Performance'; td := td || coalesce((pg_temp.gcp_c(r, 'ZZTEST Beta'))::text, 'gone');
    tp := tp || (pg_temp.gcp_c(r, 'ZZTEST Beta') is null);
    x := pg_temp.gcp_c(r, 'ZZTEST Alpha');
    tn := tn || text 'H lead d (UTM of the trashed row) is no longer Beta''s; it pays with the coupon, so it is a coupon application of the owner'; td := td || coalesce(pg_temp.gcp_fmt(x), '');
    tp := tp || (pg_temp.gcp_fmt(x) = '2/1/3/2');   -- d now pays with ZZCPN1 and its UTM is no longer live → a coupon application for the owner
    update public.growth_cons_rows set deleted_at = null where id = r2;

    -- ════ I. city targets ════
    r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_city_target_set', '{"city":" ZZ City ","target":120}'));
    tn := tn || text 'I set a city target'; td := td || r::text; tp := tp || (r->>'ok' = 'true');
    r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_city_target_set', '{"city":"zz city","target":"1,500"}'));
    tn := tn || text 'I the same city in other case / spaces updates the one row (1,500 accepted)'; td := td || r::text;
    tp := tp || (r->>'ok' = 'true' and (select count(*) from public.growth_cons_city_targets where lower(btrim(city)) = 'zz city') = 1
                 and (select target from public.growth_cons_city_targets where lower(btrim(city)) = 'zz city') = 1500);
    r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_city_targets_get', '{}'));
    tn := tn || text 'I get returns the targets by city'; td := td || coalesce((r->'targets')::text, r::text); tp := tp || ((r->'targets'->>'zz city')::int = 1500 or (r->'targets'->>'ZZ City')::int = 1500);
    r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_city_target_set', '{"city":"ZZ City","target":-1}'));
    tn := tn || text 'I a negative target is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: target');
    r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_city_target_set', '{"city":"ZZ City","target":1000001}'));
    tn := tn || text 'I a target above 10,00,000 is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: target');
    r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_city_target_set', '{"city":"ZZ City","target":"1.5"}'));
    tn := tn || text 'I a fractional target is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: target');
    r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_city_target_set', '{"city":"ZZ City","target":"abc"}'));
    tn := tn || text 'I a text target is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: target');
    r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_city_target_set', '{"city":"ZZ City"}'));
    tn := tn || text 'I a missing target is refused'; td := td || r::text; tp := tp || (r->>'message' = 'REQUIRED: target');
    r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_city_target_set', '{"city":"  ","target":5}'));
    tn := tn || text 'I an empty city is refused'; td := td || r::text; tp := tp || (r->>'message' = 'REQUIRED: city');
    r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_city_target_set', jsonb_build_object('city', repeat('x', 81), 'target', 5)));
    tn := tn || text 'I a city name over 80 characters is refused'; td := td || left(r::text, 120); tp := tp || (r->>'message' is not null);
    r := pg_temp.gcp_call(adm, pg_temp.gcp_rpc('growth_cons_city_target_set', '{"city":"ZZ City","target":0}'));
    tn := tn || text 'I a zero target is allowed'; td := td || r::text; tp := tp || (r->>'ok' = 'true');
    select count(*) into n from public.audit_log where table_name = 'growth_cons_city_targets';
    tn := tn || text 'I the target changes were audited'; td := td || n::text; tp := tp || (n >= 2);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;
  return query select * from unnest(tn, tp, td);
end $$;

select * from pg_temp.run_growth_cons_perf_tests();
