-- Growth → Telegram Channel → Telegram Performance · tests for migration 0134 (STAGING ONLY)
--
-- How to run: apply 0132, 0133 and 0134 on staging, then run this whole file in the staging SQL editor (or the Supabase MCP).
-- It refuses to run unless app_flags.environment = 'staging'. Everything it creates (fake ZZTEST users, leads, payments,
-- campaigns, rows) is rolled back at the end: nothing stays. Result: one row per test (test | pass | detail).

create or replace function pg_temp.gtp_user(p_email text)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  values (v, p_email, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id, email, full_name) values (v, p_email, 'ZZTEST ' || split_part(p_email, '@', 1))
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
  return v;
end $$;

-- a fake lead on UTM zztp<src>/zzmed/zz tp, registered p_reg; paid 2 days later if p_paid; enrolled 10 days later if p_enr
create or replace function pg_temp.gtp_lead(p_tag text, p_email text, p_src text, p_reg timestamptz, p_paid boolean, p_enr boolean default false)
returns uuid language plpgsql as $$
declare u uuid := pg_temp.gtp_user('zztest-gtp-' || p_tag || '@example.invalid');
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, utm_source, utm_medium, utm_campaign, created_at, user_registration_date)
  values (u, 'ZZTEST GTP ' || p_tag, p_email, p_src, 'zzmed', 'zz tp', p_reg, p_reg)
  on conflict (lead_id) do update set registered_email = excluded.registered_email, utm_source = excluded.utm_source,
    utm_medium = excluded.utm_medium, utm_campaign = excluded.utm_campaign, created_at = excluded.created_at,
    user_registration_date = excluded.user_registration_date;
  if p_paid then
    insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider, amount, currency)
    values (u, p_reg + interval '2 days', 'ZZTEST-GTP-' || p_tag, 'simulated', 500, 'INR');
  end if;
  if p_enr then
    insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email)
    values ('ZZGTP-' || p_tag, u, 'ZZGTP-' || p_tag, 'ZZTEST ' || p_tag, 'zztest-gtp-' || p_tag || '@example.invalid');
    update public.application_manager set enrollment_stage = 'approved', enrollment_paid_at = p_reg + interval '10 days'
     where application_id = 'ZZGTP-' || p_tag;
  end if;
  return u;
end $$;

create or replace function pg_temp.gtp_call(p_uid uuid, p_sql text, p_anon boolean default false)
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
  return jsonb_build_object('sqlstate', sqlstate, 'message', left(sqlerrm, 200));
end $$;

create or replace function pg_temp.gtp_rpc(p_fn text, p jsonb)
returns text language sql as $$ select format('select public.%I(%L::jsonb)', p_fn, p::text) $$;

-- leads/payments/enrollments · cpl_spend/cpa_spend · influencers/utms
create or replace function pg_temp.gtp_fmt(k jsonb)
returns text language sql as $$
  select format('%s/%s/%s · %s/%s · %s/%s', k->>'leads', k->>'payments', k->>'enrollments',
                (k->>'cpl_spend')::numeric::int, (k->>'cpa_spend')::numeric::int, k->>'influencers', k->>'utms')
$$;

create or replace function pg_temp.run_growth_tp_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  tn text[] := '{}'; tp boolean[] := '{}'; td text[] := '{}';
  adm uuid; usr uuid; r jsonb; k0 jsonb; k jsonb; s text; n int; c1 uuid; c2 uuid; t0 timestamptz; ms int;
  u1 text := 'https://t.me/zz?utm_source=zztp1&utm_medium=zzmed&utm_campaign=zz%20tp';
  u2 text := 'https://t.me/zz?utm_source=zztp2&utm_medium=zzmed&utm_campaign=zz%20tp';
  pub text[] := array['growth_tg_perf_meta', 'growth_tg_perf', 'growth_tg_perf_students'];
begin
  begin
    if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
      raise exception 'Refusing to run: this is not the staging database.';
    end if;
    perform set_config('vedam.allow_simulated_payments', 'on', true);
    adm := pg_temp.gtp_user('zztest-gtp-admin@example.invalid');
    insert into public.user_roles (user_id, role) values (adm, 'admin');
    usr := pg_temp.gtp_user('zztest-gtp-user@example.invalid');

    -- ════ A. security ════
    r := pg_temp.gtp_call(null, pg_temp.gtp_rpc('growth_tg_perf', '{}'), true);
    tn := tn || text 'A anon cannot call growth_tg_perf'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    r := pg_temp.gtp_call(usr, pg_temp.gtp_rpc('growth_tg_perf_students', '{"influencer":"x"}'));
    tn := tn || text 'A a signed-in non-admin gets FORBIDDEN (students)'; td := td || r::text; tp := tp || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.gtp_call(adm, pg_temp.gtp_rpc('growth_tg_perf', '{"evil":1}'));
    tn := tn || text 'A unknown request keys are refused'; td := td || r::text; tp := tp || (r->>'message' = 'UNKNOWN_KEY: evil');
    r := pg_temp.gtp_call(adm, 'select to_jsonb(count(*)) from public.growth__tgperf_people(null, null)');
    tn := tn || text 'A private helper growth__tgperf_people is not callable, even by an admin'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any (pub)
       and p.prosecdef and p.proconfig = array['search_path=""']
       and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute');
    tn := tn || text 'A all 3 RPCs: SECURITY DEFINER, search_path empty, authenticated only'; td := td || n::text; tp := tp || (n = 3);
    select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'growth\_\_tgperf\_%'
       and p.proconfig = array['search_path=""']
       and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute');
    tn := tn || text 'A both private helpers: search_path empty, no browser access'; td := td || n::text; tp := tp || (n = 2);

    -- baseline (staging may hold other Telegram rows): unfiltered numbers are checked as a difference
    k0 := pg_temp.gtp_call(adm, pg_temp.gtp_rpc('growth_tg_perf', '{}'))->'kpi';

    -- ════ fixture ════
    insert into public.vsat_campaigns (name, campaign_start, campaign_end) values ('ZZTP Jan', '2090-01-01', '2090-01-31') returning id into c1;
    insert into public.vsat_campaigns (name, campaign_start, campaign_end) values ('ZZTP Feb', '2090-02-01', '2090-02-28') returning id into c2;
    insert into public.growth_tg_rows (influencer_name, utm_link, campaign_id, cpl, cpa, created_at) values
      ('ZZTEST Alpha', u1, c1, 100, 1000, now() - interval '2 min'),
      (' zztest alpha ', u1, c2, 50, 500, now() - interval '1 min'),
      ('ZZTEST Beta', u2, c1, 0, 0, now());
    perform pg_temp.gtp_lead('a', 'zzgtp-a@example.invalid', 'zztp1', '2090-01-05 12:00+05:30', true, true);  -- Jan row: lead, paid Jan 7, enrolled Jan 15
    perform pg_temp.gtp_lead('b', 'zzgtp-b@example.invalid', 'zztp1', '2090-01-20 12:00+05:30', false);       -- Jan row: lead only
    perform pg_temp.gtp_lead('c', 'zzgtp-c@example.invalid', 'zztp1', '2090-02-10 12:00+05:30', true);        -- Feb row: lead, paid Feb 12
    perform pg_temp.gtp_lead('s', 'zzgtp-s@VEDAM.org',       'zztp1', '2090-01-06 12:00+05:30', true);        -- staff: never counted
    perform pg_temp.gtp_lead('d', 'zzgtp-d@example.invalid', 'zztp1', '2090-03-10 12:00+05:30', true);        -- outside both VSATs
    perform pg_temp.gtp_lead('e', 'zzgtp-e@example.invalid', 'zztp2', '2090-01-30 12:00+05:30', true);        -- Beta Jan row: lead Jan 30, paid Feb 1

    -- ════ B. numbers ════
    k := pg_temp.gtp_call(adm, pg_temp.gtp_rpc('growth_tg_perf', '{}'))->'kpi';
    s := format('%s/%s/%s · %s/%s · %s/%s', (k->>'leads')::int - (k0->>'leads')::int, (k->>'payments')::int - (k0->>'payments')::int,
                (k->>'enrollments')::int - (k0->>'enrollments')::int, ((k->>'cpl_spend')::numeric - (k0->>'cpl_spend')::numeric)::int,
                ((k->>'cpa_spend')::numeric - (k0->>'cpa_spend')::numeric)::int, (k->>'influencers')::int - (k0->>'influencers')::int,
                (k->>'utms')::int - (k0->>'utms')::int);
    tn := tn || text 'B all time: +4 leads, +3 payments, +1 enrolment, CPL spend +250, CPA spend +1500, +2 influencers, +2 UTMs';
    td := td || s; tp := tp || (s = '4/3/1 · 250/1500 · 2/2');
    k := pg_temp.gtp_call(adm, pg_temp.gtp_rpc('growth_tg_perf', jsonb_build_object('campaign', 'ZZTP Jan')))->'kpi';
    tn := tn || text 'B VSAT ZZTP Jan (by name): 3 leads (a, b, e), 2 payments, 1 enrolment, spend 200 / 1000, 2 influencers, 2 UTMs';
    td := td || pg_temp.gtp_fmt(k); tp := tp || (pg_temp.gtp_fmt(k) = '3/2/1 · 200/1000 · 2/2');
    k := pg_temp.gtp_call(adm, pg_temp.gtp_rpc('growth_tg_perf', jsonb_build_object('campaign', c1, 'start', '2090-01-01', 'end', '2090-01-31')))->'kpi';
    tn := tn || text 'B VSAT Jan, period January: payment of e (Feb 1) drops out → 3 / 1 / 1';
    td := td || pg_temp.gtp_fmt(k); tp := tp || (pg_temp.gtp_fmt(k) = '3/1/1 · 200/1000 · 2/2');
    k := pg_temp.gtp_call(adm, pg_temp.gtp_rpc('growth_tg_perf', jsonb_build_object('influencer', 'ZZTEST ALPHA')))->'kpi';
    tn := tn || text 'B influencer Alpha (any case, both VSAT rows): 3 leads, 2 payments, 1 enrolment, spend 250 / 1500, 1 influencer, 1 UTM';
    td := td || pg_temp.gtp_fmt(k); tp := tp || (pg_temp.gtp_fmt(k) = '3/2/1 · 250/1500 · 1/1');
    k := pg_temp.gtp_call(adm, pg_temp.gtp_rpc('growth_tg_perf', jsonb_build_object('influencer', 'zztest alpha', 'campaign', 'ZZTP Feb')))->'kpi';
    tn := tn || text 'B Alpha in VSAT Feb: 1 lead (c), 1 payment, spend 50 / 500';
    td := td || pg_temp.gtp_fmt(k); tp := tp || (pg_temp.gtp_fmt(k) = '1/1/0 · 50/500 · 1/1');
    k := pg_temp.gtp_call(adm, pg_temp.gtp_rpc('growth_tg_perf', jsonb_build_object('influencer', 'nobody here')))->'kpi';
    tn := tn || text 'B unknown influencer: all zero'; td := td || pg_temp.gtp_fmt(k); tp := tp || (pg_temp.gtp_fmt(k) = '0/0/0 · 0/0 · 0/0');

    -- ════ C. bad input ════
    r := pg_temp.gtp_call(adm, pg_temp.gtp_rpc('growth_tg_perf', '{"start":"2090-02-01","end":"2090-01-01"}'));
    tn := tn || text 'C From after To is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: start');
    r := pg_temp.gtp_call(adm, pg_temp.gtp_rpc('growth_tg_perf', '{"campaign":"No such VSAT"}'));
    tn := tn || text 'C an unknown VSAT is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: campaign');
    r := pg_temp.gtp_call(adm, pg_temp.gtp_rpc('growth_tg_perf', '{"start":"not a date"}'));
    tn := tn || text 'C a bad date is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: start');

    -- ════ D. student drill ════
    r := pg_temp.gtp_call(adm, pg_temp.gtp_rpc('growth_tg_perf_students', '{}'));
    tn := tn || text 'D the drill needs an influencer'; td := td || r::text; tp := tp || (r->>'message' = 'REQUIRED: influencer');
    r := pg_temp.gtp_call(adm, pg_temp.gtp_rpc('growth_tg_perf_students', '{"influencer":"ZZTEST Alpha"}'));
    select string_agg(x->>'name' || ':' || (x->>'stage') || ':' || (x->>'payment_status'), ', ' order by x->>'name') into s from jsonb_array_elements(r->'students') x;
    tn := tn || text 'D Alpha, all time: a (enrolled, paid), b (not paid), c (paid); staff and out-of-VSAT left out';
    td := td || coalesce(s, r::text);
    tp := tp || ((r->>'total')::int = 3 and s like 'ZZTEST GTP a:enrolled:Paid, ZZTEST GTP b:%:Not paid, ZZTEST GTP c:%:Paid');
    tn := tn || text 'D each student carries name, email, mobile, registration date, campus, stage, payment';
    td := td || coalesce((select string_agg(key, ',' order by key) from jsonb_object_keys(r->'students'->0) key), '');
    tp := tp || ((r->'students'->0) ?& array['lead_id', 'name', 'email', 'mobile', 'registration_date', 'campus_preference', 'stage', 'payment_status']);
    r := pg_temp.gtp_call(adm, pg_temp.gtp_rpc('growth_tg_perf_students', '{"influencer":"zztest alpha","start":"2090-02-01","end":"2090-02-28"}'));
    tn := tn || text 'D Alpha, period February: only c'; td := td || coalesce(r->>'total', r::text);
    tp := tp || ((r->>'total')::int = 1 and r->'students'->0->>'name' = 'ZZTEST GTP c');

    -- ════ E. meta ════
    r := pg_temp.gtp_call(adm, pg_temp.gtp_rpc('growth_tg_perf_meta', '{}'));
    tn := tn || text 'E meta: VSATs newest first, influencers once each (first name written)';
    td := td || coalesce((select string_agg(v->>'name', ',') from jsonb_array_elements(r->'influencers') v where v->>'key' like 'zztest%'), r::text);
    tp := tp || ((select string_agg(v->>'name', ',' order by o) from jsonb_array_elements(r->'campaigns') with ordinality q(v, o) where v->>'name' like 'ZZTP%') = 'ZZTP Feb,ZZTP Jan'
                 and (select string_agg(v->>'key' || '=' || (v->>'name'), ',' order by o) from jsonb_array_elements(r->'influencers') with ordinality q(v, o) where v->>'key' like 'zztest%')
                     = 'zztest alpha=ZZTEST Alpha,zztest beta=ZZTEST Beta');

    -- ════ F. speed (light) ════
    insert into public.growth_tg_rows (influencer_name, utm_link, campaign_id, cpl, cpa)
      select 'ZZTEST load ' || (g % 200), 'https://t.me/zzl?utm_source=zzload' || g || '&utm_medium=tg&utm_campaign=zz', c2, 40, 1500
        from generate_series(1, 2000) g;
    t0 := clock_timestamp();
    r := pg_temp.gtp_call(adm, pg_temp.gtp_rpc('growth_tg_perf', '{}'));
    ms := round(extract(epoch from clock_timestamp() - t0) * 1000);
    tn := tn || text 'F speed: Season numbers over 2000+ rows in under 1 second'; td := td || (ms || ' ms'); tp := tp || (ms < 1000 and r ? 'kpi');

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;
  return query select * from unnest(tn, tp, td);
end $$;

select * from pg_temp.run_growth_tp_tests();
