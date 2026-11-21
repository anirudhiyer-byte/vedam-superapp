-- Growth → Consultants Channel → Consultant Listing · tests for migration 0130 (STAGING ONLY)
--
-- How to run: apply 0130 on staging, then paste this whole file into the staging SQL editor (or the Supabase MCP).
-- The last statement returns one row per test: test | pass | detail. Everything is rolled back at the end (ZDONE).
-- Fake data only (ZZTEST names, zzcons* UTMs, ZZCPN* coupons). Refuses to run unless app_flags.environment = 'staging'.

create or replace function pg_temp.gcl_user(p_email text)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  values (v, p_email, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id, email, full_name) values (v, p_email, 'ZZTEST ' || split_part(p_email, '@', 1))
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
  return v;
end $$;

-- a lead with a first-touch UTM (null source = no UTM); optional paid VSAT fee, order coupon (+ order status), enrolment
create or replace function pg_temp.gcl_lead(p_tag text, p_email text, p_src text, p_camp text, p_paid boolean,
                                            p_coupon text default null, p_order text default 'paid', p_enrolled boolean default false)
returns uuid language plpgsql as $$
declare u uuid := pg_temp.gcl_user('zztest-gcl-' || p_tag || '@example.invalid');
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, utm_source, utm_medium, utm_campaign, created_at, user_registration_date)
  values (u, 'ZZTEST GCL ' || p_tag, p_email, p_src, case when p_src is null then null else 'zzmed' end, p_camp,
          '2090-01-05 12:00+05:30', '2090-01-05 12:00+05:30')
  on conflict (lead_id) do update set registered_email = excluded.registered_email, utm_source = excluded.utm_source,
    utm_medium = excluded.utm_medium, utm_campaign = excluded.utm_campaign;
  if p_paid then
    insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider, amount, currency)
    values (u, '2090-01-10 12:00+05:30', 'ZZTEST-GCL-' || p_tag, 'simulated', 500, 'INR');
  end if;
  if p_coupon is not null then
    insert into public.vsat_payment_orders (cf_order_id, lead_id, base_amount, discount, discount_coupon, amount, status)
    values ('ZZTEST-GCL-' || p_tag, u, 1000, 500, p_coupon, 500, p_order);
  end if;
  if p_enrolled then
    insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email)
    values ('ZZGCL-' || p_tag, u, 'ZZGCL-' || p_tag, 'ZZTEST ' || p_tag, 'zztest-gcl-' || p_tag || '@example.invalid');
    update public.application_manager set enrollment_stage = 'approved', enrollment_paid_at = '2090-01-20 12:00+05:30'
     where application_id = 'ZZGCL-' || p_tag;
  end if;
  return u;
end $$;

create or replace function pg_temp.gcl_call(p_uid uuid, p_sql text, p_anon boolean default false)
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

create or replace function pg_temp.gcl_rpc(p_fn text, p jsonb)
returns text language sql as $$ select format('select public.%I(%L::jsonb)', p_fn, p::text) $$;

create or replace function pg_temp.gcl_row(p_res jsonb, p_id uuid)
returns jsonb language sql as $$ select x from jsonb_array_elements(p_res->'rows') x where x->>'id' = p_id::text $$;

-- detail of the last error is not returned by gcl_call; this one returns it for DUPLICATE_UTM checks
create or replace function pg_temp.gcl_err_detail(p_uid uuid, p_sql text)
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

create or replace function pg_temp.run_growth_cons_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  tn text[] := '{}'; tp boolean[] := '{}'; td text[] := '{}';
  adm uuid; usr uuid; r jsonb; x jsonb; s text; n int; r1 uuid; r2 uuid; r3 uuid; k text; keys jsonb;
  u1 text := 'https://apply.vedam.org/?utm_source=ZZCONS&utm_medium=zzmed&utm_campaign=zz%20one';
  u2 text := 'https://apply.vedam.org/?utm_source=zzcons2&utm_medium=zzmed&utm_campaign=zz%20two';
  pub text[] := array['growth_cons_list', 'growth_cons_save', 'growth_cons_bulk_update', 'growth_cons_trash', 'growth_cons_purge',
                      'growth_cons_import', 'growth_cons_col_add', 'growth_cons_col_update', 'growth_cons_col_unhide_all',
                      'growth_cons_col_order', 'growth_cons_col_remove'];
begin
  begin -- rolled back at the end (ZDONE)
    if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
      raise exception 'Refusing to run: this is not the staging database.';
    end if;
    perform set_config('vedam.allow_simulated_payments', 'on', true);
    adm := pg_temp.gcl_user('zztest-gcl-admin@example.invalid');
    insert into public.user_roles (user_id, role) values (adm, 'admin');
    usr := pg_temp.gcl_user('zztest-gcl-user@example.invalid');

    -- ════ A. security ════
    r := pg_temp.gcl_call(null, pg_temp.gcl_rpc('growth_cons_list', '{}'), true);
    tn := tn || text 'A anon cannot call growth_cons_list'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    r := pg_temp.gcl_call(usr, pg_temp.gcl_rpc('growth_cons_list', '{}'));
    tn := tn || text 'A a signed-in non-admin gets FORBIDDEN'; td := td || r::text; tp := tp || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.gcl_call(usr, pg_temp.gcl_rpc('growth_cons_save', jsonb_build_object('row', jsonb_build_object(
           'consultant_name', 'ZZTEST hack', 'utm_link', 'https://x.invalid/?utm_source=zzhack', 'category', 'Associated with Sunstone'))));
    tn := tn || text 'A a non-admin cannot add a row'; td := td || r::text; tp := tp || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.gcl_call(adm, 'select to_jsonb(count(*)) from public.growth__cons_attr(false)');
    tn := tn || text 'A private helper growth__cons_attr is not callable, even by an admin'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    r := pg_temp.gcl_call(adm, 'select to_jsonb(count(*)) from public.growth_cons_rows');
    tn := tn || text 'A the table is not readable from the browser, even by an admin'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_list', '{"view":"active","evil":1}'));
    tn := tn || text 'A unknown request keys are refused'; td := td || r::text; tp := tp || (r->>'message' = 'UNKNOWN_KEY: evil');
    select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any (pub)
       and p.prosecdef and p.proconfig = array['search_path=""']
       and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute');
    tn := tn || text 'A all 11 RPCs: SECURITY DEFINER, search_path empty, authenticated only'; td := td || n::text; tp := tp || (n = 11);
    select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'growth\_\_cons\_%'
       and p.proconfig = array['search_path=""']
       and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute');
    tn := tn || text 'A all 7 private helpers: search_path empty, no browser access'; td := td || n::text; tp := tp || (n = 7);
    select count(*) into n from pg_class c where c.oid in ('public.growth_cons_rows'::regclass, 'public.growth_cons_columns'::regclass)
       and c.relrowsecurity and not exists (select 1 from pg_policy pl where pl.polrelid = c.oid)
       and not has_table_privilege('anon', c.oid, 'select') and not has_table_privilege('authenticated', c.oid, 'select')
       and not has_table_privilege('authenticated', c.oid, 'insert');
    tn := tn || text 'A both tables: RLS on, no policies, no grants'; td := td || n::text; tp := tp || (n = 2);

    -- ════ B. columns ════
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_list', '{}'));
    s := (select string_agg(v->>'key', ',' order by o) from jsonb_array_elements(r->'columns') with ordinality q(v, o) where (v->>'standard')::boolean);
    tn := tn || text 'B the 17 CRM columns, in order'; td := td || coalesce(s, r::text);
    tp := tp || (s = 'serial_no,consultant_name,utm_link,city,bdm,category,coupon_code,slab_hit,leads,apps_utm,apps_coupon,enr_utm,enr_coupon,enr_total,enrollment_spend,slab_spend,total_spend');

    -- ════ C. save ════
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_save', jsonb_build_object('row', jsonb_build_object('utm_link', u1, 'category', 'Associated with Sunstone'))));
    tn := tn || text 'C consultant name is required'; td := td || r::text; tp := tp || (r->>'message' = 'REQUIRED: consultant_name');
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_save', jsonb_build_object('row', jsonb_build_object('consultant_name', 'ZZTEST A', 'category', 'Associated with Sunstone'))));
    tn := tn || text 'C UTM link is required'; td := td || r::text; tp := tp || (r->>'message' = 'REQUIRED: utm_link');
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_save', jsonb_build_object('row', jsonb_build_object('consultant_name', 'ZZTEST A', 'utm_link', 'javascript:alert(1)', 'category', 'Associated with Sunstone'))));
    tn := tn || text 'C a non-http UTM link is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: utm_link');
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_save', jsonb_build_object('row', jsonb_build_object('consultant_name', 'ZZTEST A', 'utm_link', u1, 'category', 'Partner'))));
    tn := tn || text 'C an unknown category is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: category');
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_save', jsonb_build_object('row', jsonb_build_object('consultant_name', 'ZZTEST A', 'utm_link', u1,
           'category', 'associated with sunstone', 'slab_hit', 'maybe'))));
    tn := tn || text 'C slab hit must be Yes / No'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: slab_hit');
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_save', jsonb_build_object('row', jsonb_build_object('consultant_name', ' ZZTEST Alpha ', 'utm_link', u1,
           'category', 'associated with sunstone', 'slab_hit', 'yes', 'coupon_code', 'ZZCPN1', 'city', 'ZZ City', 'bdm', 'ZZ BDM',
           'enrollment_spend', '₹1,50,000', 'slab_spend', '25000'))));
    r1 := (r->>'id')::uuid;
    select format('%s|%s|%s|%s|%s', consultant_name, category, slab_hit, enrollment_spend, slab_spend) into s from public.growth_cons_rows where id = r1;
    tn := tn || text 'C a valid row is saved: trimmed name, canonical category / slab, ₹ and commas accepted'; td := td || coalesce(s, r::text);
    tp := tp || (s = 'ZZTEST Alpha|Associated with Sunstone|Yes|150000.00|25000.00');
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_save', jsonb_build_object('row', jsonb_build_object('consultant_name', 'ZZTEST Beta',
           'utm_link', upper(u1) , 'category', 'Not Associated with Sunstone'))));
    tn := tn || text 'C the same UTM link (other case) is refused'; td := td || r::text; tp := tp || (r->>'message' = 'DUPLICATE_UTM');
    s := pg_temp.gcl_err_detail(adm, pg_temp.gcl_rpc('growth_cons_save', jsonb_build_object('row', jsonb_build_object('consultant_name', 'ZZTEST Beta',
           'utm_link', 'https://other.invalid/landing?utm_campaign=zz%20one&utm_medium=ZZMED&utm_source=zzcons&x=1', 'category', 'Not Associated with Sunstone'))));
    tn := tn || text 'C another link with the same source / medium / campaign is refused and names the row that has it'; td := td || s;
    tp := tp || (s = 'DUPLICATE_UTM | ZZTEST Alpha');
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_save', jsonb_build_object('row', jsonb_build_object('consultant_name', 'ZZTEST Beta', 'utm_link', u2,
           'category', 'Not Associated with Sunstone', 'coupon_code', 'zzcpn1'))));
    r2 := (r->>'id')::uuid;
    tn := tn || text 'C a second row with its own UTM is saved'; td := td || r::text; tp := tp || (r2 is not null);
    update public.growth_cons_rows set created_at = now() - interval '2 days' where id = r1;   -- r1 is the older row (owns the shared coupon)
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_save', jsonb_build_object('row', jsonb_build_object('id', r1, 'consultant_name', 'ZZTEST Alpha',
           'utm_link', u1, 'category', 'Associated with Sunstone', 'coupon_code', 'ZZCPN1', 'enrollment_spend', '150000', 'slab_spend', '25000'))));
    tn := tn || text 'C editing a row keeps its own UTM (not a duplicate of itself)'; td := td || r::text; tp := tp || ((r->>'id')::uuid = r1);

    -- ════ D. attribution ════
    perform pg_temp.gcl_lead('a', 'zzgcl-a@example.invalid', 'zzcons', 'zz one', true, null, 'paid', true);       -- R1 UTM, paid, enrolled
    perform pg_temp.gcl_lead('b', 'zzgcl-b@example.invalid', 'zzcons', 'zz one', false);                          -- R1 UTM, not paid
    perform pg_temp.gcl_lead('s', 'zzgcl-s@VEDAM.org', 'zzcons', 'zz one', true);                                  -- staff on R1 UTM
    perform pg_temp.gcl_lead('c', 'zzgcl-c@example.invalid', 'zzother', 'zz x', true, 'zzcpn1', 'paid', true);    -- other UTM, paid with the coupon, enrolled
    perform pg_temp.gcl_lead('d', 'zzgcl-d@example.invalid', 'zzcons2', 'zz two', true, 'ZZCPN1');                 -- R2 UTM + coupon: UTM only
    perform pg_temp.gcl_lead('e', 'zzgcl-e@example.invalid', null, null, false, 'ZZCPN1', 'created');              -- unpaid order
    perform pg_temp.gcl_lead('f', 'zzgcl-f@example.invalid', 'zzother', 'zz x', false, 'ZZCPN1', 'paid');          -- paid order but no vsat_payments row
    perform pg_temp.gcl_lead('g', 'zzgcl-g@vedam.org', null, null, true, 'ZZCPN1');                                -- staff with the coupon
    perform pg_temp.gcl_lead('h', 'zzgcl-h@example.invalid', null, null, true, ' zzCpn1 ');                         -- no UTM, coupon with spaces
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_list', '{"view":"active"}'));
    x := pg_temp.gcl_row(r, r1);
    s := coalesce(format('%s/%s/%s/%s/%s', x->>'leads', x->>'apps_utm', x->>'enr_utm', x->>'apps_coupon', x->>'enr_coupon'), r::text);
    tn := tn || text 'D row 1: 2 leads (a, b), 1 application + 1 enrolment by UTM, 2 applications (c, h) + 1 enrolment (c) by coupon; staff left out';
    td := td || s; tp := tp || (s = '2/1/1/2/1');
    x := pg_temp.gcl_row(r, r2);
    s := coalesce(format('%s/%s/%s/%s/%s', x->>'leads', x->>'apps_utm', x->>'enr_utm', x->>'apps_coupon', x->>'enr_coupon'), r::text);
    tn := tn || text 'D row 2: lead d counted once, by UTM; the shared coupon belongs to the older row, so 0 by coupon';
    td := td || s; tp := tp || (s = '1/1/0/0/0');
    tn := tn || text 'D the list returns the counts and the UTM key'; td := td || (coalesce((r->'counts')::text, r::text) || ' ' || coalesce(x->>'utm_key', ''));
    tp := tp || ((r->'counts'->>'active')::int >= 2 and x->>'utm_key' = 'zzcons2/zzmed/zz two');

    -- ════ E. bulk update / inline ════
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_bulk_update', jsonb_build_object('ids', jsonb_build_array(r1, r2), 'key', 'slab_hit', 'value', 'No')));
    select string_agg(slab_hit, ',') into s from public.growth_cons_rows where id in (r1, r2);
    tn := tn || text 'E bulk update sets slab hit on both rows'; td := td || coalesce(s, r::text); tp := tp || (r->>'changed' = '2' and s = 'No,No');
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_bulk_update', jsonb_build_object('ids', jsonb_build_array(r2), 'key', 'category', 'value', 'Associated with Sunstone')));
    tn := tn || text 'E inline category change (one id)'; td := td || r::text;
    tp := tp || ((select category from public.growth_cons_rows where id = r2) = 'Associated with Sunstone');
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_bulk_update', jsonb_build_object('ids', jsonb_build_array(r1, r2), 'key', 'utm_link', 'value', u1)));
    tn := tn || text 'E UTM link cannot be bulk updated'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: key');
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_bulk_update', jsonb_build_object('ids', jsonb_build_array(r1), 'key', 'leads', 'value', '99')));
    tn := tn || text 'E a computed column cannot be set'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: key');
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_bulk_update', jsonb_build_object('ids', jsonb_build_array(r1), 'key', 'enrollment_spend', 'value', '-5')));
    tn := tn || text 'E a negative spend is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: enrollment_spend');
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_bulk_update', jsonb_build_object('ids', jsonb_build_array(r1), 'key', 'consultant_name', 'value', '')));
    tn := tn || text 'E a required column cannot be emptied'; td := td || r::text; tp := tp || (r->>'message' = 'REQUIRED: consultant_name');

    -- ════ F. trash / restore / delete ════
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_trash', jsonb_build_object('ids', jsonb_build_array(r2), 'trash', true)));
    tn := tn || text 'F move to trash'; td := td || r::text;
    tp := tp || (r->>'changed' = '1' and (select deleted_at is not null from public.growth_cons_rows where id = r2));
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_list', '{"view":"trash"}'));
    tn := tn || text 'F the trash view shows the row'; td := td || coalesce((r->'counts')::text, r::text); tp := tp || (pg_temp.gcl_row(r, r2) is not null);
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_bulk_update', jsonb_build_object('ids', jsonb_build_array(r2), 'key', 'city', 'value', 'x')));
    tn := tn || text 'F a row in the trash cannot be edited'; td := td || r::text; tp := tp || (r->>'message' = 'NOT_FOUND');
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_save', jsonb_build_object('row', jsonb_build_object('consultant_name', 'ZZTEST Gamma',
           'utm_link', u2, 'category', 'Associated with Sunstone'))));
    r3 := (r->>'id')::uuid;
    tn := tn || text 'F the UTM of a trashed row can be used again'; td := td || r::text; tp := tp || (r3 is not null);
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_trash', jsonb_build_object('ids', jsonb_build_array(r2), 'trash', false)));
    tn := tn || text 'F restoring it while that UTM is live again is refused'; td := td || r::text;
    tp := tp || (r->>'message' = 'DUPLICATE_UTM' and (select deleted_at is not null from public.growth_cons_rows where id = r2));
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_purge', jsonb_build_object('ids', jsonb_build_array(r1, r2))));
    tn := tn || text 'F delete permanently removes only rows in the trash'; td := td || r::text;
    tp := tp || (r->>'deleted' = '1' and exists (select 1 from public.growth_cons_rows where id = r1)
                 and not exists (select 1 from public.growth_cons_rows where id = r2));
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_trash', '{"ids":["not-a-uuid"],"trash":true}'));
    tn := tn || text 'F bad ids are refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: ids');

    -- ════ G. CSV import ════
    select count(*) into n from public.growth_cons_rows;
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_import', jsonb_build_object('mode', 'upsert', 'rows', jsonb_build_array(
           jsonb_build_object('consultant_name', 'ZZTEST Imp 1', 'utm_link', 'https://x.invalid/?utm_source=zzimp1', 'category', 'Associated with Sunstone'),
           jsonb_build_object('consultant_name', 'ZZTEST Imp 2', 'utm_link', 'https://x.invalid/?utm_source=zzimp2', 'category', 'Partner')))));
    tn := tn || text 'G a file with one bad row imports nothing'; td := td || r::text;
    tp := tp || (r->>'message' = 'IMPORT_FAILED' and (select count(*) from public.growth_cons_rows) = n);
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_import', jsonb_build_object('mode', 'upsert', 'rows', jsonb_build_array(
           jsonb_build_object('consultant_name', 'ZZTEST Imp 1', 'utm_link', 'https://x.invalid/?utm_source=zzimp1', 'category', 'Associated with Sunstone'),
           jsonb_build_object('consultant_name', 'ZZTEST Alpha', 'utm_link', u1, 'category', 'Associated with Sunstone', 'city', 'ZZ New City')))));
    tn := tn || text 'G upsert: 1 added, 1 updated by its UTM link (other values kept)'; td := td || r::text;
    tp := tp || (r->>'added' = '1' and r->>'updated' = '1'
                 and (select city = 'ZZ New City' and coupon_code = 'ZZCPN1' and enrollment_spend = 150000 from public.growth_cons_rows where id = r1));
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_import', jsonb_build_object('mode', 'add', 'rows', jsonb_build_array(
           jsonb_build_object('consultant_name', 'ZZTEST Alpha 2', 'utm_link', u1, 'category', 'Associated with Sunstone')))));
    tn := tn || text 'G add mode: a UTM already in the list is an error'; td := td || r::text; tp := tp || (r->>'message' = 'IMPORT_FAILED');
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_import', jsonb_build_object('rows',
           (select jsonb_agg(jsonb_build_object('consultant_name', 'x')) from generate_series(1, 2001)))));
    tn := tn || text 'G more than 2000 rows is refused'; td := td || left(r::text, 120); tp := tp || (r->>'message' = 'TOO_MANY_ROWS');
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_import', jsonb_build_object('rows', jsonb_build_array(
           jsonb_build_object('id', r1, 'consultant_name', 'x')))));
    tn := tn || text 'G an import row cannot carry an id'; td := td || r::text; tp := tp || (r->>'message' = 'IMPORT_FAILED');

    -- ════ H. columns ════
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_col_add', '{"label":"ZZ Group Admin","type":"reference"}'));
    tn := tn || text 'H only Text / Number / Date / URL columns can be added'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: type');
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_col_add', '{"label":"ZZ Payout","type":"number"}'));
    k := r->>'key';
    tn := tn || text 'H add a number column'; td := td || r::text; tp := tp || (k = 'x_zz_payout');
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_col_add', '{"label":"zz payout","type":"text"}'));
    tn := tn || text 'H a second column with the same label is refused'; td := td || r::text; tp := tp || (r->>'message' = 'DUPLICATE');
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_col_add', '{"label":"Leads","type":"text"}'));
    tn := tn || text 'H a label used by a CRM column is refused'; td := td || r::text; tp := tp || (r->>'message' = 'DUPLICATE');
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_bulk_update', jsonb_build_object('ids', jsonb_build_array(r1), 'key', k, 'value', 'abc')));
    tn := tn || text 'H a number column refuses text'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: ' || k);
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_bulk_update', jsonb_build_object('ids', jsonb_build_array(r1), 'key', k, 'value', '1,200')));
    tn := tn || text 'H a number column stores 1,200 as 1200'; td := td || r::text;
    tp := tp || ((select extra->>k from public.growth_cons_rows where id = r1) = '1200');
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_save', jsonb_build_object('row', jsonb_build_object('id', r1, 'consultant_name', 'ZZTEST Alpha',
           'utm_link', u1, 'category', 'Associated with Sunstone', 'extra', jsonb_build_object('x_nope', '1')))));
    tn := tn || text 'H a value for a column that does not exist is refused'; td := td || r::text; tp := tp || (r->>'message' = 'UNKNOWN_KEY: x_nope');
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_col_update', jsonb_build_object('key', 'city', 'label', 'ZZ Town', 'hidden', true)));
    tn := tn || text 'H rename + hide a CRM column'; td := td || r::text;
    tp := tp || ((select label = 'ZZ Town' and is_hidden from public.growth_cons_columns where col_key = 'city' and deleted_at is null));
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_col_unhide_all', '{}'));
    tn := tn || text 'H unhide all'; td := td || r::text;
    tp := tp || (not exists (select 1 from public.growth_cons_columns where is_hidden and deleted_at is null));
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_col_order', '{"keys":["city","bdm"]}'));
    tn := tn || text 'H a reorder that leaves out columns is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: keys');
    select jsonb_agg(col_key order by case col_key when 'bdm' then 0 else 1 end, display_order) into keys
      from public.growth_cons_columns where deleted_at is null;
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_col_order', jsonb_build_object('keys', keys)));
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_list', '{}'));
    tn := tn || text 'H reorder: BDM moved to the front'; td := td || coalesce(r->'columns'->0->>'key', r::text); tp := tp || (r->'columns'->0->>'key' = 'bdm');
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_col_remove', '{"key":"utm_link"}'));
    tn := tn || text 'H a CRM column cannot be removed'; td := td || r::text; tp := tp || (r->>'message' = 'SYSTEM_COLUMN');
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_col_remove', jsonb_build_object('key', k)));
    tn := tn || text 'H an added column can be removed (its values stay in the row)'; td := td || r::text;
    tp := tp || (r->>'ok' = 'true' and (select extra->>k from public.growth_cons_rows where id = r1) = '1200');
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_col_add', '{"label":"ZZ Payout","type":"number"}'));
    tn := tn || text 'H adding the removed column back reuses its key, so its values show again'; td := td || r::text;
    tp := tp || (r->>'key' = k and (select extra->>k from public.growth_cons_rows where id = r1) = '1200');
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_col_add', '{"label":"ZZ Must","type":"text","required":true}'));
    r := pg_temp.gcl_call(adm, pg_temp.gcl_rpc('growth_cons_bulk_update', jsonb_build_object('ids', jsonb_build_array(r1), 'key', 'city', 'value', 'Y')));
    tn := tn || text 'H after a required column is added, a row without it cannot be saved'; td := td || r::text; tp := tp || (r->>'message' = 'REQUIRED: x_zz_must');

    -- ════ I. trash clean-up ════
    update public.growth_cons_rows set deleted_at = now() - interval '31 days' where id = r3;
    perform public.growth__cons_purge_old();
    tn := tn || text 'I rows in the trash for more than 30 days are deleted'; td := td || text 'see test';
    tp := tp || (not exists (select 1 from public.growth_cons_rows where id = r3) and exists (select 1 from public.growth_cons_rows where id = r1));
    tn := tn || text 'I the daily clean-up job is scheduled';
    select string_agg(jobname || ' ' || schedule, ', ') into s from cron.job where jobname = 'growth-cons-trash-purge';
    td := td || coalesce(s, 'missing'); tp := tp || (s is not null);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;
  return query select * from unnest(tn, tp, td);
end $$;

select * from pg_temp.run_growth_cons_tests();
