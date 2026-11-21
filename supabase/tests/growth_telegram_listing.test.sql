-- Growth → Telegram Channel → Telegram Listing · tests for migration 0132 (STAGING ONLY)
--
-- How to run: apply 0132 on staging, then paste this whole file into the staging SQL editor (or the Supabase MCP).
-- The last statement returns one row per test: test | pass | detail. Everything is rolled back at the end (ZDONE).
-- Fake data only (ZZTEST names, zztg* UTMs, ZZTG campaigns in 2090). Refuses to run unless app_flags.environment = 'staging'.

create or replace function pg_temp.gtg_user(p_email text)
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
create or replace function pg_temp.gtg_lead(p_tag text, p_email text, p_src text, p_reg timestamptz, p_paid boolean, p_enrolled boolean default false)
returns uuid language plpgsql as $$
declare u uuid := pg_temp.gtg_user('zztest-gtg-' || p_tag || '@example.invalid');
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, utm_source, utm_medium, utm_campaign, created_at, user_registration_date)
  values (u, 'ZZTEST GTG ' || p_tag, p_email, p_src, 'zztgmed', 'zz tg', p_reg, p_reg)
  on conflict (lead_id) do update set registered_email = excluded.registered_email, utm_source = excluded.utm_source,
    utm_medium = excluded.utm_medium, utm_campaign = excluded.utm_campaign, created_at = excluded.created_at,
    user_registration_date = excluded.user_registration_date;
  if p_paid then
    insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider, amount, currency)
    values (u, p_reg + interval '2 days', 'ZZTEST-GTG-' || p_tag, 'simulated', 500, 'INR');
  end if;
  if p_enrolled then
    insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email)
    values ('ZZGTG-' || p_tag, u, 'ZZGTG-' || p_tag, 'ZZTEST ' || p_tag, 'zztest-gtg-' || p_tag || '@example.invalid');
    update public.application_manager set enrollment_stage = 'approved', enrollment_paid_at = p_reg + interval '10 days'
     where application_id = 'ZZGTG-' || p_tag;
  end if;
  return u;
end $$;

create or replace function pg_temp.gtg_call(p_uid uuid, p_sql text, p_anon boolean default false)
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

create or replace function pg_temp.gtg_rpc(p_fn text, p jsonb)
returns text language sql as $$ select format('select public.%I(%L::jsonb)', p_fn, p::text) $$;

create or replace function pg_temp.gtg_row(p_res jsonb, p_id uuid)
returns jsonb language sql as $$ select x from jsonb_array_elements(p_res->'rows') x where x->>'id' = p_id::text $$;

create or replace function pg_temp.gtg_err_detail(p_uid uuid, p_sql text)
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

create or replace function pg_temp.gtg_fmt(x jsonb)
returns text language sql as $$
  select format('%s/%s/%s · %s/%s/%s', x->>'leads', x->>'payments', x->>'enrollments', x->>'leads_all', x->>'payments_all', x->>'enrollments_all')
$$;

create or replace function pg_temp.run_growth_tg_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  tn text[] := '{}'; tp boolean[] := '{}'; td text[] := '{}';
  adm uuid; usr uuid; r jsonb; x jsonb; s text; n int; r1 uuid; r2 uuid; r3 uuid; c1 uuid; c2 uuid; c3 uuid; k text; keys jsonb;
  u1 text := 'https://t.me/zz?utm_source=ZZTG&utm_medium=zztgmed&utm_campaign=zz%20tg';
  u2 text := 'https://apply.vedam.org/?utm_source=zztg2&utm_medium=zztgmed&utm_campaign=zz%20tg';
  pub text[] := array['growth_tg_list', 'growth_tg_save', 'growth_tg_bulk_update', 'growth_tg_trash', 'growth_tg_purge',
                      'growth_tg_import', 'growth_tg_col_add', 'growth_tg_col_update', 'growth_tg_col_unhide_all',
                      'growth_tg_col_order', 'growth_tg_col_remove'];
begin
  begin -- rolled back at the end (ZDONE)
    if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
      raise exception 'Refusing to run: this is not the staging database.';
    end if;
    perform set_config('vedam.allow_simulated_payments', 'on', true);
    adm := pg_temp.gtg_user('zztest-gtg-admin@example.invalid');
    insert into public.user_roles (user_id, role) values (adm, 'admin');
    usr := pg_temp.gtg_user('zztest-gtg-user@example.invalid');
    insert into public.vsat_campaigns (name, campaign_start, campaign_end) values ('ZZTG Jan', '2090-01-01', '2090-01-31') returning id into c1;
    insert into public.vsat_campaigns (name, campaign_start, campaign_end) values ('ZZTG Feb', '2090-02-01', '2090-02-28') returning id into c2;
    insert into public.vsat_campaigns (name, campaign_start, campaign_end) values ('ZZTG Unused', '2090-04-01', '2090-04-30') returning id into c3;

    -- ════ A. security ════
    r := pg_temp.gtg_call(null, pg_temp.gtg_rpc('growth_tg_list', '{}'), true);
    tn := tn || text 'A anon cannot call growth_tg_list'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    r := pg_temp.gtg_call(usr, pg_temp.gtg_rpc('growth_tg_list', '{}'));
    tn := tn || text 'A a signed-in non-admin gets FORBIDDEN'; td := td || r::text; tp := tp || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.gtg_call(usr, pg_temp.gtg_rpc('growth_tg_save', jsonb_build_object('row', jsonb_build_object(
           'influencer_name', 'ZZTEST hack', 'utm_link', 'https://x.invalid/?utm_source=zzhack', 'used_in', 'ZZTG Jan'))));
    tn := tn || text 'A a non-admin cannot add a row'; td := td || r::text; tp := tp || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.gtg_call(adm, 'select to_jsonb(count(*)) from public.growth__tg_attr(false)');
    tn := tn || text 'A private helper growth__tg_attr is not callable, even by an admin'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    r := pg_temp.gtg_call(adm, 'select to_jsonb(count(*)) from public.growth_tg_rows');
    tn := tn || text 'A the table is not readable from the browser, even by an admin'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_list', '{"view":"active","evil":1}'));
    tn := tn || text 'A unknown request keys are refused'; td := td || r::text; tp := tp || (r->>'message' = 'UNKNOWN_KEY: evil');
    select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any (pub)
       and p.prosecdef and p.proconfig = array['search_path=""']
       and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute');
    tn := tn || text 'A all 11 RPCs: SECURITY DEFINER, search_path empty, authenticated only'; td := td || n::text; tp := tp || (n = 11);
    select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'growth\_\_tg\_%'
       and p.proconfig = array['search_path=""']
       and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute');
    tn := tn || text 'A all 7 private helpers: search_path empty, no browser access'; td := td || n::text; tp := tp || (n = 7);
    select count(*) into n from pg_class c where c.oid in ('public.growth_tg_rows'::regclass, 'public.growth_tg_columns'::regclass)
       and c.relrowsecurity and not exists (select 1 from pg_policy pl where pl.polrelid = c.oid)
       and not has_table_privilege('anon', c.oid, 'select') and not has_table_privilege('authenticated', c.oid, 'select')
       and not has_table_privilege('authenticated', c.oid, 'insert');
    tn := tn || text 'A both tables: RLS on, no policies, no grants'; td := td || n::text; tp := tp || (n = 2);

    -- ════ B. columns ════
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_list', '{}'));
    s := (select string_agg(v->>'key', ',' order by o) from jsonb_array_elements(r->'columns') with ordinality q(v, o) where (v->>'standard')::boolean);
    tn := tn || text 'B the 12 CRM columns, in order'; td := td || coalesce(s, r::text);
    tp := tp || (s = 'serial_no,influencer_name,utm_link,used_in,cpl,cpa,cpl_spend,cpa_spend,total_spend,leads,payments,enrollments');
    tn := tn || text 'B the list carries the VSAT campaigns for the Used In dropdown';
    td := td || coalesce((select string_agg(v->>'name', ',') from jsonb_array_elements(r->'campaigns') v where v->>'name' like 'ZZTG%'), '');
    tp := tp || ((select count(*) from jsonb_array_elements(r->'campaigns') v where v->>'name' like 'ZZTG%') = 3);

    -- ════ C. save ════
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_save', jsonb_build_object('row', jsonb_build_object('utm_link', u1, 'used_in', 'ZZTG Jan'))));
    tn := tn || text 'C influencer name is required'; td := td || r::text; tp := tp || (r->>'message' = 'REQUIRED: influencer_name');
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_save', jsonb_build_object('row', jsonb_build_object('influencer_name', 'ZZTEST A', 'used_in', 'ZZTG Jan'))));
    tn := tn || text 'C UTM link is required'; td := td || r::text; tp := tp || (r->>'message' = 'REQUIRED: utm_link');
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_save', jsonb_build_object('row', jsonb_build_object('influencer_name', 'ZZTEST A', 'utm_link', u1))));
    tn := tn || text 'C Used In is required'; td := td || r::text; tp := tp || (r->>'message' = 'REQUIRED: used_in');
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_save', jsonb_build_object('row', jsonb_build_object('influencer_name', 'ZZTEST A', 'utm_link', u1, 'used_in', 'ZZTG Nope'))));
    tn := tn || text 'C an unknown VSAT is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: used_in');
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_save', jsonb_build_object('row', jsonb_build_object('influencer_name', 'ZZTEST A', 'utm_link', 'javascript:alert(1)', 'used_in', 'ZZTG Jan'))));
    tn := tn || text 'C a non-http UTM link is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: utm_link');
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_save', jsonb_build_object('row', jsonb_build_object('influencer_name', 'ZZTEST A', 'utm_link', u1, 'used_in', 'ZZTG Jan', 'cpl', '-1'))));
    tn := tn || text 'C a negative CPL is refused'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: cpl');
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_save', jsonb_build_object('row', jsonb_build_object('influencer_name', ' ZZTEST Alpha ', 'utm_link', u1,
           'used_in', 'zztg jan', 'cpl', '₹1,000', 'cpa', '5000'))));
    r1 := (r->>'id')::uuid;
    select format('%s|%s|%s|%s', influencer_name, (campaign_id = c1)::text, cpl, cpa) into s from public.growth_tg_rows where id = r1;
    tn := tn || text 'C a valid row: trimmed name, VSAT by name (any case), ₹ and commas accepted'; td := td || coalesce(s, r::text);
    tp := tp || (s = 'ZZTEST Alpha|true|1000.00|5000.00');
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_save', jsonb_build_object('row', jsonb_build_object('influencer_name', 'ZZTEST Beta', 'utm_link', upper(u1), 'used_in', c1::text))));
    tn := tn || text 'C the same UTM (other case) in the same VSAT is refused'; td := td || r::text; tp := tp || (r->>'message' = 'DUPLICATE_UTM');
    s := pg_temp.gtg_err_detail(adm, pg_temp.gtg_rpc('growth_tg_save', jsonb_build_object('row', jsonb_build_object('influencer_name', 'ZZTEST Beta',
           'utm_link', 'https://other.invalid/x?utm_campaign=zz%20tg&utm_medium=ZZTGMED&utm_source=zztg', 'used_in', 'ZZTG Jan'))));
    tn := tn || text 'C the same source / medium / campaign in the same VSAT is refused and names the row'; td := td || s;
    tp := tp || (s = 'DUPLICATE_UTM | ZZTEST Alpha');
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_save', jsonb_build_object('row', jsonb_build_object('influencer_name', 'ZZTEST Alpha', 'utm_link', u1, 'used_in', 'ZZTG Feb', 'cpl', '500'))));
    r2 := (r->>'id')::uuid;
    tn := tn || text 'C the same UTM in another VSAT is allowed (one row per VSAT)'; td := td || r::text; tp := tp || (r2 is not null);
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_save', jsonb_build_object('row', jsonb_build_object('id', r1, 'influencer_name', 'ZZTEST Alpha',
           'utm_link', u1, 'used_in', 'ZZTG Jan', 'cpl', '1000', 'cpa', '5000'))));
    tn := tn || text 'C editing a row keeps its own UTM (not a duplicate of itself)'; td := td || r::text; tp := tp || ((r->>'id')::uuid = r1);

    -- ════ D. attribution: in-window = registered inside the VSAT's start..end ════
    perform pg_temp.gtg_lead('a', 'zzgtg-a@example.invalid', 'zztg', '2090-01-05 12:00+05:30', true, true);    -- Jan, paid, enrolled
    perform pg_temp.gtg_lead('b', 'zzgtg-b@example.invalid', 'zztg', '2090-01-20 12:00+05:30', false);          -- Jan, not paid
    perform pg_temp.gtg_lead('c', 'zzgtg-c@example.invalid', 'zztg', '2090-03-10 12:00+05:30', true);           -- March: outside both, paid
    perform pg_temp.gtg_lead('s', 'zzgtg-s@VEDAM.org', 'zztg', '2090-01-06 12:00+05:30', true);                 -- staff
    perform pg_temp.gtg_lead('e', 'zzgtg-e@example.invalid', 'zztg', '2090-01-31 23:30+05:30', false);          -- last day of Jan (IST)
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_list', '{"view":"active"}'));
    x := pg_temp.gtg_row(r, r1);
    tn := tn || text 'D Jan row: in-window 3 leads (a, b, e) · 1 payment · 1 enrolment; all-time 4 · 2 · 1; staff left out';
    td := td || coalesce(pg_temp.gtg_fmt(x), r::text); tp := tp || (pg_temp.gtg_fmt(x) = '3/1/1 · 4/2/1');
    x := pg_temp.gtg_row(r, r2);
    tn := tn || text 'D Feb row (same UTM): nothing in its window; same all-time numbers';
    td := td || coalesce(pg_temp.gtg_fmt(x), r::text); tp := tp || (pg_temp.gtg_fmt(x) = '0/0/0 · 4/2/1');
    tn := tn || text 'D the row carries VSAT name and id, CPL, CPA and the UTM key';
    x := pg_temp.gtg_row(r, r1); td := td || coalesce(x::text, '');
    tp := tp || (x->>'used_in' = 'ZZTG Jan' and x->>'campaign_id' = c1::text and (x->>'cpl')::numeric = 1000 and (x->>'cpa')::numeric = 5000
                 and x->>'utm_key' = 'zztg/zztgmed/zz tg');

    -- ════ E. bulk update / inline ════
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_bulk_update', jsonb_build_object('ids', jsonb_build_array(r1, r2), 'key', 'cpa', 'value', '750')));
    select string_agg(cpa::text, ',') into s from public.growth_tg_rows where id in (r1, r2);
    tn := tn || text 'E bulk update sets CPA on both rows'; td := td || coalesce(s, r::text); tp := tp || (r->>'changed' = '2' and s = '750.00,750.00');
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_bulk_update', jsonb_build_object('ids', jsonb_build_array(r1), 'key', 'used_in', 'value', 'ZZTG Feb')));
    tn := tn || text 'E moving the Jan row to Feb (where the same UTM is) is refused'; td := td || r::text; tp := tp || (r->>'message' = 'DUPLICATE_UTM');
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_bulk_update', jsonb_build_object('ids', jsonb_build_array(r2), 'key', 'used_in', 'value', 'ZZTG Unused')));
    tn := tn || text 'E inline Used In change'; td := td || r::text;
    tp := tp || ((select campaign_id from public.growth_tg_rows where id = r2) = c3);
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_bulk_update', jsonb_build_object('ids', jsonb_build_array(r1, r2), 'key', 'utm_link', 'value', u2)));
    tn := tn || text 'E UTM link cannot be bulk updated'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: key');
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_bulk_update', jsonb_build_object('ids', jsonb_build_array(r1), 'key', 'cpl_spend', 'value', '9')));
    tn := tn || text 'E a computed column cannot be set'; td := td || r::text; tp := tp || (r->>'message' = 'BAD_VALUE: key');
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_bulk_update', jsonb_build_object('ids', jsonb_build_array(r1), 'key', 'influencer_name', 'value', '')));
    tn := tn || text 'E a required column cannot be emptied'; td := td || r::text; tp := tp || (r->>'message' = 'REQUIRED: influencer_name');
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_bulk_update', jsonb_build_object('ids', jsonb_build_array(r1), 'key', 'used_in', 'value', null)));
    tn := tn || text 'E Used In cannot be cleared'; td := td || r::text; tp := tp || (r->>'message' = 'REQUIRED: used_in');

    -- ════ F. trash / restore / delete ════
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_trash', jsonb_build_object('ids', jsonb_build_array(r2), 'trash', true)));
    tn := tn || text 'F move to trash'; td := td || r::text; tp := tp || (r->>'changed' = '1');
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_list', '{"view":"trash"}'));
    tn := tn || text 'F the trash view shows the row with its numbers'; td := td || coalesce(pg_temp.gtg_fmt(pg_temp.gtg_row(r, r2)), r::text);
    tp := tp || (pg_temp.gtg_row(r, r2) is not null and (pg_temp.gtg_row(r, r2)->>'leads_all')::int = 4);
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_save', jsonb_build_object('row', jsonb_build_object('influencer_name', 'ZZTEST Gamma', 'utm_link', u1, 'used_in', 'ZZTG Unused'))));
    r3 := (r->>'id')::uuid;
    tn := tn || text 'F the UTM + VSAT of a trashed row can be used again'; td := td || r::text; tp := tp || (r3 is not null);
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_trash', jsonb_build_object('ids', jsonb_build_array(r2), 'trash', false)));
    tn := tn || text 'F restoring it while that UTM + VSAT is live again is refused'; td := td || r::text;
    tp := tp || (r->>'message' = 'DUPLICATE_UTM' and (select deleted_at is not null from public.growth_tg_rows where id = r2));
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_purge', jsonb_build_object('ids', jsonb_build_array(r1, r2))));
    tn := tn || text 'F delete permanently removes only rows in the trash'; td := td || r::text;
    tp := tp || (r->>'deleted' = '1' and exists (select 1 from public.growth_tg_rows where id = r1) and not exists (select 1 from public.growth_tg_rows where id = r2));

    -- ════ G. CSV import ════
    select count(*) into n from public.growth_tg_rows;
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_import', jsonb_build_object('mode', 'upsert', 'rows', jsonb_build_array(
           jsonb_build_object('influencer_name', 'ZZTEST Imp 1', 'utm_link', 'https://x.invalid/?utm_source=zzimp1', 'used_in', 'ZZTG Jan'),
           jsonb_build_object('influencer_name', 'ZZTEST Imp 2', 'utm_link', 'https://x.invalid/?utm_source=zzimp2', 'used_in', 'No such VSAT')))));
    tn := tn || text 'G a file with one bad row imports nothing'; td := td || r::text;
    tp := tp || (r->>'message' = 'IMPORT_FAILED' and (select count(*) from public.growth_tg_rows) = n);
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_import', jsonb_build_object('mode', 'upsert', 'rows', jsonb_build_array(
           jsonb_build_object('influencer_name', 'ZZTEST Imp 1', 'utm_link', 'https://x.invalid/?utm_source=zzimp1', 'used_in', 'ZZTG Jan'),
           jsonb_build_object('influencer_name', 'ZZTEST Alpha', 'utm_link', u1, 'used_in', 'ZZTG Jan', 'cpl', '1200')))));
    tn := tn || text 'G upsert: 1 added, 1 updated by its UTM + VSAT (other values kept)'; td := td || r::text;
    tp := tp || (r->>'added' = '1' and r->>'updated' = '1' and (select cpl = 1200 and cpa = 750 from public.growth_tg_rows where id = r1));
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_import', jsonb_build_object('mode', 'upsert', 'rows', jsonb_build_array(
           jsonb_build_object('influencer_name', 'ZZTEST Alpha', 'utm_link', u1, 'used_in', 'ZZTG Feb')))));
    tn := tn || text 'G upsert: same UTM in another VSAT is a new row'; td := td || r::text; tp := tp || (r->>'added' = '1');
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_import', jsonb_build_object('mode', 'add', 'rows', jsonb_build_array(
           jsonb_build_object('influencer_name', 'ZZTEST Alpha 2', 'utm_link', u1, 'used_in', 'ZZTG Jan')))));
    tn := tn || text 'G add mode: a UTM + VSAT already in the list is an error'; td := td || r::text; tp := tp || (r->>'message' = 'IMPORT_FAILED');
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_import', jsonb_build_object('rows',
           (select jsonb_agg(jsonb_build_object('influencer_name', 'x')) from generate_series(1, 2001)))));
    tn := tn || text 'G more than 2000 rows is refused'; td := td || left(r::text, 120); tp := tp || (r->>'message' = 'TOO_MANY_ROWS');

    -- ════ H. columns ════
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_col_add', '{"label":"ZZ Group Admin","type":"text"}'));
    k := r->>'key';
    tn := tn || text 'H add a text column'; td := td || r::text; tp := tp || (k = 'x_zz_group_admin');
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_col_add', '{"label":"CPL","type":"number"}'));
    tn := tn || text 'H a label used by a CRM column is refused'; td := td || r::text; tp := tp || (r->>'message' = 'DUPLICATE');
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_bulk_update', jsonb_build_object('ids', jsonb_build_array(r1), 'key', k, 'value', 'Ravi')));
    tn := tn || text 'H a value for the added column is saved'; td := td || r::text;
    tp := tp || ((select extra->>k from public.growth_tg_rows where id = r1) = 'Ravi');
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_col_remove', '{"key":"used_in"}'));
    tn := tn || text 'H a CRM column cannot be removed'; td := td || r::text; tp := tp || (r->>'message' = 'SYSTEM_COLUMN');
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_col_update', jsonb_build_object('key', 'cpl', 'label', 'ZZ Cost per lead', 'hidden', true)));
    tn := tn || text 'H rename + hide a CRM column'; td := td || r::text;
    tp := tp || ((select label = 'ZZ Cost per lead' and is_hidden from public.growth_tg_columns where col_key = 'cpl' and deleted_at is null));
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_col_unhide_all', '{}'));
    tn := tn || text 'H unhide all'; td := td || r::text; tp := tp || (not exists (select 1 from public.growth_tg_columns where is_hidden and deleted_at is null));
    select jsonb_agg(col_key order by case col_key when 'used_in' then 0 else 1 end, display_order) into keys from public.growth_tg_columns where deleted_at is null;
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_col_order', jsonb_build_object('keys', keys)));
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_list', '{}'));
    tn := tn || text 'H reorder: Used In moved to the front'; td := td || coalesce(r->'columns'->0->>'key', r::text); tp := tp || (r->'columns'->0->>'key' = 'used_in');
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_tg_col_remove', jsonb_build_object('key', k)));
    tn := tn || text 'H an added column can be removed (its values stay in the row)'; td := td || r::text;
    tp := tp || (r->>'ok' = 'true' and (select extra->>k from public.growth_tg_rows where id = r1) = 'Ravi');

    -- ════ I. campaigns in use ════
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_campaign_delete', jsonb_build_object('id', c1)));
    tn := tn || text 'I a VSAT used by a Telegram row cannot be deleted'; td := td || r::text; tp := tp || (r->>'message' = 'IN_USE');
    delete from public.growth_tg_rows where campaign_id = c3;
    r := pg_temp.gtg_call(adm, pg_temp.gtg_rpc('growth_campaign_delete', jsonb_build_object('id', c3)));
    tn := tn || text 'I an unused VSAT can still be deleted'; td := td || r::text; tp := tp || (r->>'ok' = 'true');

    -- ════ J. trash clean-up ════
    update public.growth_tg_rows set deleted_at = now() - interval '31 days' where id = r1;
    perform public.growth__tg_purge_old();
    tn := tn || text 'J rows in the trash for more than 30 days are deleted'; td := td || text 'see test';
    tp := tp || (not exists (select 1 from public.growth_tg_rows where id = r1));
    tn := tn || text 'J the daily clean-up job is scheduled';
    select string_agg(jobname || ' ' || schedule, ', ') into s from cron.job where jobname = 'growth-tg-trash-purge';
    td := td || coalesce(s, 'missing'); tp := tp || (s is not null);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;
  return query select * from unnest(tn, tp, td);
end $$;

select * from pg_temp.run_growth_tg_tests();
