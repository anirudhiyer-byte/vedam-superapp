-- Growth → School Connect Channel · tests for migration 0146 (STAGING ONLY)
--
-- How to run: apply 0146 on staging, then paste this whole file into the staging SQL editor (or the Supabase MCP) in ONE call.
-- The last statement returns one row per test: test | pass | detail. Everything is rolled back at the end (ZDONE).
-- Fake data only (ZZTEST names, zzsc* UTMs, ZZSC campaigns in 2091-2094). Refuses to run unless app_flags.environment = 'staging'.
--
-- The School Connect funnel starts at Vedam One SIGN-UPS (a profile with a first-touch UTM), not at leads:
--   Sign-ups → VSAT Leads → Applications → Payments → Enrolments
-- matched to a row by the row's UTM key (vsat__norm_utm(profiles.utm_primary) = the row's key). In-window = the
-- sign-up day (IST) falls in the VSAT that the row's Live Date sits in. Staff (@vedam) and test data are left out.

-- a Vedam One sign-up with a first-touch UTM; optionally a VSAT lead / application / payment / approved enrolment
create or replace function pg_temp.gsc_signup(
  p_tag text, p_email text, p_primary text, p_signup timestamptz,
  p_lead boolean default false, p_app boolean default false, p_paid boolean default false, p_enrolled boolean default false,
  p_campaign_override text default null, p_medium_override text default null)
returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
        v_src text := split_part(p_primary, '/', 1);
        v_med text := coalesce(p_medium_override, nullif(split_part(p_primary, '/', 2), ''));
        v_camp text := coalesce(p_campaign_override, nullif(split_part(p_primary, '/', 3), ''));
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  values (u, p_email, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id, email, full_name, utm_primary, utm_source, utm_medium, utm_campaign, created_at)
  values (u, p_email, 'ZZTEST ' || p_tag, p_primary, v_src, v_med, v_camp, p_signup)
  on conflict (id) do update set email = excluded.email, utm_primary = excluded.utm_primary,
    utm_source = excluded.utm_source, utm_medium = excluded.utm_medium, utm_campaign = excluded.utm_campaign,
    created_at = excluded.created_at;
  if p_lead or p_app or p_paid or p_enrolled then
    insert into public.lead_manager (lead_id, registered_name, registered_email, primary_utm,
             primary_utm_source, primary_utm_medium, primary_utm_campaign, primary_registration_campaign,
             created_at, user_registration_date)
    values (u, 'ZZTEST GSC ' || p_tag, p_email, p_primary, v_src, v_med, v_camp, 'ZZSC Campaign',
             p_signup, p_signup)
    on conflict (lead_id) do nothing;
  end if;
  if p_app or p_enrolled then
    insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email, created_at)
    values ('ZZSC-' || p_tag, u, 'ZZSC-' || p_tag, 'ZZTEST ' || p_tag, p_email, p_signup + interval '1 day')
    on conflict (application_id) do nothing;
  end if;
  if p_enrolled then
    update public.application_manager set enrollment_stage = 'approved', enrollment_paid_at = p_signup + interval '10 days'
     where application_id = 'ZZSC-' || p_tag;
  end if;
  if p_paid then
    insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider, amount, currency)
    values (u, p_signup + interval '2 days', 'ZZSC-' || p_tag, 'simulated', 500, 'INR');
  end if;
  return u;
end $$;

create or replace function pg_temp.gsc_call(p_uid uuid, p_sql text, p_anon boolean default false)
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

create or replace function pg_temp.gsc_rpc(p_fn text, p jsonb)
returns text language sql as $$ select format('select public.%I(%L::jsonb)', p_fn, p::text) $$;

create or replace function pg_temp.gsc_row(p_res jsonb, p_id uuid)
returns jsonb language sql as $$ select x from jsonb_array_elements(p_res->'rows') x where x->>'id' = p_id::text $$;

create or replace function pg_temp.gsc_err_detail(p_uid uuid, p_sql text)
returns text language plpgsql as $$
declare d text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics d = pg_exception_detail;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    return sqlerrm || ' | ' || coalesce(d, '');
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return 'no error';
end $$;

-- signups/leads/applications/payments/enrollments · all-time of the same five
create or replace function pg_temp.gsc_fmt(x jsonb)
returns text language sql as $$
  select format('%s/%s/%s/%s/%s · %s/%s/%s/%s/%s',
    x->>'signups', x->>'leads', x->>'applications', x->>'payments', x->>'enrollments',
    x->>'signups_all', x->>'leads_all', x->>'applications_all', x->>'payments_all', x->>'enrollments_all')
$$;

create or replace function pg_temp.run_growth_sc_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  tn text[] := '{}'; tp boolean[] := '{}'; td text[] := '{}';
  adm uuid; usr uuid; r jsonb; x jsonb; s text; n int; k text; keys jsonb;
  rJan uuid; rFeb uuid; rNo uuid; rG uuid;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid;
  key text := 'zzsc/zzscmed/zz sc';
  u1 text := 'https://sc.invalid/?utm_source=zzsc&utm_medium=zzscmed&utm_campaign=zz%20sc';
  u2 text := 'https://sc2.invalid/?utm_source=zzsc2&utm_medium=zzscmed&utm_campaign=zz%20sc';
  pub text[] := array['growth_sc_list','growth_sc_save','growth_sc_bulk_update','growth_sc_trash','growth_sc_purge',
                      'growth_sc_import','growth_sc_col_add','growth_sc_col_update','growth_sc_col_unhide_all',
                      'growth_sc_col_order','growth_sc_col_remove','growth_sc_perf_drill'];
begin
  begin -- rolled back at the end (ZDONE)
    if coalesce((select value from public.app_flags where app_flags.key = 'environment'), '') <> 'staging' then
      raise exception 'Refusing to run: this is not the staging database.';
    end if;
    perform set_config('vedam.allow_simulated_payments', 'on', true);
    adm := pg_temp.gsc_signup('admin', 'zztest-sc-admin@example.invalid', 'direct', now());
    insert into public.user_roles (user_id, role) values (adm, 'admin');
    usr := pg_temp.gsc_signup('user', 'zztest-sc-user@example.invalid', 'direct', now());
    insert into public.vsat_campaigns (name, campaign_start, campaign_end) values ('ZZSC Jan', '2091-01-01', '2091-01-31') returning id into c1;
    insert into public.vsat_campaigns (name, campaign_start, campaign_end) values ('ZZSC Feb', '2091-02-01', '2091-02-28') returning id into c2;
    insert into public.vsat_campaigns (name, campaign_start, campaign_end) values ('ZZSC Unused', '2091-04-01', '2091-04-30') returning id into c3;
    insert into public.vsat_campaigns (name, campaign_start, campaign_end) values ('ZZSC Wide', '2093-01-01', '2093-12-31') returning id into c4;
    insert into public.vsat_campaigns (name, campaign_start, campaign_end) values ('ZZSC Narrow', '2093-06-01', '2093-06-30') returning id into c5;

    -- ════ A. security ════
    r := pg_temp.gsc_call(null, pg_temp.gsc_rpc('growth_sc_list', '{}'), true);
    tn := tn || text 'A anon cannot call growth_sc_list'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    r := pg_temp.gsc_call(usr, pg_temp.gsc_rpc('growth_sc_list', '{}'));
    tn := tn || text 'A a signed-in non-admin gets FORBIDDEN'; td := td || r::text; tp := tp || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.gsc_call(usr, pg_temp.gsc_rpc('growth_sc_save', jsonb_build_object('row', jsonb_build_object(
           'channel', 'ZZTEST hack', 'utm_link', 'https://x.invalid/?utm_source=zzhack', 'live_date', '2091-01-10'))));
    tn := tn || text 'A a non-admin cannot add a row'; td := td || r::text; tp := tp || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.gsc_call(usr, pg_temp.gsc_rpc('growth_sc_perf_drill', '{"type":"signups"}'));
    tn := tn || text 'A a non-admin cannot open the performance drill'; td := td || r::text; tp := tp || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.gsc_call(adm, 'select to_jsonb(count(*)) from public.growth__sc_attr(false)');
    tn := tn || text 'A private helper growth__sc_attr is not callable, even by an admin'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    r := pg_temp.gsc_call(adm, 'select to_jsonb(count(*)) from public.growth__sc_signups(array[''zzsc/zzscmed/zz sc''])');
    tn := tn || text 'A private helper growth__sc_signups is not callable, even by an admin'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    r := pg_temp.gsc_call(adm, 'select to_jsonb(count(*)) from public.growth_sc_rows');
    tn := tn || text 'A the rows table is not readable from the browser, even by an admin'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    r := pg_temp.gsc_call(adm, 'select to_jsonb(count(*)) from public.growth_sc_columns');
    tn := tn || text 'A the columns table is not readable from the browser, even by an admin'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_list', '{"view":"active","evil":1}'));
    tn := tn || text 'A unknown request keys are refused'; td := td || r::text; tp := tp || (r->>'message' = 'UNKNOWN_KEY: evil');
    select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any (pub)
       and p.prosecdef and p.proconfig = array['search_path=""']
       and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
       and not has_function_privilege('public', p.oid, 'execute');
    tn := tn || text 'A all 12 RPCs: SECURITY DEFINER, search_path empty, authenticated only'; td := td || n::text; tp := tp || (n = 12);
    select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname ~ '^growth__sc'
       and p.proconfig = array['search_path=""']
       and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
       and not has_function_privilege('public', p.oid, 'execute');
    tn := tn || text 'A all 9 private helpers: search_path empty, no browser access'; td := td || n::text; tp := tp || (n = 9);
    select count(*) into n from pg_class c where c.oid in ('public.growth_sc_rows'::regclass, 'public.growth_sc_columns'::regclass)
       and c.relrowsecurity and not exists (select 1 from pg_policy pl where pl.polrelid = c.oid)
       and not has_table_privilege('anon', c.oid, 'select') and not has_table_privilege('authenticated', c.oid, 'select')
       and not has_table_privilege('authenticated', c.oid, 'insert') and not has_table_privilege('authenticated', c.oid, 'update')
       and not has_table_privilege('authenticated', c.oid, 'delete');
    tn := tn || text 'A both tables: RLS on, no policies, no grants'; td := td || n::text; tp := tp || (n = 2);
    select count(*) into n from pg_trigger t where t.tgrelid in ('public.growth_sc_rows'::regclass, 'public.growth_sc_columns'::regclass)
       and not t.tgisinternal and t.tgname in ('trg_audit_growth_sc_rows', 'trg_audit_growth_sc_columns', 'trg_growth_sc_rows_key');
    tn := tn || text 'A audit triggers on both tables + the UTM key trigger exist'; td := td || n::text; tp := tp || (n = 3);

    -- ════ B. columns ════
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_list', '{}'));
    s := (select string_agg(v->>'key', ',' order by o) from jsonb_array_elements(r->'columns') with ordinality q(v, o) where (v->>'standard')::boolean);
    tn := tn || text 'B the 17 standard columns, in order'; td := td || coalesce(s, r::text);
    tp := tp || (s = 'serial_no,channel,live_link,utm_link,live_date,campaign,signups,leads,applications,payments,enrollments,signups_all,leads_all,applications_all,payments_all,enrollments_all,notes');
    tn := tn || text 'B Serial No starts hidden, every other column is shown';
    s := (select string_agg(v->>'key', ',') from jsonb_array_elements(r->'columns') v where (v->>'hidden')::boolean);
    td := td || coalesce(s, 'none'); tp := tp || (s = 'serial_no');
    tn := tn || text 'B Channel, UTM Link and Live Date are required; 12 computed columns';
    s := (select string_agg(v->>'key', ',' order by v->>'key') from jsonb_array_elements(r->'columns') v where (v->>'required')::boolean);
    td := td || coalesce(s, 'none');
    tp := tp || (s = 'channel,live_date,utm_link' and (select count(*) from jsonb_array_elements(r->'columns') v where v->>'type' = 'computed') = 12);

    -- ════ C. save ════
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_save', jsonb_build_object('row', jsonb_build_object('utm_link', u1, 'live_date', '2091-01-10'))));
    tn := tn || text 'C channel is required'; td := td || r::text; tp := tp || (r->>'message' = 'REQUIRED: channel');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_save', jsonb_build_object('row', jsonb_build_object('channel', 'ZZTEST A', 'live_date', '2091-01-10'))));
    tn := tn || text 'C UTM link is required'; td := td || r::text; tp := tp || (r->>'message' = 'REQUIRED: utm_link');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_save', jsonb_build_object('row', jsonb_build_object('channel', 'ZZTEST A', 'utm_link', u1))));
    tn := tn || text 'C live date is required'; td := td || r::text; tp := tp || (r->>'message' = 'REQUIRED: live_date');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_save', jsonb_build_object('row', jsonb_build_object('channel', 'ZZTEST A', 'utm_link', 'javascript:alert(1)', 'live_date', '2091-01-10'))));
    tn := tn || text 'C a non-http UTM link is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: utm_link');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_save', jsonb_build_object('row', jsonb_build_object('channel', 'ZZTEST A', 'utm_link', u1, 'live_date', '2091-01-10', 'live_link', 'ftp://x.invalid/v'))));
    tn := tn || text 'C a non-http live link is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: live_link');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_save', jsonb_build_object('row', jsonb_build_object('channel', 'ZZTEST A', 'utm_link', u1, 'live_date', '2091-02-30'))));
    tn := tn || text 'C an impossible date is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: live_date');
    -- the Jan row (used throughout D/E), channel trimmed, DUPLICATE across names
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_save', jsonb_build_object('row', jsonb_build_object('channel', ' ZZTEST Jan drive ',
           'live_link', 'https://sc.invalid/live', 'utm_link', u1, 'live_date', '2091-01-10'))));
    rJan := (r->>'id')::uuid;
    select format('%s|%s|%s', channel, (public.growth__vd_campaign(live_date) = c1)::text, live_link) into s from public.growth_sc_rows where id = rJan;
    tn := tn || text 'C a valid row: trimmed channel, Live Date resolves to the Jan VSAT'; td := td || coalesce(s, r::text);
    tp := tp || (s = 'ZZTEST Jan drive|true|https://sc.invalid/live');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_save', jsonb_build_object('row', jsonb_build_object('channel', 'ZZTEST Dup', 'utm_link', upper(u1), 'live_date', '2091-01-25'))));
    tn := tn || text 'C the same UTM (other case) in the same VSAT, on another day, is refused'; td := td || r::text; tp := tp || (r->>'message' = 'DUPLICATE_UTM');
    s := pg_temp.gsc_err_detail(adm, pg_temp.gsc_rpc('growth_sc_save', jsonb_build_object('row', jsonb_build_object('channel', 'ZZTEST Dup',
           'utm_link', 'https://other.invalid/x?utm_campaign=zz%20sc&utm_medium=ZZSCMED&utm_source=zzsc', 'live_date', '2091-01-31'))));
    tn := tn || text 'C the same source / medium / campaign in the same VSAT is refused and names the row'; td := td || s;
    tp := tp || (s = 'DUPLICATE_UTM | ZZTEST Jan drive');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_save', jsonb_build_object('row', jsonb_build_object('channel', 'ZZTEST Feb drive', 'utm_link', u1, 'live_date', '2091-02-05'))));
    rFeb := (r->>'id')::uuid;
    tn := tn || text 'C the same UTM in another VSAT is allowed'; td := td || r::text; tp := tp || (rFeb is not null);
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_save', jsonb_build_object('row', jsonb_build_object('channel', 'ZZTEST No VSAT', 'utm_link', u1, 'live_date', '2091-03-15'))));
    rNo := (r->>'id')::uuid;
    tn := tn || text 'C a live date outside every VSAT is allowed (empty Campaign)'; td := td || r::text; tp := tp || (rNo is not null);
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_save', jsonb_build_object('row', jsonb_build_object('id', rJan, 'channel', 'ZZTEST Jan drive', 'utm_link', u1, 'live_date', '2091-01-10'))));
    tn := tn || text 'C editing a row keeps its own UTM (not a duplicate of itself)'; td := td || r::text; tp := tp || ((r->>'id')::uuid = rJan);

    -- ════ D. the sign-up funnel: in-window = signed up inside the VSAT of the live date ════
    perform pg_temp.gsc_signup('a', 'zzsc-a@example.invalid', key, '2091-01-05 12:00+05:30', true, true, true, true);   -- Jan: lead+app+paid+enrolled
    perform pg_temp.gsc_signup('b', 'zzsc-b@example.invalid', key, '2091-01-20 12:00+05:30', true);                     -- Jan: lead only
    perform pg_temp.gsc_signup('e', 'zzsc-e@example.invalid', key, '2091-01-31 23:30+05:30', false);                   -- Jan last day (IST), sign-up only
    perform pg_temp.gsc_signup('c', 'zzsc-c@example.invalid', key, '2091-03-10 12:00+05:30', true, true, true);        -- March (outside): lead+app+paid
    perform pg_temp.gsc_signup('n', 'zzsc-n@example.invalid', key, '2091-03-20 12:00+05:30', false);                   -- March (outside): sign-up only
    perform pg_temp.gsc_signup('s', 'zzsc-s@VEDAM.org', key, '2091-01-06 12:00+05:30', true, true, true);              -- staff (excluded)
    perform pg_temp.gsc_signup('d', 'zzsc-d@example.invalid', key, '2091-01-07 12:00+05:30', true, false, false, false, 'zz_dummy_campaign'); -- dummy campaign (excluded)
    perform pg_temp.gsc_signup('m', 'zzsc-m@example.invalid', key, '2091-01-08 12:00+05:30', true, false, false, false, null, 'dummy');       -- dummy medium (excluded)

    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_list', '{"view":"active"}'));
    x := pg_temp.gsc_row(r, rJan);
    tn := tn || text 'D Jan row: in-window 3/2/1/1/1 (a,b,e) · all-time 5/3/2/2/1; staff and test data left out';
    td := td || coalesce(pg_temp.gsc_fmt(x), r::text); tp := tp || (pg_temp.gsc_fmt(x) = '3/2/1/1/1 · 5/3/2/2/1');
    x := pg_temp.gsc_row(r, rFeb);
    tn := tn || text 'D Feb row (same UTM): nothing in its window; same all-time numbers';
    td := td || coalesce(pg_temp.gsc_fmt(x), r::text); tp := tp || (pg_temp.gsc_fmt(x) = '0/0/0/0/0 · 5/3/2/2/1');
    x := pg_temp.gsc_row(r, rNo);
    tn := tn || text 'D row with no VSAT: no window numbers, all-time numbers still shown, empty Campaign';
    td := td || coalesce(pg_temp.gsc_fmt(x), r::text);
    tp := tp || (pg_temp.gsc_fmt(x) = '0/0/0/0/0 · 5/3/2/2/1' and x->>'campaign' is null and x->>'campaign_id' is null);
    x := pg_temp.gsc_row(r, rJan);
    tn := tn || text 'D the Jan row carries the derived VSAT name + id and the UTM key'; td := td || coalesce(x::text, '');
    tp := tp || (x->>'campaign' = 'ZZSC Jan' and x->>'campaign_id' = c1::text and x->>'utm_key' = key and x->>'live_date' = '2091-01-10');
    tn := tn || text 'D the list is newest live date first'; td := td || (r->'rows'->0->>'live_date');
    tp := tp || ((r->'rows'->0->>'live_date')::date = (select max(live_date) from public.growth_sc_rows where deleted_at is null));
    tn := tn || text 'D counts: active = rows in the table, trash = 0'; td := td || (r->'counts')::text;
    tp := tp || ((r->'counts'->>'active')::int = (select count(*) from public.growth_sc_rows where deleted_at is null) and (r->'counts'->>'trash')::int = 0);

    -- ════ E. performance drill: totals reconcile with the funnel, each step a subset ════
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_perf_drill', '{"type":"signups","scope":"all_time"}'));
    tn := tn || text 'E drill all-time sign-ups = 5, lists each once'; td := td || (r->>'total');
    tp := tp || ((r->>'total')::int = 5 and jsonb_array_length(r->'students') = 5);
    tn := tn || text 'E drill columns are the 14 person columns';
    tp := tp || ((select string_agg(v, ',') from jsonb_array_elements_text(r->'columns') v) =
      'user_id,full_name,email,phone,signup_date,primary_source,primary_campaign,is_vsat_lead,application_no,lead_stage,applied,paid,enrolled,campus_preference');
    td := td || (r->'columns')::text;
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_perf_drill', '{"type":"leads","scope":"all_time"}'));
    tn := tn || text 'E drill all-time VSAT leads = 3 (a,b,c)'; td := td || (r->>'total'); tp := tp || ((r->>'total')::int = 3);
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_perf_drill', '{"type":"applications","scope":"all_time"}'));
    tn := tn || text 'E drill all-time applications = 2 (a,c)'; td := td || (r->>'total'); tp := tp || ((r->>'total')::int = 2);
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_perf_drill', '{"type":"payments","scope":"all_time"}'));
    tn := tn || text 'E drill all-time payments = 2 (a,c)'; td := td || (r->>'total'); tp := tp || ((r->>'total')::int = 2);
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_perf_drill', '{"type":"enrollments","scope":"all_time"}'));
    tn := tn || text 'E drill all-time enrolments = 1 (a)'; td := td || (r->>'total'); tp := tp || ((r->>'total')::int = 1);
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_perf_drill', '{"type":"signups","scope":"in_window"}'));
    tn := tn || text 'E drill in-window sign-ups = 3 (a,b,e signed up inside the Jan VSAT)'; td := td || (r->>'total'); tp := tp || ((r->>'total')::int = 3);
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_perf_drill', '{"type":"leads","scope":"in_window"}'));
    tn := tn || text 'E drill in-window VSAT leads = 2 (a,b)'; td := td || (r->>'total'); tp := tp || ((r->>'total')::int = 2);
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_perf_drill', jsonb_build_object('type','signups','scope','all_time','channel','ZZTEST Feb drive')));
    tn := tn || text 'E drill filtered to the Feb channel still sees the all-time sign-ups (same UTM)'; td := td || (r->>'total'); tp := tp || ((r->>'total')::int = 5);
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_perf_drill', '{"type":"nope"}'));
    tn := tn || text 'E an unknown drill type is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: type');
    s := (pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_perf_drill', '{"type":"signups","scope":"all_time"}'))->'students'->0->>'is_vsat_lead');
    tn := tn || text 'E a drilled sign-up row exposes its funnel flags (is_vsat_lead present)'; td := td || coalesce(s,'null'); tp := tp || (s in ('true','false'));

    -- ════ F. bulk update / inline ════
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_bulk_update', jsonb_build_object('ids', jsonb_build_array(rJan, rFeb), 'key', 'notes', 'value', 'ZZ bulk note')));
    select string_agg(coalesce(notes,'∅'), ',' order by live_date) into s from public.growth_sc_rows where id in (rJan, rFeb);
    tn := tn || text 'F bulk update sets Notes on both rows'; td := td || coalesce(s, r::text); tp := tp || (r->>'changed' = '2' and s = 'ZZ bulk note,ZZ bulk note');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_bulk_update', jsonb_build_object('ids', jsonb_build_array(rFeb), 'key', 'live_date', 'value', '2091-01-12')));
    tn := tn || text 'F moving the Feb row into Jan (where the same UTM is) is refused'; td := td || r::text; tp := tp || (r->>'message' = 'DUPLICATE_UTM');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_bulk_update', jsonb_build_object('ids', jsonb_build_array(rFeb), 'key', 'live_date', 'value', '2091-04-10')));
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_list', '{}'));
    tn := tn || text 'F inline live date change: the Campaign follows the date'; td := td || coalesce(pg_temp.gsc_row(r, rFeb)->>'campaign', 'null');
    tp := tp || (pg_temp.gsc_row(r, rFeb)->>'campaign_id' = c3::text);
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_bulk_update', jsonb_build_object('ids', jsonb_build_array(rFeb), 'key', 'live_date', 'value', '2091-02-05')));  -- move back
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_bulk_update', jsonb_build_object('ids', jsonb_build_array(rJan), 'key', 'utm_link', 'value', u2)));
    tn := tn || text 'F UTM link cannot be bulk updated'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: key');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_bulk_update', jsonb_build_object('ids', jsonb_build_array(rJan), 'key', 'signups', 'value', '9')));
    tn := tn || text 'F a computed column cannot be set'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: key');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_bulk_update', jsonb_build_object('ids', jsonb_build_array(rJan), 'key', 'campaign', 'value', 'ZZSC Feb')));
    tn := tn || text 'F Campaign cannot be set (it follows the live date)'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: key');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_bulk_update', jsonb_build_object('ids', jsonb_build_array(rJan), 'key', 'channel', 'value', '')));
    tn := tn || text 'F a required column cannot be emptied'; td := td || r::text; tp := tp || (r->>'message' = 'REQUIRED: channel');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_bulk_update', jsonb_build_object('ids', jsonb_build_array(gen_random_uuid()), 'key', 'notes', 'value', '1')));
    tn := tn || text 'F a row that does not exist is refused'; td := td || r::text; tp := tp || (r->>'message' = 'NOT_FOUND');

    -- ════ G. trash / restore / delete ════
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_trash', jsonb_build_object('ids', jsonb_build_array(rFeb), 'trash', true)));
    tn := tn || text 'G move to trash'; td := td || r::text; tp := tp || (r->>'changed' = '1');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_list', '{"view":"trash"}'));
    tn := tn || text 'G the trash view shows the row with its all-time numbers'; td := td || coalesce(pg_temp.gsc_fmt(pg_temp.gsc_row(r, rFeb)), r::text);
    tp := tp || (pg_temp.gsc_row(r, rFeb) is not null and (pg_temp.gsc_row(r, rFeb)->>'signups_all')::int = 5 and jsonb_array_length(r->'rows') = 1);
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_save', jsonb_build_object('row', jsonb_build_object('channel', 'ZZTEST Reuse', 'utm_link', u1, 'live_date', '2091-02-14'))));
    rG := (r->>'id')::uuid;
    tn := tn || text 'G the UTM + VSAT of a trashed row can be used again'; td := td || r::text; tp := tp || (rG is not null);
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_trash', jsonb_build_object('ids', jsonb_build_array(rFeb), 'trash', false)));
    tn := tn || text 'G restoring it while that UTM + VSAT is live again is refused'; td := td || r::text;
    tp := tp || (r->>'message' = 'DUPLICATE_UTM' and (select deleted_at is not null from public.growth_sc_rows where id = rFeb));
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_purge', jsonb_build_object('ids', jsonb_build_array(rJan, rFeb))));
    tn := tn || text 'G delete permanently removes only rows in the trash'; td := td || r::text;
    tp := tp || (r->>'deleted' = '1' and exists (select 1 from public.growth_sc_rows where id = rJan) and not exists (select 1 from public.growth_sc_rows where id = rFeb));

    -- ════ H. CSV import ════
    select count(*) into n from public.growth_sc_rows;
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_import', jsonb_build_object('mode', 'upsert', 'rows', jsonb_build_array(
           jsonb_build_object('channel', 'ZZTEST Imp 1', 'utm_link', 'https://x.invalid/?utm_source=zzimp1', 'live_date', '2091-01-12'),
           jsonb_build_object('channel', 'ZZTEST Imp 2', 'utm_link', 'https://x.invalid/?utm_source=zzimp2', 'live_date', 'not a date')))));
    tn := tn || text 'H a file with one bad row imports nothing'; td := td || r::text;
    tp := tp || (r->>'message' = 'IMPORT_FAILED' and (select count(*) from public.growth_sc_rows) = n);
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_import', jsonb_build_object('mode', 'upsert', 'rows', jsonb_build_array(
           jsonb_build_object('channel', 'ZZTEST Imp 1', 'utm_link', 'https://x.invalid/?utm_source=zzimp1', 'live_date', '2091-01-12'),
           jsonb_build_object('channel', 'ZZTEST Reuse', 'utm_link', u1, 'live_date', '2091-02-14', 'notes', 'kept')))));
    tn := tn || text 'H upsert: 1 added, 1 updated by its UTM + VSAT'; td := td || r::text;
    tp := tp || (r->>'added' = '1' and r->>'updated' = '1' and (select notes = 'kept' from public.growth_sc_rows where id = rG));
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_import', jsonb_build_object('mode', 'upsert', 'rows', jsonb_build_array(
           jsonb_build_object('channel', 'ZZTEST Imp 1', 'utm_link', 'https://x.invalid/?utm_source=zzimp1', 'notes', 'ZZ note')))));
    tn := tn || text 'H upsert: a file without a live date matches by UTM and keeps the row''s date'; td := td || r::text;
    tp := tp || (r->>'updated' = '1' and (select notes = 'ZZ note' and live_date = date '2091-01-12' from public.growth_sc_rows where utm_link like '%zzimp1'));
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_import', jsonb_build_object('mode', 'add', 'rows', jsonb_build_array(
           jsonb_build_object('channel', 'ZZTEST Reuse 2', 'utm_link', u1, 'live_date', '2091-02-14')))));
    tn := tn || text 'H add mode: a UTM + VSAT already in the list is an error'; td := td || r::text; tp := tp || (r->>'message' = 'IMPORT_FAILED');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_import', jsonb_build_object('mode', 'add', 'rows', jsonb_build_array(
           jsonb_build_object('channel', 'ZZTEST No Date', 'utm_link', 'https://x.invalid/?utm_source=zznodate')))));
    tn := tn || text 'H add mode: a row without a live date is an error'; td := td || r::text; tp := tp || (r->>'message' = 'IMPORT_FAILED');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_import', jsonb_build_object('rows',
           (select jsonb_agg(jsonb_build_object('channel', 'x')) from generate_series(1, 2001)))));
    tn := tn || text 'H more than 2000 rows is refused'; td := td || left(r::text, 120); tp := tp || (r->>'message' = 'TOO_MANY_ROWS');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_import', '{"rows":[{"channel":"x"}],"mode":"replace"}'));
    tn := tn || text 'H an unknown mode is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: mode');

    -- ════ I. columns CRUD ════
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_col_add', '{"label":"ZZ Owner","type":"text"}'));
    k := r->>'key';
    tn := tn || text 'I add a text column'; td := td || r::text; tp := tp || (k = 'x_zz_owner');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_col_add', '{"label":"Channel","type":"number"}'));
    tn := tn || text 'I a label used by a standard column is refused'; td := td || r::text; tp := tp || (r->>'message' = 'DUPLICATE');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_col_add', '{"label":"ZZ Bad","type":"select"}'));
    tn := tn || text 'I only Text / Number / Date / URL columns can be added'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: type');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_bulk_update', jsonb_build_object('ids', jsonb_build_array(rJan), 'key', k, 'value', 'Pawan')));
    tn := tn || text 'I a value for the added column is saved'; td := td || r::text; tp := tp || ((select extra->>k from public.growth_sc_rows where id = rJan) = 'Pawan');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_save', jsonb_build_object('row', jsonb_build_object('id', rJan, 'channel', 'ZZTEST Jan drive', 'utm_link', u1,
           'live_date', '2091-01-10', 'extra', jsonb_build_object('x_zz_nope', '1')))));
    tn := tn || text 'I a value for a column that does not exist is refused'; td := td || r::text; tp := tp || (r->>'message' = 'UNKNOWN_KEY: x_zz_nope');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_col_remove', '{"key":"channel"}'));
    tn := tn || text 'I a standard column cannot be removed'; td := td || r::text; tp := tp || (r->>'message' = 'SYSTEM_COLUMN');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_col_update', jsonb_build_object('key', 'notes', 'label', 'ZZ Remarks', 'hidden', true)));
    tn := tn || text 'I rename + hide a standard column'; td := td || r::text;
    tp := tp || ((select label = 'ZZ Remarks' and is_hidden from public.growth_sc_columns where col_key = 'notes' and deleted_at is null));
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_col_update', jsonb_build_object('key', 'campaign', 'label', 'zz remarks')));
    tn := tn || text 'I a label already used by another column is refused'; td := td || r::text; tp := tp || (r->>'message' = 'DUPLICATE');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_col_unhide_all', '{}'));
    tn := tn || text 'I unhide all'; td := td || r::text; tp := tp || (not exists (select 1 from public.growth_sc_columns where is_hidden and deleted_at is null));
    select jsonb_agg(col_key order by case col_key when 'live_date' then 0 else 1 end, display_order) into keys from public.growth_sc_columns where deleted_at is null;
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_col_order', jsonb_build_object('keys', keys)));
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_list', '{}'));
    tn := tn || text 'I reorder: Live Date moved to the front'; td := td || coalesce(r->'columns'->0->>'key', r::text); tp := tp || (r->'columns'->0->>'key' = 'live_date');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_col_order', '{"keys":["live_date"]}'));
    tn := tn || text 'I a reorder that leaves columns out is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: keys');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_col_remove', jsonb_build_object('key', k)));
    tn := tn || text 'I an added column can be removed (its values stay in the row)'; td := td || r::text;
    tp := tp || (r->>'ok' = 'true' and (select extra->>k from public.growth_sc_rows where id = rJan) = 'Pawan');

    -- ════ J. trash clean-up ════
    update public.growth_sc_rows set deleted_at = now() - interval '31 days' where id = rNo;
    perform public.growth__sc_purge_old();
    tn := tn || text 'J rows in the trash for more than 30 days are deleted'; td := td || text 'see test';
    tp := tp || (not exists (select 1 from public.growth_sc_rows where id = rNo));
    tn := tn || text 'J the daily clean-up job is scheduled';
    select string_agg(jobname || ' ' || schedule, ', ') into s from cron.job where jobname = 'growth-sc-trash-purge';
    td := td || coalesce(s, 'missing'); tp := tp || (s is not null);

    -- ════ K. derived VSAT: the VSAT whose dates hold the live date (latest start wins) ════
    tn := tn || text 'K a date inside two VSATs takes the one that started later';
    td := td || coalesce(public.growth__vd_campaign(date '2093-06-10')::text, 'null'); tp := tp || (public.growth__vd_campaign(date '2093-06-10') = c5);
    tn := tn || text 'K a date inside only the wide VSAT takes the wide one'; td := td || text 'see test'; tp := tp || (public.growth__vd_campaign(date '2093-03-10') = c4);
    tn := tn || text 'K the first and last day of a VSAT belong to it'; td := td || text 'see test';
    tp := tp || (public.growth__vd_campaign(date '2091-01-31') = c1 and public.growth__vd_campaign(date '2091-02-01') = c2);
    tn := tn || text 'K a date outside every VSAT, or no date, gives no VSAT'; td := td || text 'see test';
    tp := tp || (public.growth__vd_campaign(date '2095-01-01') is null and public.growth__vd_campaign(null) is null);

    -- ════ L. bad input ════
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_list', '{"view":"x"}'));
    tn := tn || text 'L an unknown view is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: view');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_save', '{"row":5}'));
    tn := tn || text 'L a row that is not an object is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: row');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_save', jsonb_build_object('row', jsonb_build_object('channel', 'ZZTEST', 'utm_link', u2, 'live_date', '2091-01-10', 'evil', 1))));
    tn := tn || text 'L an unknown key inside the row is refused'; td := td || r::text; tp := tp || (r->>'message' = 'UNKNOWN_KEY: evil');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_save', jsonb_build_object('row', jsonb_build_object('id', gen_random_uuid(), 'channel', 'ZZTEST', 'utm_link', u2, 'live_date', '2091-01-10'))));
    tn := tn || text 'L editing a row that does not exist is refused'; td := td || r::text; tp := tp || (r->>'message' = 'NOT_FOUND');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_save', jsonb_build_object('row', jsonb_build_object('channel', repeat('a', 121), 'utm_link', u2, 'live_date', '2091-01-10'))));
    tn := tn || text 'L a channel name over 120 characters is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: channel');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_save', jsonb_build_object('row', jsonb_build_object('channel', 'ZZTEST', 'utm_link', u2, 'live_date', '2091-01-10', 'notes', repeat('n', 501)))));
    tn := tn || text 'L notes over 500 characters are refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: notes');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_bulk_update', '{"ids":[],"key":"notes","value":"1"}'));
    tn := tn || text 'L an empty id list is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: ids');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_bulk_update', '{"ids":["not-a-uuid"],"key":"notes","value":"1"}'));
    tn := tn || text 'L an id that is not a uuid is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: ids');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_trash', jsonb_build_object('ids', jsonb_build_array(rJan), 'trash', 'yes')));
    tn := tn || text 'L trash needs true or false'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: trash');
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_purge', jsonb_build_object('ids', jsonb_build_array(rJan))));
    tn := tn || text 'L delete permanently never removes a live row'; td := td || r::text;
    tp := tp || (r->>'deleted' = '0' and exists (select 1 from public.growth_sc_rows where id = rJan));

    -- ════ M. stored UTM key ════
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_save', jsonb_build_object('row', jsonb_build_object('channel', 'ZZTEST Key',
           'utm_link', 'https://y.invalid/k?utm_source=ZZKey&utm_medium=Yt&utm_campaign=zz%20k', 'live_date', '2091-02-12'))));
    rG := (r->>'id')::uuid;
    select utm_key into s from public.growth_sc_rows where id = rG;
    tn := tn || text 'M a new row stores its UTM key'; td := td || coalesce(s, r::text);
    tp := tp || (s = public.growth__utm_key('https://y.invalid/k?utm_source=ZZKey&utm_medium=Yt&utm_campaign=zz%20k') and s is not null);
    r := pg_temp.gsc_call(adm, pg_temp.gsc_rpc('growth_sc_save', jsonb_build_object('row', jsonb_build_object('id', rG, 'channel', 'ZZTEST Key',
           'utm_link', 'https://y.invalid/k?utm_source=zzkey2&utm_medium=yt&utm_campaign=zz', 'live_date', '2091-02-12'))));
    select utm_key into s from public.growth_sc_rows where id = rG;
    tn := tn || text 'M editing the link updates the stored key'; td := td || coalesce(s, r::text);
    tp := tp || (s = public.growth__utm_key('https://y.invalid/k?utm_source=zzkey2&utm_medium=yt&utm_campaign=zz'));

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;
  return query select * from unnest(tn, tp, td);
end $$;

select * from pg_temp.run_growth_sc_tests();
