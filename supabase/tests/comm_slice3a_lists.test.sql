-- Communication Manager · Slice 3a (Manage List on VSAT data) · database tests for migration 0061
--
-- How to run (STAGING ONLY): paste this whole file into the staging SQL editor,
-- or run it through the Supabase MCP / psql. The last statement returns one row
-- per test: test | pass | detail.
--
-- Nothing is left behind: all fake people, registrations, payments and lists are
-- created inside a block that is rolled back with a private error code at the end.
-- Fake data only: @example.invalid e-mails, 90000001xx numbers, ZZ-prefixed values.
--
-- Logged-in calls are simulated the way PostgREST does it: SET ROLE authenticated
-- (or anon) + request.jwt.claims {"sub": <uid>}. auth.uid() reads that claim.

do $$ begin
  if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
    raise exception 'not the staging database - refusing to run tests';
  end if;
end $$;

-- ── helpers (session-temporary) ────────────────────────────────────────────────
-- a fake person: login + profile with the given fields (all other columns untouched)
create or replace function pg_temp.mk_person(p_email text, p_phone text, p_consent boolean, p_grad int,
                                             p_state text, p_city text, p_utm_source text, p_utm_campaign text, p_age_days int)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  values (v, coalesce(p_email, 'zz-noemail-' || substr(v::text, 1, 8) || '@example.invalid'), 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id) values (v) on conflict (id) do nothing;
  update public.profiles
     set email = p_email, phone = p_phone, consent_given = coalesce(p_consent, false), grad_year = p_grad,
         state = p_state, city = p_city, utm_source = p_utm_source, utm_campaign = p_utm_campaign,
         created_at = now() - make_interval(days => p_age_days)
   where id = v;
  return v;
end $$;

create or replace function pg_temp.mk_admin(p_uid uuid)
returns void language sql as $$
  insert into public.user_roles (user_id, role) values (p_uid, 'admin');
$$;

-- run one SQL expression as a logged-in user, as authenticated-without-sub, or as anon
create or replace function pg_temp.call_as(p_uid uuid, p_sql text, p_anon boolean default false)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  if p_anon then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    set local role anon;
  else
    perform set_config('request.jwt.claims',
      case when p_uid is null then '{"role":"authenticated"}'
           else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
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

-- preview as an admin for conditions given as JSON text; returns the jsonb result
create or replace function pg_temp.pv(p_admin uuid, p_cond text)
returns jsonb language sql as $$
  select pg_temp.call_as(p_admin, format('select public.comm_audience_preview(%L::jsonb)', p_cond));
$$;

-- ── the tests ──────────────────────────────────────────────────────────────────
create or replace function pg_temp.run_comm_slice3a_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; adm2 uuid; usr uuid; p1 uuid; p2 uuid; p3 uuid; p4 uuid;
  r jsonb; r2 jsonb; s text; f text; n bigint; ok boolean; i int; lid uuid; before_counts text; after_counts text;
  base text := '"utm_campaign":["zztest_campaign"]';
  calls text[]; bad text[];
begin
  begin -- everything below is rolled back at the end (ZDONE)
    adm := pg_temp.mk_person('zz-admin@example.invalid', null, false, null, null, null, null, 'zz_admin', 0);
    perform pg_temp.mk_admin(adm);
    adm2 := pg_temp.mk_person('zz-admin2@example.invalid', null, false, null, null, null, null, 'zz_admin', 0);
    perform pg_temp.mk_admin(adm2);
    usr := pg_temp.mk_person('zz-user@example.invalid', null, false, null, null, null, null, 'zz_user', 0);

    -- P1: paid applicant, everything filled
    p1 := pg_temp.mk_person('zz-p1@example.invalid', '9000000101', true, 2027, 'ZZState', 'ZZCity', 'zz_src', 'zztest_campaign', 10);
    -- P2: started payment but not paid; phone typed with +91 and spaces; no e-mail
    p2 := pg_temp.mk_person(null, '+91 90000 00102', false, 2026, 'ZZState', 'ZZOther', 'zz_src_b', 'zztest_campaign', 40);
    -- P3: e-mail only, never registered for VSAT, no lead/application rows
    p3 := pg_temp.mk_person('zz-p3@example.invalid', null, true, 2025, 'ZZOtherState', 'ZZCity3', null, 'zztest_campaign', 100);
    -- P4: invalid phone, blank e-mail, registration row with registered = false
    p4 := pg_temp.mk_person(' ', '12345', false, null, null, null, null, 'zztest_campaign', 200);

    insert into public.vsat_registrations (user_id, registered, campus_preference) values
      (p1, true, null), (p2, true, null), (p4, false, 'ZZ Campus Gurugram');
    insert into public.lead_manager (lead_id, lead_stage, lead_source) values
      (p1, 'applicant_paid', 'zz_source_a'), (p2, 'applicant_unpaid', 'zz_source_b')
    on conflict (lead_id) do update set lead_stage = excluded.lead_stage, lead_source = excluded.lead_source;
    insert into public.application_manager (application_id, lead_id, application_stage_1, payment_stage_1, exam_assigned, exam_given, campus_applied) values
      ('ZZTEST-APP-1', p1, 'payment_approved', 'payment_approved', true, true, 'ZZ Campus Pune'),
      -- P2's old payment_stage_1 says approved: "paid" must still be decided ONLY by vsat_payments
      ('ZZTEST-APP-2', p2, 'payment_not_initiated', 'payment_approved', false, false, null);
    -- P2 also has an attempt-2 stage: the stage filter must match attempt 1 OR attempt 2
    update public.application_manager set application_stage_2 = 'slot_selected' where application_id = 'ZZTEST-APP-2';
    perform set_config('vedam.allow_simulated_payments', 'on', true);
    insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider, amount, currency)
    values (p1, now(), 'ZZTEST-PAY-1', 'simulated', 0, 'INR');
    insert into public.vsat_payment_orders (cf_order_id, lead_id, base_amount, amount, status) values
      ('ZZTEST-ORDER-1', p1, 1, 1, 'paid'), ('ZZTEST-ORDER-2', p2, 1, 1, 'created');
    -- 11 more people for the sample-size limit
    for i in 1..11 loop
      perform pg_temp.mk_person('zz-many' || i || '@example.invalid', '90000002' || lpad(i::text, 2, '0'), true, null, null, null, null, 'zztest_many', 1);
    end loop;

    select format('%s/%s/%s/%s/%s/%s', (select count(*) from public.profiles), (select count(*) from public.lead_manager),
                  (select count(*) from public.application_manager), (select count(*) from public.vsat_registrations),
                  (select count(*) from public.vsat_payments), (select count(*) from public.vsat_payment_orders)) into before_counts;

    -- ════ A. who may call: anon, logged-in without sub, non-admin → 42501; admin → data ════
    calls := array[
      format('select public.comm_audience_preview(%L::jsonb)', '{' || base || '}'),
      'select public.comm_list_options()',
      'select public.comm_lists_list(null, 1, 10)',
      format('select public.comm_list_create(%L, %L::jsonb)', 'ZZ list A', '{' || base || '}')];
    foreach s in array calls loop
      f := substring(s from 'public\.(comm_[a-z_]+)');
      r := pg_temp.call_as(null, s, true);
      t_name := t_name || ('A anon refused: ' || f); t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(null, s);
      t_name := t_name || ('A logged in without user id refused: ' || f); t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(usr, s);
      t_name := t_name || ('A non-admin refused: ' || f); t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(adm, s);
      t_name := t_name || ('A admin allowed: ' || f); t_det := t_det || left(r::text, 150); t_pass := t_pass || (r->>'sqlstate' is null);
    end loop;
    select (pg_temp.call_as(adm, 'select public.comm_lists_list(''ZZ list A'', 1, 10)'))#>>'{rows,0,id}' into s;
    lid := s::uuid;
    foreach s in array array[
      format('select public.comm_list_update(%L::uuid, %L, null)', lid, 'ZZ renamed'),
      format('select public.comm_list_delete(%L::uuid)', lid)] loop
      f := substring(s from 'public\.(comm_[a-z_]+)');
      r := pg_temp.call_as(null, s, true);
      t_name := t_name || ('A anon refused: ' || f); t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(usr, s);
      t_name := t_name || ('A non-admin refused (even with the list id): ' || f); t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    end loop;

    -- ════ B. grants, settings, table lock-down ════
    for f, ok in
      select p.oid::regprocedure::text,
             p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') = 'search_path=""'
               and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname in ('comm_audience_preview', 'comm_list_options', 'comm_lists_list', 'comm_list_create', 'comm_list_update', 'comm_list_delete')
    loop
      t_name := t_name || ('B page function: definer, search_path '''', authenticated yes, anon no: ' || f); t_det := t_det || ok::text; t_pass := t_pass || ok;
    end loop;
    for f, ok in
      select p.oid::regprocedure::text,
             not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
               and not p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') = 'search_path=""'
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname in ('comm__conditions_check', 'comm__audience', 'comm__phone91', 'comm__mask_phone', 'comm__mask_email')
    loop
      t_name := t_name || ('B private helper not callable by anon/authenticated: ' || f); t_det := t_det || ok::text; t_pass := t_pass || ok;
    end loop;
    select c.relrowsecurity and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'comm_lists')
           and not has_table_privilege('anon', c.oid, 'select') and not has_table_privilege('authenticated', c.oid, 'select')
           and not has_table_privilege('authenticated', c.oid, 'insert') and not has_table_privilege('authenticated', c.oid, 'update')
      into ok from pg_class c where c.oid = 'public.comm_lists'::regclass;
    t_name := t_name || text 'B comm_lists: RLS on, no policies, no table access for anon/authenticated'; t_det := t_det || ok::text; t_pass := t_pass || ok;
    select string_agg(column_name, ',' order by ordinal_position) into s from information_schema.columns where table_schema = 'public' and table_name = 'comm_lists';
    t_name := t_name || text 'B comm_lists stores no contact data (only the agreed columns)'; t_det := t_det || s;
    t_pass := t_pass || (s = 'id,name,kind,conditions,owner_id,created_at,updated_at,deleted_at');
    r := pg_temp.call_as(adm, 'select to_jsonb(x) from (select * from public.comm_lists limit 1) x');
    t_name := t_name || text 'B even an admin cannot read comm_lists directly (only through the functions)'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'sqlstate' = '42501');

    -- ════ C. counts for every filter (fake people isolated by utm_campaign) ════
    r := pg_temp.pv(adm, '{' || base || '}');
    t_name := t_name || text 'C base: total 4, with phone 2 (+91 spaced counts, 12345 does not), with e-mail 2 (blank does not), consented 2'; t_det := t_det || (r - 'sample')::text;
    t_pass := t_pass || (r->>'total' = '4' and r->>'with_phone' = '2' and r->>'with_email' = '2' and r->>'consented' = '2');
    foreach s in array array[
      '"lead_stage":["applicant_paid"]|1', '"lead_stage":["applicant_paid","applicant_unpaid"]|2', '"lead_source":["zz_source_a"]|1',
      '"utm_source":["zz_src"]|1', '"campus":["ZZ Campus Pune"]|1', '"campus":["ZZ Campus Gurugram"]|1', '"campus":["ZZ Campus Pune","ZZ Campus Gurugram"]|2',
      '"state":["ZZState"]|2', '"city":["ZZCity"]|1', '"grad_year":[2026,2027]|2',
      '"signup":{"from":"' || to_char((now() at time zone 'Asia/Kolkata')::date - 45, 'YYYY-MM-DD') || '","to":"' || to_char((now() at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') || '"}|2',
      '"vsat_registered":true|2', '"vsat_registered":false|2', '"application_stage":["payment_approved"]|1', '"application_stage":["slot_selected"]|1', '"application_stage":["payment_not_initiated"]|1',
      '"application_stage":["payment_approved","slot_selected"]|2',
      '"exam_assigned":true|1', '"exam_given":false|3', '"payment":"paid"|1', '"payment":"not_paid"|3', '"payment":"started_not_paid"|1',
      '"consent_given":true|2', '"consent_given":false|2',
      '"vsat_registered":true,"payment":"started_not_paid","consent_given":false|1'] loop
      r := pg_temp.pv(adm, '{' || base || ',' || split_part(s, '|', 1) || '}');
      t_name := t_name || ('C filter ' || split_part(s, '|', 1) || ' → ' || split_part(s, '|', 2)); t_det := t_det || (r - 'sample')::text;
      t_pass := t_pass || (r->>'total' = split_part(s, '|', 2));
    end loop;
    r := pg_temp.pv(adm, '{' || base || ',"payment":"paid"}');
    t_name := t_name || text 'C paid = vsat_payments only: P2 (payment_stage_1 approved, order created) is NOT paid'; t_det := t_det || (r - 'sample')::text;
    t_pass := t_pass || (r->>'total' = '1' and r#>>'{sample,0,phone}' = '********01');

    -- ════ D. masked sample ════
    r := pg_temp.pv(adm, '{' || base || '}');
    t_name := t_name || text 'D sample: 4 rows, only keys phone/email/consent (no id, no name)'; t_det := t_det || (r->'sample')::text;
    t_pass := t_pass || (jsonb_array_length(r->'sample') = 4
      and not exists (select 1 from jsonb_array_elements(r->'sample') x, jsonb_object_keys(x) k where k not in ('phone', 'email', 'consent')));
    t_name := t_name || text 'D masks: phone ********01 / ********02 (last 2 digits only), e-mail z***@***.invalid (first letter + extension only), missing = null'; t_det := t_det || (r->'sample')::text;
    t_pass := t_pass || (r->'sample' @> '[{"phone":"********01","email":"z***@***.invalid"},{"phone":"********02","email":null},{"phone":null,"email":"z***@***.invalid"},{"phone":null,"email":null}]'::jsonb);
    t_name := t_name || text 'D masks never show more than 2 digits of a phone or any part of the e-mail domain name';
    t_det := t_det || (r->'sample')::text;
    t_pass := t_pass || not exists (select 1 from jsonb_array_elements(r->'sample') x
                                     where coalesce(x->>'phone', '') ~ '[0-9]{3}' or coalesce(x->>'email', '') ~* 'example|@[a-z]');
    s := r::text;
    t_name := t_name || text 'D no full contact anywhere in the answer (numbers, 91-numbers, e-mails)'; t_det := t_det || left(s, 120);
    t_pass := t_pass || (s !~ '[0-9]{8}' and s not like '%zz-p1@%' and s not like '%zz-p3@%' and s not like '%example.invalid"%' and s not like '%12345%');
    r := pg_temp.pv(adm, '{"utm_campaign":["zztest_many"]}');
    t_name := t_name || text 'D sample is capped at 10 rows (11 people match)'; t_det := t_det || (r - 'sample')::text;
    t_pass := t_pass || (r->>'total' = '11' and jsonb_array_length(r->'sample') = 10);

    -- ════ E. whitelist: bad conditions → 22023 ════
    bad := array[
      '{"full_name":["x"]}', '{"date_of_birth":["2010-01-01"]}', '{"lead_stage":["hacker"]}', '{"application_stage":["drop table"]}',
      '{"lead_stage":"applicant_paid"}', '{"lead_stage":[]}', '{"state":[1]}', '{"state":["' || repeat('a', 101) || '"]}',
      '{"city":[' || (select string_agg('"c' || g || '"', ',') from generate_series(1, 21) g) || ']}',
      '{"grad_year":[1999]}', '{"grad_year":["2026"]}', '{"signup":{"from":"2026-10-07","to":"2026-10-01"}}', '{"signup":{"from":"2026-02-30","to":"2026-03-01"}}',
      '{"signup":{"from":"2026-10-01"}}', '{"signup":{"from":"2026-10-01","to":"2026-10-02","x":1}}', '{"vsat_registered":"yes"}', '{"exam_given":1}',
      '{"payment":"free"}', '{"payment":["paid"]}', '{"consent_given":null}', '["utm_source"]', '"x"',
      '{"state":["a\tb"]}', '{"state":["' || repeat('x', 90) || '"],"city":["' || repeat('y', 90) || '"],"utm_source":[' || (select string_agg('"' || repeat('z', 95) || g || '"', ',') from generate_series(1, 20) g) || '],"utm_campaign":[' || (select string_agg('"' || repeat('w', 95) || g || '"', ',') from generate_series(1, 20) g) || ']}'];
    foreach s in array bad loop
      r := pg_temp.call_as(adm, format('select public.comm_audience_preview(%L::jsonb)', s));
      t_name := t_name || ('E preview refuses: ' || left(s, 70)); t_det := t_det || r::text;
      t_pass := t_pass || (r->>'sqlstate' = '22023');
    end loop;
    r := pg_temp.call_as(adm, format('select public.comm_list_create(%L, %L::jsonb)', 'ZZ bad', '{"full_name":["x"]}'));
    t_name := t_name || text 'E create refuses unknown key'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '22023');
    foreach s in array array['', '   ', repeat('n', 81), 'bad' || chr(10) || 'name'] loop
      r := pg_temp.call_as(adm, format('select public.comm_list_create(%L, %L::jsonb)', s, '{}'));
      t_name := t_name || ('E create refuses name: ' || replace(left(s, 20), chr(10), '\n') || ' (len ' || length(s) || ')'); t_det := t_det || r::text;
      t_pass := t_pass || (r->>'sqlstate' = '22023');
    end loop;
    r := pg_temp.call_as(adm, 'select public.comm_audience_preview(''{}''::jsonb)');
    t_name := t_name || text 'E empty conditions = everyone (allowed)'; t_det := t_det || (r - 'sample')::text;
    t_pass := t_pass || ((r->>'total')::int >= 4);

    -- ════ F. lists: create / list / update / delete ════
    r := pg_temp.call_as(adm, format('select public.comm_list_create(%L, %L::jsonb)', 'ZZ paid applicants', '{' || base || ',"payment":"paid"}'));
    t_name := t_name || text 'F create: returns the list, owner = me, kind dynamic'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'name' = 'ZZ paid applicants' and r->>'kind' = 'dynamic' and (r->>'owner_is_me')::boolean and r->'conditions'->>'payment' = 'paid');
    lid := (r->>'id')::uuid;
    r := pg_temp.call_as(adm, 'select public.comm_lists_list(''ZZ paid'', 1, 10)');
    t_name := t_name || text 'F list: search finds it, total 1'; t_det := t_det || left(r::text, 150);
    t_pass := t_pass || (r->>'total' = '1' and r#>>'{rows,0,id}' = lid::text);
    r := pg_temp.call_as(adm2, 'select public.comm_lists_list(''ZZ paid'', 1, 10)');
    t_name := t_name || text 'F another admin sees it, owner_is_me = false'; t_det := t_det || left(r::text, 150);
    t_pass := t_pass || (r#>>'{rows,0,owner_is_me}' = 'false');
    r := pg_temp.call_as(adm, format('select public.comm_list_update(%L::uuid, %L, %L::jsonb)', lid, 'ZZ started not paid', '{' || base || ',"payment":"started_not_paid"}'));
    t_name := t_name || text 'F update name + conditions'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'name' = 'ZZ started not paid' and r->'conditions'->>'payment' = 'started_not_paid');
    r := pg_temp.call_as(adm, format('select public.comm_list_update(%L::uuid, null, %L::jsonb)', lid, '{"payment":"free"}'));
    t_name := t_name || text 'F update refuses bad conditions (and keeps the old ones)'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'sqlstate' = '22023'
      and (select conditions->>'payment' from public.comm_lists where id = lid) = 'started_not_paid');
    r := pg_temp.call_as(adm2, format('select public.comm_list_update(%L::uuid, %L, null)', lid, 'ZZ renamed by admin 2'));
    t_name := t_name || text 'F owner-or-admin rule: another admin may rename'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'name' = 'ZZ renamed by admin 2');
    r := pg_temp.call_as(adm, format('select public.comm_list_update(%L::uuid, null, null)', gen_random_uuid()));
    t_name := t_name || text 'F unknown id → P0002'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = 'P0002');
    r := pg_temp.call_as(adm, format('select public.comm_list_delete(%L::uuid)', lid));
    t_name := t_name || text 'F delete is soft: gone from the list, row kept with deleted_at'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'deleted' = 'true'
      and (pg_temp.call_as(adm, 'select public.comm_lists_list(''ZZ'', 1, 10)')->>'total') = '1'   -- only "ZZ list A" left
      and exists (select 1 from public.comm_lists where id = lid and deleted_at is not null));
    r := pg_temp.call_as(adm, format('select public.comm_list_delete(%L::uuid)', lid));
    t_name := t_name || text 'F delete twice → P0002'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = 'P0002');
    r := pg_temp.call_as(adm, format('select public.comm_list_update(%L::uuid, %L, null)', lid, 'ZZ back'));
    t_name := t_name || text 'F update a deleted list → P0002'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = 'P0002');
    foreach s in array array['select public.comm_lists_list(null, 0, 10)', 'select public.comm_lists_list(null, 1, 101)', format('select public.comm_lists_list(%L, 1, 10)', repeat('s', 101))] loop
      r := pg_temp.call_as(adm, s);
      t_name := t_name || ('F lists_list refuses: ' || left(s, 60)); t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '22023');
    end loop;
    select count(*) into n from public.audit_log where table_name = 'comm_lists' and record_id = lid::text;
    t_name := t_name || text 'F audit rows written for create, update(s), delete'; t_det := t_det || n::text; t_pass := t_pass || (n >= 4);

    -- ════ G. options ════
    r := pg_temp.call_as(adm, 'select public.comm_list_options()');
    t_name := t_name || text 'G options: stage lists are the database enum values; campus/state include fake values'; t_det := t_det || left(r::text, 150);
    t_pass := t_pass || (r->'lead_stage' ? 'applicant_paid' and r->'application_stage' ? 'payment_approved'
                         and r->'campus' ? 'ZZ Campus Pune' and r->'campus' ? 'ZZ Campus Gurugram' and r->'state' ? 'ZZState'
                         and r::text not like '%@%');

    -- ════ H. read-only on the VSAT tables ════
    select format('%s/%s/%s/%s/%s/%s', (select count(*) from public.profiles), (select count(*) from public.lead_manager),
                  (select count(*) from public.application_manager), (select count(*) from public.vsat_registrations),
                  (select count(*) from public.vsat_payments), (select count(*) from public.vsat_payment_orders)) into after_counts;
    t_name := t_name || text 'H VSAT tables unchanged by previews/options/lists'; t_det := t_det || (before_counts || ' -> ' || after_counts);
    t_pass := t_pass || (before_counts = after_counts);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select * from pg_temp.run_comm_slice3a_tests();
