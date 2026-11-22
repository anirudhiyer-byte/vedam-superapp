-- Growth → Vedantu Channel → Vedantu Performance · tests for migration 0137 (STAGING ONLY)
--
-- How to run: apply 0136 + 0137 on staging, then paste this whole file into the staging SQL editor (or the Supabase MCP)
-- in ONE call. The last statement returns one row per test: test | pass | detail. Everything is rolled back (ZDONE).
-- Fake data only (ZZTEST names, zzvp* UTMs, ZZVP campaigns in 2091). Refuses to run unless app_flags.environment = 'staging'.

create or replace function pg_temp.gvp_user(p_email text)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  values (v, p_email, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id, email, full_name) values (v, p_email, 'ZZTEST ' || split_part(p_email, '@', 1))
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
  return v;
end $$;

-- a lead registered on p_reg with a first-touch UTM source; optional paid VSAT fee and approved enrolment
create or replace function pg_temp.gvp_lead(p_tag text, p_email text, p_src text, p_reg timestamptz, p_paid boolean, p_enrolled boolean default false)
returns uuid language plpgsql as $$
declare u uuid := pg_temp.gvp_user('zztest-gvp-' || p_tag || '@example.invalid');
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, utm_source, utm_medium, utm_campaign, created_at, user_registration_date)
  values (u, 'ZZTEST GVP ' || p_tag, p_email, p_src, 'zzvpmed', 'zz vp', p_reg, p_reg)
  on conflict (lead_id) do update set registered_email = excluded.registered_email, utm_source = excluded.utm_source,
    utm_medium = excluded.utm_medium, utm_campaign = excluded.utm_campaign, created_at = excluded.created_at,
    user_registration_date = excluded.user_registration_date;
  if p_paid then
    insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider, amount, currency)
    values (u, p_reg + interval '2 days', 'ZZTEST-GVP-' || p_tag, 'simulated', 500, 'INR');
  end if;
  if p_enrolled then
    insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email)
    values ('ZZGVP-' || p_tag, u, 'ZZGVP-' || p_tag, 'ZZTEST ' || p_tag, 'zztest-gvp-' || p_tag || '@example.invalid');
    update public.application_manager set enrollment_stage = 'approved', enrollment_paid_at = p_reg + interval '10 days'
     where application_id = 'ZZGVP-' || p_tag;
  end if;
  return u;
end $$;

create or replace function pg_temp.gvp_call(p_uid uuid, p_sql text, p_anon boolean default false)
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

create or replace function pg_temp.gvp_rpc(p_fn text, p jsonb)
returns text language sql as $$ select format('select public.%I(%L::jsonb)', p_fn, p::text) $$;

-- drill call → "total" (or the error message)
create or replace function pg_temp.gvp_n(p_uid uuid, p jsonb)
returns text language plpgsql as $$
declare r jsonb := pg_temp.gvp_call(p_uid, pg_temp.gvp_rpc('growth_vd_perf_drill', p));
begin
  return coalesce(r->>'total', r->>'message');
end $$;

-- drill call → sorted tags (ZZTEST GVP <tag>) of the people listed
create or replace function pg_temp.gvp_tags(p_uid uuid, p jsonb)
returns text language plpgsql as $$
declare r jsonb := pg_temp.gvp_call(p_uid, pg_temp.gvp_rpc('growth_vd_perf_drill', p));
begin
  if r ? 'message' then return r->>'message'; end if;
  return coalesce((select string_agg(replace(x->>'registered_name', 'ZZTEST GVP ', ''), ',' order by replace(x->>'registered_name', 'ZZTEST GVP ', ''))
                     from jsonb_array_elements(r->'students') x), '');
end $$;

create or replace function pg_temp.run_growth_vp_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  tn text[] := '{}'; tp boolean[] := '{}'; td text[] := '{}';
  adm uuid; usr uuid; r jsonb; s text; t0 timestamptz; ms int; ra uuid; rb uuid; rc uuid; rt uuid; c1 uuid; c2 uuid;
  base jsonb := '{"start":"2091-01-01","end":"2091-12-31"}';
  ua text := 'https://vedantu.invalid/a?utm_source=zzvpa&utm_medium=zzvpmed&utm_campaign=zz%20vp';
  ub text := 'https://vedantu.invalid/b?utm_source=zzvpb&utm_medium=zzvpmed&utm_campaign=zz%20vp';
  ut text := 'https://vedantu.invalid/t?utm_source=zzvpt&utm_medium=zzvpmed&utm_campaign=zz%20vp';
begin
  begin -- rolled back at the end (ZDONE)
    if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
      raise exception 'Refusing to run: this is not the staging database.';
    end if;
    perform set_config('vedam.allow_simulated_payments', 'on', true);
    adm := pg_temp.gvp_user('zztest-gvp-admin@example.invalid');
    insert into public.user_roles (user_id, role) values (adm, 'admin');
    usr := pg_temp.gvp_user('zztest-gvp-user@example.invalid');
    insert into public.vsat_campaigns (name, campaign_start, campaign_end) values ('ZZVP Jan', '2091-01-01', '2091-01-31') returning id into c1;
    insert into public.vsat_campaigns (name, campaign_start, campaign_end) values ('ZZVP Feb', '2091-02-01', '2091-02-28') returning id into c2;

    -- rows: A (Jan, Chan A, UTM a) · B (Feb, Chan B, UTM b) · C (Feb, Chan A, UTM a again — other VSAT) · T (Jan, trashed)
    r := pg_temp.gvp_call(adm, pg_temp.gvp_rpc('growth_vd_save', jsonb_build_object('row', jsonb_build_object(
           'channel', 'ZZTEST Chan A', 'utm_link', ua, 'live_date', '2091-01-10', 'live_link', 'https://y.invalid/v1', 'video_spend', '1000', 'cpa', '100'))));
    ra := (r->>'id')::uuid;
    r := pg_temp.gvp_call(adm, pg_temp.gvp_rpc('growth_vd_save', jsonb_build_object('row', jsonb_build_object(
           'channel', 'ZZTEST Chan B', 'utm_link', ub, 'live_date', '2091-02-10'))));
    rb := (r->>'id')::uuid;
    r := pg_temp.gvp_call(adm, pg_temp.gvp_rpc('growth_vd_save', jsonb_build_object('row', jsonb_build_object(
           'channel', 'ZZTEST Chan A', 'utm_link', ua, 'live_date', '2091-02-15'))));
    rc := (r->>'id')::uuid;
    r := pg_temp.gvp_call(adm, pg_temp.gvp_rpc('growth_vd_save', jsonb_build_object('row', jsonb_build_object(
           'channel', 'ZZTEST Chan T', 'utm_link', ut, 'live_date', '2091-01-12'))));
    rt := (r->>'id')::uuid;
    perform pg_temp.gvp_call(adm, pg_temp.gvp_rpc('growth_vd_trash', jsonb_build_object('ids', jsonb_build_array(rt), 'trash', true)));
    tn := tn || text 'Z set-up: four rows saved, one trashed'; td := td || format('%s %s %s %s', ra, rb, rc, rt);
    tp := tp || (ra is not null and rb is not null and rc is not null and rt is not null);

    -- people
    perform pg_temp.gvp_lead('a1', 'zztest-gvp-a1@example.invalid', 'zzvpa', '2091-01-05 10:00+05:30', true, true);   -- Jan window, paid, enrolled
    perform pg_temp.gvp_lead('a2', 'zztest-gvp-a2@example.invalid', 'zzvpa', '2091-02-05 10:00+05:30', false);        -- Feb window (row C)
    perform pg_temp.gvp_lead('a3', 'zztest-gvp-a3@example.invalid', 'zzvpa', '2090-06-01 10:00+05:30', true);         -- outside all windows, paid
    perform pg_temp.gvp_lead('b1', 'zztest-gvp-b1@example.invalid', 'zzvpb', '2091-02-03 10:00+05:30', true);         -- Feb window, paid
    perform pg_temp.gvp_lead('b2', 'zztest-gvp-b2@example.invalid', 'zzvpb', '2091-03-10 10:00+05:30', false);        -- after Feb
    perform pg_temp.gvp_lead('t1', 'zztest-gvp-t1@example.invalid', 'zzvpt', '2091-01-05 10:00+05:30', true);         -- trashed row only
    perform pg_temp.gvp_lead('s1', 'zztest-gvp-s1@vedam.org',       'zzvpa', '2091-01-06 10:00+05:30', true);         -- staff: never counted

    -- ════ A. security ════
    r := pg_temp.gvp_call(null, pg_temp.gvp_rpc('growth_vd_perf_drill', '{"type":"leads"}'), true);
    tn := tn || text 'A anon cannot call the drill'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    r := pg_temp.gvp_call(usr, pg_temp.gvp_rpc('growth_vd_perf_drill', '{"type":"leads"}'));
    tn := tn || text 'A a signed-in non-admin gets FORBIDDEN'; td := td || r::text; tp := tp || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.gvp_call(adm, 'select to_jsonb(count(*)) from public.growth__vdperf_people(null, null, null, null)');
    tn := tn || text 'A private helper growth__vdperf_people is not callable, even by an admin'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    r := pg_temp.gvp_call(adm, pg_temp.gvp_rpc('growth_vd_perf_drill', '{"type":"leads","evil":1}'));
    tn := tn || text 'A unknown request keys are refused'; td := td || r::text; tp := tp || (r->>'message' = 'UNKNOWN_KEY: evil');
    select string_agg(format('%s:%s', p.proname, p.prosecdef), ',') into s from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('growth_vd_perf_drill', 'growth__vdperf_people')
       and p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=""%';
    tn := tn || text 'A both functions are SECURITY DEFINER with an empty search_path'; td := td || coalesce(s, 'none');
    tp := tp || (s like '%growth_vd_perf_drill%' and s like '%growth__vdperf_people%');
    select string_agg(coalesce(p.proacl::text, 'null'), ' ') into s from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'growth_vd_perf_drill';
    tn := tn || text 'A the drill is granted to authenticated, not to anon or public'; td := td || coalesce(s, 'null');
    tp := tp || (s like '%authenticated=X%' and s not like '%anon=X%' and s !~ '(^|[{,])=X');

    -- ════ B. request checks ════
    tn := tn || text 'B type is required'; s := pg_temp.gvp_n(adm, '{}'); td := td || s; tp := tp || (s = 'BAD_VALUE: type');
    tn := tn || text 'B a wrong type is refused'; s := pg_temp.gvp_n(adm, '{"type":"views"}'); td := td || s; tp := tp || (s = 'BAD_VALUE: type');
    tn := tn || text 'B a wrong scope is refused'; s := pg_temp.gvp_n(adm, '{"type":"leads","scope":"week"}'); td := td || s; tp := tp || (s = 'BAD_VALUE: scope');
    tn := tn || text 'B enrolments have no in-window list (as the CRM card)'; s := pg_temp.gvp_n(adm, '{"type":"enrollments","scope":"in_window"}'); td := td || s; tp := tp || (s = 'BAD_VALUE: scope');
    tn := tn || text 'B From after To is refused'; s := pg_temp.gvp_n(adm, '{"type":"leads","start":"2091-03-01","end":"2091-01-01"}'); td := td || s; tp := tp || (s = 'BAD_VALUE: start');
    tn := tn || text 'B a bad date is refused'; s := pg_temp.gvp_n(adm, '{"type":"leads","start":"2091-13-45"}'); td := td || s; tp := tp || (s like 'BAD_VALUE%');

    -- ════ C. who is listed (rows in 2091 only) ════
    tn := tn || text 'C leads in window: a1 (A Jan), a2 (C Feb), b1 (B Feb)';
    s := pg_temp.gvp_tags(adm, base || '{"type":"leads","scope":"in_window"}'); td := td || s; tp := tp || (s = 'a1,a2,b1');
    tn := tn || text 'C leads all time: every UTM lead once, staff and trashed rows left out';
    s := pg_temp.gvp_tags(adm, base || '{"type":"leads","scope":"all_time"}'); td := td || s; tp := tp || (s = 'a1,a2,a3,b1,b2');
    tn := tn || text 'C payments in window: in-window leads who paid';
    s := pg_temp.gvp_tags(adm, base || '{"type":"payments","scope":"in_window"}'); td := td || s; tp := tp || (s = 'a1,b1');
    tn := tn || text 'C payments all time: every UTM lead who paid';
    s := pg_temp.gvp_tags(adm, base || '{"type":"payments","scope":"all_time"}'); td := td || s; tp := tp || (s = 'a1,a3,b1');
    tn := tn || text 'C enrolments: enrolled UTM leads';
    s := pg_temp.gvp_tags(adm, base || '{"type":"enrollments"}'); td := td || s; tp := tp || (s = 'a1');
    tn := tn || text 'C scope defaults to all time';
    s := pg_temp.gvp_n(adm, base || '{"type":"leads"}'); td := td || s; tp := tp || (s = '5');

    -- ════ D. filters (as the page's From / To / Campaign / Channel) ════
    tn := tn || text 'D channel filter: Chan B only';
    s := pg_temp.gvp_tags(adm, base || '{"type":"leads","scope":"all_time","channel":"ZZTEST Chan B"}'); td := td || s; tp := tp || (s = 'b1,b2');
    tn := tn || text 'D campaign filter (worked out from Live Date): ZZVP Jan → row A only, in window a1';
    s := pg_temp.gvp_tags(adm, base || '{"type":"leads","scope":"in_window","campaign":"ZZVP Jan"}'); td := td || s; tp := tp || (s = 'a1');
    tn := tn || text 'D campaign filter, all time: every lead of row A''s UTM';
    s := pg_temp.gvp_tags(adm, base || '{"type":"leads","scope":"all_time","campaign":"ZZVP Jan"}'); td := td || s; tp := tp || (s = 'a1,a2,a3');
    tn := tn || text 'D From filter on Live Date: rows B and C → in window a2, b1';
    s := pg_temp.gvp_tags(adm, '{"type":"leads","scope":"in_window","start":"2091-02-01","end":"2091-12-31"}'); td := td || s; tp := tp || (s = 'a2,b1');
    tn := tn || text 'D To filter on Live Date: row A only';
    s := pg_temp.gvp_tags(adm, '{"type":"leads","scope":"in_window","start":"2091-01-01","end":"2091-01-31"}'); td := td || s; tp := tp || (s = 'a1');
    tn := tn || text 'D a campaign that no row falls in lists nobody';
    s := pg_temp.gvp_n(adm, base || '{"type":"leads","campaign":"ZZVP Nope"}'); td := td || s; tp := tp || (s = '0');

    -- ════ E. the drill matches the Listing ════
    r := pg_temp.gvp_call(adm, pg_temp.gvp_rpc('growth_vd_list', '{"view":"active"}'));
    select format('%s/%s/%s/%s/%s', sum((x->>'leads')::int), sum((x->>'leads_all')::int), sum((x->>'payments')::int), sum((x->>'payments_all')::int), sum((x->>'enrollments_all')::int))
      into s from jsonb_array_elements(r->'rows') x where (x->>'id')::uuid in (ra, rb, rc);
    tn := tn || text 'E Listing column totals of the 3 rows (in-window leads add up to the drill: 3)'; td := td || s;
    tp := tp || (split_part(s, '/', 1) = pg_temp.gvp_n(adm, base || '{"type":"leads","scope":"in_window"}')
                 and split_part(s, '/', 3) = pg_temp.gvp_n(adm, base || '{"type":"payments","scope":"in_window"}'));
    tn := tn || text 'E all-time card adds rows up (rows A and C share a UTM), the drill lists each person once';
    td := td || (s || ' vs drill ' || pg_temp.gvp_n(adm, base || '{"type":"leads","scope":"all_time"}'));
    tp := tp || (split_part(s, '/', 2)::int = 8 and pg_temp.gvp_n(adm, base || '{"type":"leads","scope":"all_time"}') = '5');

    -- ════ F. columns (as the CRM drill) ════
    r := pg_temp.gvp_call(adm, pg_temp.gvp_rpc('growth_vd_perf_drill', base || '{"type":"leads","scope":"in_window"}'));
    tn := tn || text 'F leads list: the CRM''s 22 lead columns, in order'; td := td || (r->'columns')::text;
    tp := tp || (jsonb_array_length(r->'columns') = 22 and r->'columns'->>0 = 'user_id' and r->'columns'->>21 = 'updated_at'
                 and (select bool_and(r->'students'->0 ? c) from jsonb_array_elements_text(r->'columns') c));
    tn := tn || text 'F newest registration first'; td := td || coalesce(r->'students'->0->>'registered_name', 'none');
    tp := tp || (r->'students'->0->>'registered_name' = 'ZZTEST GVP a2');
    r := pg_temp.gvp_call(adm, pg_temp.gvp_rpc('growth_vd_perf_drill', base || '{"type":"enrollments"}'));
    tn := tn || text 'F enrolments list: the CRM''s 41 application columns, current stage = enrolled';
    td := td || format('%s cols, %s, %s', jsonb_array_length(r->'columns'), r->'students'->0->>'current_stage', r->'students'->0->>'application_no');
    tp := tp || (jsonb_array_length(r->'columns') = 41 and r->'students'->0->>'current_stage' = 'enrolled'
                 and r->'students'->0->>'application_no' = 'ZZGVP-a1'
                 and (select bool_and(r->'students'->0 ? c) from jsonb_array_elements_text(r->'columns') c));
    r := pg_temp.gvp_call(adm, pg_temp.gvp_rpc('growth_vd_perf_drill', base || '{"type":"payments","scope":"all_time"}'));
    tn := tn || text 'F a payer without an application still shows (application fields empty)';
    td := td || coalesce((select x::text from jsonb_array_elements(r->'students') x where x->>'registered_name' = 'ZZTEST GVP a3'), 'missing');
    tp := tp || exists (select 1 from jsonb_array_elements(r->'students') x where x->>'registered_name' = 'ZZTEST GVP a3' and x->>'application_no' is null);
    tn := tn || text 'F total and truncated are returned'; td := td || format('%s %s', r->>'total', r->>'truncated');
    tp := tp || (r->>'total' = '3' and r->>'truncated' = 'false');

    -- ════ G. speed ════
    insert into public.growth_vd_rows (channel, utm_link, live_date, cpa, video_spend)
      select 'ZZTEST load ' || g, 'https://y.invalid/zzvpload?utm_source=zzvpload' || g || '&utm_medium=yt&utm_campaign=zz', date '2091-02-10', 40, 1500
        from generate_series(1, 2000) g;
    t0 := clock_timestamp();
    s := pg_temp.gvp_n(adm, '{"type":"leads","scope":"all_time"}');
    ms := round(extract(epoch from clock_timestamp() - t0) * 1000);
    tn := tn || text 'G speed: leads all time over 2000+ rows in under 1 second (CRM: ~25 s)'; td := td || (ms || ' ms, total ' || s);
    tp := tp || (ms < 1000 and s ~ '^\d+$');
    t0 := clock_timestamp();
    s := pg_temp.gvp_n(adm, '{"type":"payments","scope":"in_window"}');
    ms := round(extract(epoch from clock_timestamp() - t0) * 1000);
    tn := tn || text 'G speed: payments in window over 2000+ rows in under 1 second'; td := td || (ms || ' ms, total ' || s);
    tp := tp || (ms < 1000 and s ~ '^\d+$');

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;
  return query select * from unnest(tn, tp, td);
end $$;

select * from pg_temp.run_growth_vp_tests();
