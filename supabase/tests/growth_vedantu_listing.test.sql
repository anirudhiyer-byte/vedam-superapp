-- Growth → Vedantu Channel → Vedantu Listing · tests for migration 0136 (STAGING ONLY)
--
-- How to run: apply 0136 on staging, then paste this whole file into the staging SQL editor (or the Supabase MCP) in ONE call.
-- The last statement returns one row per test: test | pass | detail. Everything is rolled back at the end (ZDONE).
-- Fake data only (ZZTEST names, zzvd* UTMs, ZZVD campaigns in 2091-2094). Refuses to run unless app_flags.environment = 'staging'.

create or replace function pg_temp.gvd_user(p_email text)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  values (v, p_email, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id, email, full_name) values (v, p_email, 'ZZTEST ' || split_part(p_email, '@', 1))
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
  return v;
end $$;

-- a lead registered on p_reg with a first-touch UTM; optional paid VSAT fee and approved enrolment
create or replace function pg_temp.gvd_lead(p_tag text, p_email text, p_src text, p_reg timestamptz, p_paid boolean, p_enrolled boolean default false)
returns uuid language plpgsql as $$
declare u uuid := pg_temp.gvd_user('zztest-gvd-' || p_tag || '@example.invalid');
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, utm_source, utm_medium, utm_campaign, created_at, user_registration_date)
  values (u, 'ZZTEST GVD ' || p_tag, p_email, p_src, 'zzvdmed', 'zz vd', p_reg, p_reg)
  on conflict (lead_id) do update set registered_email = excluded.registered_email, utm_source = excluded.utm_source,
    utm_medium = excluded.utm_medium, utm_campaign = excluded.utm_campaign, created_at = excluded.created_at,
    user_registration_date = excluded.user_registration_date;
  if p_paid then
    insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider, amount, currency)
    values (u, p_reg + interval '2 days', 'ZZTEST-GVD-' || p_tag, 'simulated', 500, 'INR');
  end if;
  if p_enrolled then
    insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email)
    values ('ZZGVD-' || p_tag, u, 'ZZGVD-' || p_tag, 'ZZTEST ' || p_tag, 'zztest-gvd-' || p_tag || '@example.invalid');
    update public.application_manager set enrollment_stage = 'approved', enrollment_paid_at = p_reg + interval '10 days'
     where application_id = 'ZZGVD-' || p_tag;
  end if;
  return u;
end $$;

create or replace function pg_temp.gvd_call(p_uid uuid, p_sql text, p_anon boolean default false)
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

create or replace function pg_temp.gvd_rpc(p_fn text, p jsonb)
returns text language sql as $$ select format('select public.%I(%L::jsonb)', p_fn, p::text) $$;

create or replace function pg_temp.gvd_row(p_res jsonb, p_id uuid)
returns jsonb language sql as $$ select x from jsonb_array_elements(p_res->'rows') x where x->>'id' = p_id::text $$;

create or replace function pg_temp.gvd_err_detail(p_uid uuid, p_sql text)
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

create or replace function pg_temp.gvd_fmt(x jsonb)
returns text language sql as $$
  select format('%s/%s/%s · %s/%s/%s', x->>'leads', x->>'payments', x->>'enrollments', x->>'leads_all', x->>'payments_all', x->>'enrollments_all')
$$;

create or replace function pg_temp.run_growth_vd_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  tn text[] := '{}'; tp boolean[] := '{}'; td text[] := '{}';
  adm uuid; usr uuid; r jsonb; x jsonb; s text; n int; t0 timestamptz; ms int; ids jsonb; r1 uuid; r2 uuid; r3 uuid; rg uuid; k text; keys jsonb;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid; c6 uuid; c7 uuid; c8 uuid; inf uuid;
  u1 text := 'https://vedantu.invalid/?utm_source=ZZVD&utm_medium=zzvdmed&utm_campaign=zz%20vd';
  u2 text := 'https://apply.vedam.org/?utm_source=zzvd2&utm_medium=zzvdmed&utm_campaign=zz%20vd';
  pub text[] := array['growth_vd_list', 'growth_vd_save', 'growth_vd_bulk_update', 'growth_vd_trash', 'growth_vd_purge',
                      'growth_vd_import', 'growth_vd_col_add', 'growth_vd_col_update', 'growth_vd_col_unhide_all',
                      'growth_vd_col_order', 'growth_vd_col_remove'];
begin
  begin -- rolled back at the end (ZDONE)
    if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
      raise exception 'Refusing to run: this is not the staging database.';
    end if;
    perform set_config('vedam.allow_simulated_payments', 'on', true);
    adm := pg_temp.gvd_user('zztest-gvd-admin@example.invalid');
    insert into public.user_roles (user_id, role) values (adm, 'admin');
    usr := pg_temp.gvd_user('zztest-gvd-user@example.invalid');
    insert into public.vsat_campaigns (name, campaign_start, campaign_end) values ('ZZVD Jan', '2091-01-01', '2091-01-31') returning id into c1;
    insert into public.vsat_campaigns (name, campaign_start, campaign_end) values ('ZZVD Feb', '2091-02-01', '2091-02-28') returning id into c2;
    insert into public.vsat_campaigns (name, campaign_start, campaign_end) values ('ZZVD Unused', '2091-04-01', '2091-04-30') returning id into c3;
    insert into public.vsat_campaigns (name, campaign_start, campaign_end) values ('ZZVD Wide', '2093-01-01', '2093-12-31') returning id into c4;
    insert into public.vsat_campaigns (name, campaign_start, campaign_end) values ('ZZVD Narrow', '2093-06-01', '2093-06-30') returning id into c5;
    insert into public.vsat_campaigns (name, campaign_start, campaign_end) values ('ZZVD Ads', '2094-01-01', '2094-01-31') returning id into c6;
    insert into public.vsat_campaigns (name, campaign_start, campaign_end) values ('ZZVD Infl', '2094-02-01', '2094-02-28') returning id into c7;
    insert into public.vsat_campaigns (name, campaign_start, campaign_end) values ('ZZVD TG', '2094-03-01', '2094-03-31') returning id into c8;

    -- ════ A. security ════
    r := pg_temp.gvd_call(null, pg_temp.gvd_rpc('growth_vd_list', '{}'), true);
    tn := tn || text 'A anon cannot call growth_vd_list'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    r := pg_temp.gvd_call(usr, pg_temp.gvd_rpc('growth_vd_list', '{}'));
    tn := tn || text 'A a signed-in non-admin gets FORBIDDEN'; td := td || r::text; tp := tp || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.gvd_call(usr, pg_temp.gvd_rpc('growth_vd_save', jsonb_build_object('row', jsonb_build_object(
           'channel', 'ZZTEST hack', 'utm_link', 'https://x.invalid/?utm_source=zzhack', 'live_date', '2091-01-10'))));
    tn := tn || text 'A a non-admin cannot add a row'; td := td || r::text; tp := tp || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.gvd_call(usr, pg_temp.gvd_rpc('growth_vd_import', '{"rows":[{"channel":"x"}]}'));
    tn := tn || text 'A a non-admin cannot import'; td := td || r::text; tp := tp || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.gvd_call(adm, 'select to_jsonb(count(*)) from public.growth__vd_attr(false)');
    tn := tn || text 'A private helper growth__vd_attr is not callable, even by an admin'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    r := pg_temp.gvd_call(adm, 'select to_jsonb(public.growth__vd_campaign(date ''2091-01-10''))');
    tn := tn || text 'A private helper growth__vd_campaign is not callable, even by an admin'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    r := pg_temp.gvd_call(adm, 'select to_jsonb(count(*)) from public.growth_vd_rows');
    tn := tn || text 'A the rows table is not readable from the browser, even by an admin'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    r := pg_temp.gvd_call(adm, 'select to_jsonb(count(*)) from public.growth_vd_columns');
    tn := tn || text 'A the columns table is not readable from the browser, even by an admin'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_list', '{"view":"active","evil":1}'));
    tn := tn || text 'A unknown request keys are refused'; td := td || r::text; tp := tp || (r->>'message' = 'UNKNOWN_KEY: evil');
    select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any (pub)
       and p.prosecdef and p.proconfig = array['search_path=""']
       and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
       and not has_function_privilege('public', p.oid, 'execute');
    tn := tn || text 'A all 11 RPCs: SECURITY DEFINER, search_path empty, authenticated only'; td := td || n::text; tp := tp || (n = 11);
    select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'growth\_\_vd\_%'
       and p.proconfig = array['search_path=""']
       and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
       and not has_function_privilege('public', p.oid, 'execute');
    tn := tn || text 'A all 9 private helpers: search_path empty, no browser access'; td := td || n::text; tp := tp || (n = 9);
    select count(*) into n from pg_class c where c.oid in ('public.growth_vd_rows'::regclass, 'public.growth_vd_columns'::regclass)
       and c.relrowsecurity and not exists (select 1 from pg_policy pl where pl.polrelid = c.oid)
       and not has_table_privilege('anon', c.oid, 'select') and not has_table_privilege('authenticated', c.oid, 'select')
       and not has_table_privilege('authenticated', c.oid, 'insert') and not has_table_privilege('authenticated', c.oid, 'update')
       and not has_table_privilege('authenticated', c.oid, 'delete');
    tn := tn || text 'A both tables: RLS on, no policies, no grants'; td := td || n::text; tp := tp || (n = 2);
    select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'growth_campaign_delete'
       and p.prosecdef and p.proconfig = array['search_path=""']
       and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
       and not has_function_privilege('public', p.oid, 'execute');
    tn := tn || text 'A growth_campaign_delete (re-created by 0136) keeps its access: authenticated only'; td := td || n::text; tp := tp || (n = 1);
    select count(*) into n from pg_trigger t where t.tgrelid in ('public.growth_vd_rows'::regclass, 'public.growth_vd_columns'::regclass)
       and not t.tgisinternal and t.tgname in ('trg_audit_growth_vd_rows', 'trg_audit_growth_vd_columns', 'trg_growth_vd_rows_key');
    tn := tn || text 'A audit triggers on both tables + the UTM key trigger exist'; td := td || n::text; tp := tp || (n = 3);

    -- ════ B. columns ════
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_list', '{}'));
    s := (select string_agg(v->>'key', ',' order by o) from jsonb_array_elements(r->'columns') with ordinality q(v, o) where (v->>'standard')::boolean);
    tn := tn || text 'B the 18 standard columns, in order'; td := td || coalesce(s, r::text);
    tp := tp || (s = 'serial_no,channel,live_link,utm_link,live_date,campaign,expected_views,actual_views,video_spend,cpa,total_cpa,total_spend,leads,payments,leads_all,payments_all,enrollments,notes');
    tn := tn || text 'B Serial No starts hidden, every other column is shown';
    s := (select string_agg(v->>'key', ',') from jsonb_array_elements(r->'columns') v where (v->>'hidden')::boolean);
    td := td || coalesce(s, 'none'); tp := tp || (s = 'serial_no');
    tn := tn || text 'B Channel, UTM Link and Live Date are required; the computed columns are typed computed';
    s := (select string_agg(v->>'key', ',' order by v->>'key') from jsonb_array_elements(r->'columns') v where (v->>'required')::boolean);
    td := td || coalesce(s, 'none');
    tp := tp || (s = 'channel,live_date,utm_link' and (select count(*) from jsonb_array_elements(r->'columns') v where v->>'type' = 'computed') = 9);

    -- ════ C. save ════
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_save', jsonb_build_object('row', jsonb_build_object('utm_link', u1, 'live_date', '2091-01-10'))));
    tn := tn || text 'C channel is required'; td := td || r::text; tp := tp || (r->>'message' = 'REQUIRED: channel');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_save', jsonb_build_object('row', jsonb_build_object('channel', 'ZZTEST A', 'live_date', '2091-01-10'))));
    tn := tn || text 'C UTM link is required'; td := td || r::text; tp := tp || (r->>'message' = 'REQUIRED: utm_link');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_save', jsonb_build_object('row', jsonb_build_object('channel', 'ZZTEST A', 'utm_link', u1))));
    tn := tn || text 'C live date is required'; td := td || r::text; tp := tp || (r->>'message' = 'REQUIRED: live_date');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_save', jsonb_build_object('row', jsonb_build_object('channel', 'ZZTEST A', 'utm_link', 'javascript:alert(1)', 'live_date', '2091-01-10'))));
    tn := tn || text 'C a non-http UTM link is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: utm_link');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_save', jsonb_build_object('row', jsonb_build_object('channel', 'ZZTEST A', 'utm_link', u1, 'live_date', '2091-01-10', 'live_link', 'ftp://x.invalid/v'))));
    tn := tn || text 'C a non-http live link is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: live_link');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_save', jsonb_build_object('row', jsonb_build_object('channel', 'ZZTEST A', 'utm_link', u1, 'live_date', '2091-01-10', 'video_spend', '-1'))));
    tn := tn || text 'C a negative video spend is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: video_spend');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_save', jsonb_build_object('row', jsonb_build_object('channel', 'ZZTEST A', 'utm_link', u1, 'live_date', '2091-02-30'))));
    tn := tn || text 'C an impossible date is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: live_date');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_save', jsonb_build_object('row', jsonb_build_object('channel', ' ZZTEST Alpha ', 'live_link', 'https://youtu.be/zzvd',
           'utm_link', u1, 'live_date', '2091-01-10', 'expected_views', '10,000', 'actual_views', '12345.6', 'video_spend', '₹2,000', 'cpa', '300'))));
    r1 := (r->>'id')::uuid;
    select format('%s|%s|%s|%s|%s|%s|%s', channel, (public.growth__vd_campaign(live_date) = c1)::text, expected_views, actual_views, video_spend, cpa, live_link)
      into s from public.growth_vd_rows where id = r1;
    tn := tn || text 'C a valid row: trimmed channel, ₹ and commas accepted, views rounded to whole numbers'; td := td || coalesce(s, r::text);
    tp := tp || (s = 'ZZTEST Alpha|true|10000|12346|2000.00|300.00|https://youtu.be/zzvd');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_save', jsonb_build_object('row', jsonb_build_object('channel', 'ZZTEST Beta', 'utm_link', upper(u1), 'live_date', '2091-01-25'))));
    tn := tn || text 'C the same UTM (other case) in the same VSAT window, on another day, is refused'; td := td || r::text; tp := tp || (r->>'message' = 'DUPLICATE_UTM');
    s := pg_temp.gvd_err_detail(adm, pg_temp.gvd_rpc('growth_vd_save', jsonb_build_object('row', jsonb_build_object('channel', 'ZZTEST Beta',
           'utm_link', 'https://other.invalid/x?utm_campaign=zz%20vd&utm_medium=ZZVDMED&utm_source=zzvd', 'live_date', '2091-01-31'))));
    tn := tn || text 'C the same source / medium / campaign in the same VSAT is refused and names the row'; td := td || s;
    tp := tp || (s = 'DUPLICATE_UTM | ZZTEST Alpha');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_save', jsonb_build_object('row', jsonb_build_object('channel', 'ZZTEST Alpha', 'utm_link', u1, 'live_date', '05-02-2091', 'cpa', '500'))));
    r2 := (r->>'id')::uuid;
    tn := tn || text 'C the same UTM in another VSAT is allowed (DD-MM-YYYY date accepted)'; td := td || r::text;
    tp := tp || (r2 is not null and (select live_date = date '2091-02-05' from public.growth_vd_rows where id = r2));
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_save', jsonb_build_object('row', jsonb_build_object('channel', 'ZZTEST Alpha', 'utm_link', u1, 'live_date', '2091-03-15'))));
    r3 := (r->>'id')::uuid;
    tn := tn || text 'C a live date outside every VSAT is allowed (empty Campaign)'; td := td || r::text; tp := tp || (r3 is not null);
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_save', jsonb_build_object('row', jsonb_build_object('channel', 'ZZTEST Beta', 'utm_link', u1, 'live_date', '2091-03-20'))));
    tn := tn || text 'C two rows with no VSAT and the same UTM are a duplicate'; td := td || r::text; tp := tp || (r->>'message' = 'DUPLICATE_UTM');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_save', jsonb_build_object('row', jsonb_build_object('id', r1, 'channel', 'ZZTEST Alpha',
           'utm_link', u1, 'live_date', '2091-01-10', 'expected_views', '10000', 'actual_views', '12346', 'video_spend', '2000', 'cpa', '300'))));
    tn := tn || text 'C editing a row keeps its own UTM (not a duplicate of itself)'; td := td || r::text; tp := tp || ((r->>'id')::uuid = r1);

    -- ════ D. attribution: in-window = registered inside the VSAT (derived from the live date) start..end ════
    perform pg_temp.gvd_lead('a', 'zzgvd-a@example.invalid', 'zzvd', '2091-01-05 12:00+05:30', true, true);    -- Jan, paid, enrolled
    perform pg_temp.gvd_lead('b', 'zzgvd-b@example.invalid', 'zzvd', '2091-01-20 12:00+05:30', false);          -- Jan, not paid
    perform pg_temp.gvd_lead('c', 'zzgvd-c@example.invalid', 'zzvd', '2091-03-10 12:00+05:30', true);           -- March: outside both, paid
    perform pg_temp.gvd_lead('s', 'zzgvd-s@VEDAM.org', 'zzvd', '2091-01-06 12:00+05:30', true);                -- staff
    perform pg_temp.gvd_lead('e', 'zzgvd-e@example.invalid', 'zzvd', '2091-01-31 23:30+05:30', false);         -- last day of Jan (IST)
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_list', '{"view":"active"}'));
    x := pg_temp.gvd_row(r, r1);
    tn := tn || text 'D Jan row: in-window 3 leads (a, b, e) · 1 payment · 1 enrolment; all-time 4 · 2 · 1; staff left out';
    td := td || coalesce(pg_temp.gvd_fmt(x), r::text); tp := tp || (pg_temp.gvd_fmt(x) = '3/1/1 · 4/2/1');
    x := pg_temp.gvd_row(r, r2);
    tn := tn || text 'D Feb row (same UTM): nothing in its window; same all-time numbers';
    td := td || coalesce(pg_temp.gvd_fmt(x), r::text); tp := tp || (pg_temp.gvd_fmt(x) = '0/0/0 · 4/2/1');
    x := pg_temp.gvd_row(r, r3);
    tn := tn || text 'D row with no VSAT: no window numbers, all-time numbers still shown';
    td := td || coalesce(pg_temp.gvd_fmt(x), r::text); tp := tp || (pg_temp.gvd_fmt(x) = '0/0/0 · 4/2/1' and x->>'campaign' is null and x->>'campaign_id' is null);
    x := pg_temp.gvd_row(r, r1);
    tn := tn || text 'D the row carries the derived VSAT name and id, the views, the spend, the CPA and the UTM key'; td := td || coalesce(x::text, '');
    tp := tp || (x->>'campaign' = 'ZZVD Jan' and x->>'campaign_id' = c1::text and (x->>'expected_views')::bigint = 10000 and (x->>'actual_views')::bigint = 12346
                 and (x->>'video_spend')::numeric = 2000 and (x->>'cpa')::numeric = 300 and x->>'utm_key' = 'zzvd/zzvdmed/zz vd'
                 and x->>'live_date' = '2091-01-10');
    tn := tn || text 'D the list is newest live date first'; td := td || (r->'rows'->0->>'live_date');
    tp := tp || ((r->'rows'->0->>'live_date')::date = (select max(live_date) from public.growth_vd_rows where deleted_at is null));
    tn := tn || text 'D counts: active = rows in the table, trash = 0'; td := td || (r->'counts')::text;
    tp := tp || ((r->'counts'->>'active')::int = (select count(*) from public.growth_vd_rows where deleted_at is null) and (r->'counts'->>'trash')::int = 0);

    -- ════ E. bulk update / inline ════
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_bulk_update', jsonb_build_object('ids', jsonb_build_array(r1, r2), 'key', 'cpa', 'value', '750')));
    select string_agg(cpa::text, ',') into s from public.growth_vd_rows where id in (r1, r2);
    tn := tn || text 'E bulk update sets CPA on both rows'; td := td || coalesce(s, r::text); tp := tp || (r->>'changed' = '2' and s = '750.00,750.00');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_bulk_update', jsonb_build_object('ids', jsonb_build_array(r1, r2), 'key', 'actual_views', 'value', '999')));
    select string_agg(actual_views::text, ',') into s from public.growth_vd_rows where id in (r1, r2);
    tn := tn || text 'E bulk update sets Actual Views'; td := td || coalesce(s, r::text); tp := tp || (r->>'changed' = '2' and s = '999,999');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_bulk_update', jsonb_build_object('ids', jsonb_build_array(r2), 'key', 'live_date', 'value', '2091-01-12')));
    tn := tn || text 'E moving the Feb row into Jan (where the same UTM is) is refused'; td := td || r::text; tp := tp || (r->>'message' = 'DUPLICATE_UTM');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_bulk_update', jsonb_build_object('ids', jsonb_build_array(r2), 'key', 'live_date', 'value', '2091-04-10')));
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_list', '{}'));
    tn := tn || text 'E inline live date change: the Campaign follows the date'; td := td || coalesce(pg_temp.gvd_row(r, r2)->>'campaign', 'null');
    tp := tp || (pg_temp.gvd_row(r, r2)->>'campaign_id' = c3::text);
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_bulk_update', jsonb_build_object('ids', jsonb_build_array(r1, r2), 'key', 'utm_link', 'value', u2)));
    tn := tn || text 'E UTM link cannot be bulk updated'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: key');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_bulk_update', jsonb_build_object('ids', jsonb_build_array(r1), 'key', 'total_spend', 'value', '9')));
    tn := tn || text 'E a computed column cannot be set'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: key');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_bulk_update', jsonb_build_object('ids', jsonb_build_array(r1), 'key', 'campaign', 'value', 'ZZVD Feb')));
    tn := tn || text 'E Campaign cannot be set (it follows the live date)'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: key');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_bulk_update', jsonb_build_object('ids', jsonb_build_array(r1), 'key', 'channel', 'value', '')));
    tn := tn || text 'E a required column cannot be emptied'; td := td || r::text; tp := tp || (r->>'message' = 'REQUIRED: channel');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_bulk_update', jsonb_build_object('ids', jsonb_build_array(r1), 'key', 'live_date', 'value', null)));
    tn := tn || text 'E Live Date cannot be cleared'; td := td || r::text; tp := tp || (r->>'message' = 'REQUIRED: live_date');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_bulk_update', jsonb_build_object('ids', jsonb_build_array(gen_random_uuid()), 'key', 'cpa', 'value', '1')));
    tn := tn || text 'E a row that does not exist is refused'; td := td || r::text; tp := tp || (r->>'message' = 'NOT_FOUND');

    -- ════ F. trash / restore / delete ════
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_trash', jsonb_build_object('ids', jsonb_build_array(r2), 'trash', true)));
    tn := tn || text 'F move to trash'; td := td || r::text; tp := tp || (r->>'changed' = '1');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_list', '{"view":"trash"}'));
    tn := tn || text 'F the trash view shows the row with its numbers'; td := td || coalesce(pg_temp.gvd_fmt(pg_temp.gvd_row(r, r2)), r::text);
    tp := tp || (pg_temp.gvd_row(r, r2) is not null and (pg_temp.gvd_row(r, r2)->>'leads_all')::int = 4 and jsonb_array_length(r->'rows') = 1);
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_save', jsonb_build_object('row', jsonb_build_object('channel', 'ZZTEST Gamma', 'utm_link', u1, 'live_date', '2091-04-12'))));
    rg := (r->>'id')::uuid;
    tn := tn || text 'F the UTM + VSAT of a trashed row can be used again'; td := td || r::text; tp := tp || (rg is not null);
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_trash', jsonb_build_object('ids', jsonb_build_array(r2), 'trash', false)));
    tn := tn || text 'F restoring it while that UTM + VSAT is live again is refused'; td := td || r::text;
    tp := tp || (r->>'message' = 'DUPLICATE_UTM' and (select deleted_at is not null from public.growth_vd_rows where id = r2));
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_purge', jsonb_build_object('ids', jsonb_build_array(r1, r2))));
    tn := tn || text 'F delete permanently removes only rows in the trash'; td := td || r::text;
    tp := tp || (r->>'deleted' = '1' and exists (select 1 from public.growth_vd_rows where id = r1) and not exists (select 1 from public.growth_vd_rows where id = r2));
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_trash', jsonb_build_object('ids', jsonb_build_array(r3), 'trash', true)));
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_trash', jsonb_build_object('ids', jsonb_build_array(r3), 'trash', false)));
    tn := tn || text 'F a trashed row with no clash restores fine'; td := td || r::text;
    tp := tp || (r->>'changed' = '1' and (select deleted_at is null from public.growth_vd_rows where id = r3));

    -- ════ G. CSV import ════
    select count(*) into n from public.growth_vd_rows;
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_import', jsonb_build_object('mode', 'upsert', 'rows', jsonb_build_array(
           jsonb_build_object('channel', 'ZZTEST Imp 1', 'utm_link', 'https://x.invalid/?utm_source=zzimp1', 'live_date', '2091-01-12'),
           jsonb_build_object('channel', 'ZZTEST Imp 2', 'utm_link', 'https://x.invalid/?utm_source=zzimp2', 'live_date', 'not a date')))));
    tn := tn || text 'G a file with one bad row imports nothing'; td := td || r::text;
    tp := tp || (r->>'message' = 'IMPORT_FAILED' and (select count(*) from public.growth_vd_rows) = n);
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_import', jsonb_build_object('mode', 'upsert', 'rows', jsonb_build_array(
           jsonb_build_object('channel', 'ZZTEST Imp 1', 'utm_link', 'https://x.invalid/?utm_source=zzimp1', 'live_date', '2091-01-12'),
           jsonb_build_object('channel', 'ZZTEST Alpha', 'utm_link', u1, 'live_date', '2091-01-10', 'expected_views', '20000')))));
    tn := tn || text 'G upsert: 1 added, 1 updated by its UTM + VSAT (other values kept)'; td := td || r::text;
    tp := tp || (r->>'added' = '1' and r->>'updated' = '1'
                 and (select expected_views = 20000 and cpa = 750 and video_spend = 2000 and actual_views = 999 from public.growth_vd_rows where id = r1));
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_import', jsonb_build_object('mode', 'upsert', 'rows', jsonb_build_array(
           jsonb_build_object('channel', 'ZZTEST Alpha', 'utm_link', u1, 'live_date', '2091-02-08')))));
    tn := tn || text 'G upsert: same UTM in another VSAT is a new row'; td := td || r::text; tp := tp || (r->>'added' = '1');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_import', jsonb_build_object('mode', 'upsert', 'rows', jsonb_build_array(
           jsonb_build_object('channel', 'ZZTEST Imp 1', 'utm_link', 'https://x.invalid/?utm_source=zzimp1', 'notes', 'ZZ note')))));
    tn := tn || text 'G upsert: a file without a live date matches by UTM and keeps the row''s date'; td := td || r::text;
    tp := tp || (r->>'updated' = '1' and (select notes = 'ZZ note' and live_date = date '2091-01-12' from public.growth_vd_rows where utm_link like '%zzimp1'));
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_import', jsonb_build_object('mode', 'add', 'rows', jsonb_build_array(
           jsonb_build_object('channel', 'ZZTEST Alpha 2', 'utm_link', u1, 'live_date', '2091-01-10')))));
    tn := tn || text 'G add mode: a UTM + VSAT already in the list is an error'; td := td || r::text; tp := tp || (r->>'message' = 'IMPORT_FAILED');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_import', jsonb_build_object('mode', 'add', 'rows', jsonb_build_array(
           jsonb_build_object('channel', 'ZZTEST No Date', 'utm_link', 'https://x.invalid/?utm_source=zznodate')))));
    tn := tn || text 'G add mode: a row without a live date is an error'; td := td || r::text; tp := tp || (r->>'message' = 'IMPORT_FAILED');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_import', jsonb_build_object('rows',
           (select jsonb_agg(jsonb_build_object('channel', 'x')) from generate_series(1, 2001)))));
    tn := tn || text 'G more than 2000 rows is refused'; td := td || left(r::text, 120); tp := tp || (r->>'message' = 'TOO_MANY_ROWS');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_import', '{"rows":[{"channel":"x"}],"mode":"replace"}'));
    tn := tn || text 'G an unknown mode is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: mode');

    -- ════ H. columns ════
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_col_add', '{"label":"ZZ Reviewer","type":"text"}'));
    k := r->>'key';
    tn := tn || text 'H add a text column'; td := td || r::text; tp := tp || (k = 'x_zz_reviewer');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_col_add', '{"label":"Channel","type":"number"}'));
    tn := tn || text 'H a label used by a standard column is refused'; td := td || r::text; tp := tp || (r->>'message' = 'DUPLICATE');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_col_add', '{"label":"ZZ Bad","type":"select"}'));
    tn := tn || text 'H only Text / Number / Date / URL columns can be added'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: type');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_bulk_update', jsonb_build_object('ids', jsonb_build_array(r1), 'key', k, 'value', 'Ravi')));
    tn := tn || text 'H a value for the added column is saved'; td := td || r::text;
    tp := tp || ((select extra->>k from public.growth_vd_rows where id = r1) = 'Ravi');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_save', jsonb_build_object('row', jsonb_build_object('id', r1, 'channel', 'ZZTEST Alpha', 'utm_link', u1,
           'live_date', '2091-01-10', 'extra', jsonb_build_object('x_zz_nope', '1')))));
    tn := tn || text 'H a value for a column that does not exist is refused'; td := td || r::text; tp := tp || (r->>'message' = 'UNKNOWN_KEY: x_zz_nope');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_col_remove', '{"key":"channel"}'));
    tn := tn || text 'H a standard column cannot be removed'; td := td || r::text; tp := tp || (r->>'message' = 'SYSTEM_COLUMN');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_col_update', jsonb_build_object('key', 'cpa', 'label', 'ZZ Cost per action', 'hidden', true)));
    tn := tn || text 'H rename + hide a standard column'; td := td || r::text;
    tp := tp || ((select label = 'ZZ Cost per action' and is_hidden from public.growth_vd_columns where col_key = 'cpa' and deleted_at is null));
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_col_update', jsonb_build_object('key', 'notes', 'label', 'zz cost per ACTION')));
    tn := tn || text 'H a label already used by another column is refused'; td := td || r::text; tp := tp || (r->>'message' = 'DUPLICATE');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_col_unhide_all', '{}'));
    tn := tn || text 'H unhide all'; td := td || r::text; tp := tp || (not exists (select 1 from public.growth_vd_columns where is_hidden and deleted_at is null));
    select jsonb_agg(col_key order by case col_key when 'live_date' then 0 else 1 end, display_order) into keys from public.growth_vd_columns where deleted_at is null;
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_col_order', jsonb_build_object('keys', keys)));
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_list', '{}'));
    tn := tn || text 'H reorder: Live Date moved to the front'; td := td || coalesce(r->'columns'->0->>'key', r::text); tp := tp || (r->'columns'->0->>'key' = 'live_date');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_col_order', '{"keys":["live_date"]}'));
    tn := tn || text 'H a reorder that leaves columns out is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: keys');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_col_remove', jsonb_build_object('key', k)));
    tn := tn || text 'H an added column can be removed (its values stay in the row)'; td := td || r::text;
    tp := tp || (r->>'ok' = 'true' and (select extra->>k from public.growth_vd_rows where id = r1) = 'Ravi');

    -- ════ I. campaigns in use ════
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_campaign_delete', jsonb_build_object('id', c1)));
    tn := tn || text 'I a VSAT whose window holds a Vedantu live date cannot be deleted'; td := td || r::text; tp := tp || (r->>'message' = 'IN_USE');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_trash', jsonb_build_object('ids', jsonb_build_array(rg), 'trash', true)));
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_campaign_delete', jsonb_build_object('id', c3)));
    tn := tn || text 'I a trashed Vedantu row still protects its VSAT'; td := td || r::text; tp := tp || (r->>'message' = 'IN_USE');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_purge', jsonb_build_object('ids', jsonb_build_array(rg))));
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_campaign_delete', jsonb_build_object('id', c3)));
    tn := tn || text 'I once the row is gone the VSAT can be deleted'; td := td || r::text; tp := tp || (r->>'ok' = 'true');
    insert into public.growth_ad_rows (ad_name, platform, campaign_id) values ('ZZTEST ad', 'Meta', c6);
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_campaign_delete', jsonb_build_object('id', c6)));
    tn := tn || text 'I (kept from 0105) a VSAT used by an ad row cannot be deleted'; td := td || r::text; tp := tp || (r->>'message' = 'IN_USE');
    insert into public.growth_influencers (name) values ('ZZTEST creator') returning id into inf;
    insert into public.growth_infl_posts (influencer_id, platform, campaign_id) values (inf, 'Instagram Reel', c7);
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_campaign_delete', jsonb_build_object('id', c7)));
    tn := tn || text 'I (kept from 0105) a VSAT used by an influencer post cannot be deleted'; td := td || r::text; tp := tp || (r->>'message' = 'IN_USE');
    insert into public.growth_tg_rows (influencer_name, utm_link, campaign_id) values ('ZZTEST tg', 'https://t.me/zzvdtg?utm_source=zzvdtg&utm_medium=tg&utm_campaign=zz', c8);
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_campaign_delete', jsonb_build_object('id', c8)));
    tn := tn || text 'I (kept from 0132) a VSAT used by a Telegram row cannot be deleted'; td := td || r::text; tp := tp || (r->>'message' = 'IN_USE');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_campaign_delete', jsonb_build_object('id', c4)));
    tn := tn || text 'I an unused VSAT can still be deleted (then it is gone)'; td := td || r::text;
    tp := tp || (r->>'ok' = 'true' and not exists (select 1 from public.vsat_campaigns where id = c4));
    insert into public.vsat_campaigns (name, campaign_start, campaign_end) values ('ZZVD Wide', '2093-01-01', '2093-12-31') returning id into c4;

    -- ════ J. trash clean-up ════
    update public.growth_vd_rows set deleted_at = now() - interval '31 days' where id = r1;
    perform public.growth__vd_purge_old();
    tn := tn || text 'J rows in the trash for more than 30 days are deleted'; td := td || text 'see test';
    tp := tp || (not exists (select 1 from public.growth_vd_rows where id = r1));
    tn := tn || text 'J the daily clean-up job is scheduled';
    select string_agg(jobname || ' ' || schedule, ', ') into s from cron.job where jobname = 'growth-vd-trash-purge';
    td := td || coalesce(s, 'missing'); tp := tp || (s is not null);

    -- ════ K. derived VSAT: the VSAT whose dates hold the live date (latest start wins) ════
    tn := tn || text 'K a date inside two VSATs takes the one that started later';
    td := td || coalesce(public.growth__vd_campaign(date '2093-06-10')::text, 'null'); tp := tp || (public.growth__vd_campaign(date '2093-06-10') = c5);
    tn := tn || text 'K a date inside only the wide VSAT takes the wide one'; td := td || text 'see test'; tp := tp || (public.growth__vd_campaign(date '2093-03-10') = c4);
    tn := tn || text 'K the first and last day of a VSAT belong to it'; td := td || text 'see test';
    tp := tp || (public.growth__vd_campaign(date '2091-01-31') = c1 and public.growth__vd_campaign(date '2091-02-01') = c2);
    tn := tn || text 'K a date outside every VSAT, or no date, gives no VSAT'; td := td || text 'see test';
    tp := tp || (public.growth__vd_campaign(date '2095-01-01') is null and public.growth__vd_campaign(null) is null);
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_save', jsonb_build_object('row', jsonb_build_object('channel', 'ZZTEST Overlap', 'utm_link', u2, 'live_date', '2093-06-10'))));
    r1 := (r->>'id')::uuid;
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_list', '{}'));
    tn := tn || text 'K the list shows the derived VSAT name'; td := td || coalesce(pg_temp.gvd_row(r, r1)->>'campaign', r::text);
    tp := tp || (pg_temp.gvd_row(r, r1)->>'campaign' = 'ZZVD Narrow');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_save', jsonb_build_object('row', jsonb_build_object('channel', 'ZZTEST Overlap 2', 'utm_link', u2, 'live_date', '2093-03-10'))));
    tn := tn || text 'K the same UTM in the wide VSAT (other window) is allowed'; td := td || r::text; tp := tp || ((r->>'id') is not null);

    -- ════ L. bad input ════
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_list', '{"view":"x"}'));
    tn := tn || text 'L an unknown view is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: view');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_save', '{"row":5}'));
    tn := tn || text 'L a row that is not an object is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: row');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_save', jsonb_build_object('row', jsonb_build_object('channel', 'ZZTEST', 'utm_link', u2, 'live_date', '2091-01-10', 'evil', 1))));
    tn := tn || text 'L an unknown key inside the row is refused'; td := td || r::text; tp := tp || (r->>'message' = 'UNKNOWN_KEY: evil');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_save', jsonb_build_object('row', jsonb_build_object('id', gen_random_uuid(), 'channel', 'ZZTEST', 'utm_link', u2, 'live_date', '2091-01-10'))));
    tn := tn || text 'L editing a row that does not exist is refused'; td := td || r::text; tp := tp || (r->>'message' = 'NOT_FOUND');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_save', jsonb_build_object('row', jsonb_build_object('channel', repeat('a', 121), 'utm_link', u2, 'live_date', '2091-01-10'))));
    tn := tn || text 'L a channel name over 120 characters is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: channel');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_save', jsonb_build_object('row', jsonb_build_object('channel', 'ZZTEST', 'utm_link', u2, 'live_date', '2091-01-10', 'notes', repeat('n', 501)))));
    tn := tn || text 'L notes over 500 characters are refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: notes');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_save', jsonb_build_object('row', jsonb_build_object('channel', 'ZZTEST', 'utm_link', u2, 'live_date', '2091-01-10', 'expected_views', '-5'))));
    tn := tn || text 'L negative expected views are refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: expected_views');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_save', jsonb_build_object('row', jsonb_build_object('channel', 'ZZTEST', 'utm_link', u2, 'live_date', '2091-01-10', 'video_spend', 'abc'))));
    tn := tn || text 'L a video spend that is not a number is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: video_spend');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_bulk_update', '{"ids":[],"key":"cpa","value":"1"}'));
    tn := tn || text 'L an empty id list is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: ids');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_bulk_update', '{"ids":["not-a-uuid"],"key":"cpa","value":"1"}'));
    tn := tn || text 'L an id that is not a uuid is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: ids');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_trash', jsonb_build_object('ids', jsonb_build_array(r1), 'trash', 'yes')));
    tn := tn || text 'L trash needs true or false'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: trash');
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_purge', jsonb_build_object('ids', jsonb_build_array(r1))));
    tn := tn || text 'L delete permanently never removes a live row'; td := td || r::text;
    tp := tp || (r->>'deleted' = '0' and exists (select 1 from public.growth_vd_rows where id = r1));

    -- ════ M. stored UTM key, speed ════
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_save', jsonb_build_object('row', jsonb_build_object('channel', 'ZZTEST Key',
           'utm_link', 'https://y.invalid/k?utm_source=ZZKey&utm_medium=Yt&utm_campaign=zz%20k', 'live_date', '2091-02-12'))));
    r1 := (r->>'id')::uuid;
    select utm_key into s from public.growth_vd_rows where id = r1;
    tn := tn || text 'M a new row stores its UTM key'; td := td || coalesce(s, r::text);
    tp := tp || (s = public.growth__utm_key('https://y.invalid/k?utm_source=ZZKey&utm_medium=Yt&utm_campaign=zz%20k') and s is not null);
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_save', jsonb_build_object('row', jsonb_build_object('id', r1, 'channel', 'ZZTEST Key',
           'utm_link', 'https://y.invalid/k?utm_source=zzkey2&utm_medium=yt&utm_campaign=zz', 'live_date', '2091-02-12'))));
    select utm_key into s from public.growth_vd_rows where id = r1;
    tn := tn || text 'M editing the link updates the stored key'; td := td || coalesce(s, r::text);
    tp := tp || (s = public.growth__utm_key('https://y.invalid/k?utm_source=zzkey2&utm_medium=yt&utm_campaign=zz'));
    tn := tn || text 'M the key column is for the database only (browsers still cannot read the table)';
    r := pg_temp.gvd_call(adm, 'select to_jsonb(count(utm_key)) from public.growth_vd_rows'); td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    insert into public.growth_vd_rows (channel, utm_link, live_date, cpa, video_spend)
      select 'ZZTEST load ' || g, 'https://y.invalid/zzload?utm_source=zzload' || g || '&utm_medium=yt&utm_campaign=zz', date '2091-02-10', 40, 1500 from generate_series(1, 2000) g;
    select jsonb_agg(id) into ids from (select id from public.growth_vd_rows where channel like 'ZZTEST load %' limit 500) q;
    t0 := clock_timestamp();
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_list', '{"view":"active"}'));
    ms := round(extract(epoch from clock_timestamp() - t0) * 1000);
    tn := tn || text 'M speed: the list with 2000+ rows answers in under 1 second'; td := td || (ms || ' ms, ' || jsonb_array_length(r->'rows') || ' rows');
    tp := tp || (ms < 1000 and jsonb_array_length(r->'rows') >= 2000);
    t0 := clock_timestamp();
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_save', jsonb_build_object('row', jsonb_build_object('channel', 'ZZTEST Speed',
           'utm_link', 'https://y.invalid/speed?utm_source=zzspeed&utm_medium=yt&utm_campaign=zz', 'live_date', '2091-02-11'))));
    ms := round(extract(epoch from clock_timestamp() - t0) * 1000);
    tn := tn || text 'M speed: saving one row with 2000+ rows in the table takes under 500 ms'; td := td || (ms || ' ms, ' || left(r::text, 60));
    tp := tp || (ms < 500 and r->>'id' is not null);
    t0 := clock_timestamp();
    r := pg_temp.gvd_call(adm, pg_temp.gvd_rpc('growth_vd_bulk_update', jsonb_build_object('ids', ids, 'key', 'cpa', 'value', '45')));
    ms := round(extract(epoch from clock_timestamp() - t0) * 1000);
    tn := tn || text 'M speed: bulk update of 500 rows (out of 2000) in under 5 seconds'; td := td || (ms || ' ms, ' || r::text);
    tp := tp || (ms < 5000 and r->>'changed' = '500');

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;
  return query select * from unnest(tn, tp, td);
end $$;

select * from pg_temp.run_growth_vd_tests();
