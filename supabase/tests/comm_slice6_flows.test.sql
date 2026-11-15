-- Communication Manager · Slice 6 (WhatsApp Flow drafts) · database tests for migration 0069
--
-- How to run (STAGING ONLY): paste this whole file into the staging SQL editor, or run it through the
-- Supabase MCP / psql. The last statement returns one row per test: test | pass | detail.
--
-- Nothing is left behind: all test data is created inside a block that is rolled back with a private
-- error code at the end (ZDONE). Fake data only (@example.invalid, names starting with ZZ).
-- The 200-flow cap test inserts 200 tiny rows inside that block (rolled back).

do $$ begin
  if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
    raise exception 'not the staging database - refusing to run tests';
  end if;
end $$;

create or replace function pg_temp.mk_user(p_email text)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  values (v, p_email, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id, email) values (v, p_email)
  on conflict (id) do update set email = excluded.email;
  return v;
end $$;

create or replace function pg_temp.mk_admin(p_uid uuid)
returns void language sql as $$
  insert into public.user_roles (user_id, role) values (p_uid, 'admin');
$$;

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

-- create as a user: name, screens (jsonb text); description / module / category fixed unless given
create or replace function pg_temp.mk(p_uid uuid, p_name text, p_screens text,
  p_desc text default 'ZZ test flow', p_module text default 'Leads', p_cat text default 'ZZ Category')
returns jsonb language sql as $$
  select pg_temp.call_as(p_uid, format('select public.comm_flow_create(%L, %L, %L, %L, %L::jsonb)', p_name, p_desc, p_module, p_cat, p_screens));
$$;

create or replace function pg_temp.run_comm_slice6_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; usr uuid; r jsonb; s text; f text; ok boolean; fid uuid; fid2 uuid; n int; i int;
  sc text := '[{"id":"screen_one","title":"Candidate Details","cta":"Continue","fields":[{"label":"Full name","kind":"text","placeholder":"Your name"},{"label":"I agree","kind":"checkbox"}]}]';
  big text;
  calls text[];
begin
  begin -- everything below is rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('zz-flow-admin@example.invalid');
    perform pg_temp.mk_admin(adm);
    usr := pg_temp.mk_user('zz-flow-user@example.invalid');

    -- ════ A. who may call ════
    r := pg_temp.mk(adm, 'ZZ Seed flow', sc);
    fid := (r->>'id')::uuid;
    calls := array[
      'select public.comm_flow_list()',
      format('select public.comm_flow_get(%L::uuid)', fid),
      format('select public.comm_flow_create(%L, %L, %L, %L, %L::jsonb)', 'ZZ A flow', 'x', 'Leads', 'ZZ Category', sc),
      format('select public.comm_flow_duplicate(%L::uuid)', fid),
      format('select public.comm_flow_delete(%L::uuid)', fid)];
    foreach s in array calls loop
      f := substring(s from 'public\.(comm_[a-z_]+)');
      r := pg_temp.call_as(null, s, true);
      t_name := t_name || ('A anon refused: ' || f); t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(null, s);
      t_name := t_name || ('A logged in without user id refused: ' || f); t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(usr, s);
      t_name := t_name || ('A non-admin refused: ' || f); t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    end loop;
    t_name := t_name || text 'A refused calls changed nothing (seed flow still live, no "ZZ A flow", no copy)';
    t_det := t_det || (select string_agg(name || ':' || (deleted_at is null)::text, ',') from public.comm_flows where name like 'ZZ%' or name like 'Copy%');
    t_pass := t_pass || ((select count(*) from public.comm_flows where deleted_at is null and (name like 'ZZ%' or name like 'Copy%')) = 1
                         and exists (select 1 from public.comm_flows where id = fid and deleted_at is null));

    -- ════ B. table + function settings ════
    select c.relrowsecurity and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'comm_flows')
           and not has_table_privilege('anon', c.oid, 'select') and not has_table_privilege('authenticated', c.oid, 'select')
           and not has_table_privilege('authenticated', c.oid, 'insert') and not has_table_privilege('authenticated', c.oid, 'update')
           and not has_table_privilege('authenticated', c.oid, 'delete')
      into ok from pg_class c where c.oid = 'public.comm_flows'::regclass;
    t_name := t_name || text 'B comm_flows: RLS on, no policies, no table access for anon/authenticated'; t_det := t_det || ok::text; t_pass := t_pass || ok;
    r := pg_temp.call_as(adm, 'select to_jsonb(x) from (select * from public.comm_flows limit 1) x');
    t_name := t_name || text 'B even an admin cannot read comm_flows directly (only through the functions)'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'sqlstate' = '42501');
    for f, ok in
      select p.oid::regprocedure::text,
             p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') = 'search_path=""'
               and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
        from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname in ('comm_flow_list', 'comm_flow_get', 'comm_flow_create', 'comm_flow_duplicate', 'comm_flow_delete')
    loop
      t_name := t_name || ('B page function: definer, search_path '''', authenticated yes, anon no: ' || f); t_det := t_det || ok::text; t_pass := t_pass || ok;
    end loop;
    select not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
           and not p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') = 'search_path=""'
      into ok from pg_proc p where p.oid = 'public.comm__flow_screens_check(jsonb)'::regprocedure;
    t_name := t_name || text 'B private helper comm__flow_screens_check not callable by anon/authenticated'; t_det := t_det || ok::text; t_pass := t_pass || ok;
    t_name := t_name || text 'B audit trigger on comm_flows';
    t_det := t_det || (select count(*)::text from pg_trigger where tgrelid = 'public.comm_flows'::regclass and tgname = 'trg_audit_comm_flows');
    t_pass := t_pass || exists (select 1 from pg_trigger where tgrelid = 'public.comm_flows'::regclass and tgname = 'trg_audit_comm_flows');

    -- ════ C. admin: create / list / get / duplicate ════
    r := pg_temp.mk(adm, '  ZZ VSAT Slot ', sc, 'Line one' || chr(10) || 'line two', 'Raw Data', ' ZZ Admissions ');
    t_name := t_name || text 'C create: trimmed name and category, Draft, module, description with one line break, screen_count 1';
    t_det := t_det || r::text;
    t_pass := t_pass || (r->>'name' = 'ZZ VSAT Slot' and r->>'category' = 'ZZ Admissions' and r->>'status' = 'Draft' and r->>'module' = 'Raw Data'
                         and r->>'description' = 'Line one' || chr(10) || 'line two' and r->>'screen_count' = '1');
    fid2 := (r->>'id')::uuid;
    t_name := t_name || text 'C create answer has only the summary keys (no screens, no owner)';
    t_det := t_det || (select string_agg(k, ',' order by k) from jsonb_object_keys(r) k);
    t_pass := t_pass || ((select string_agg(k, ',' order by k) from jsonb_object_keys(r) k) = 'category,created_at,description,id,module,name,screen_count,status');
    t_name := t_name || text 'C owner_id is stored (= the admin) for the record';
    t_det := t_det || coalesce((select (owner_id = adm)::text from public.comm_flows where id = fid2), 'missing');
    t_pass := t_pass || coalesce((select owner_id = adm from public.comm_flows where id = fid2), false);

    r := pg_temp.call_as(adm, 'select public.comm_flow_list()');
    t_name := t_name || text 'C list: newest first, no screens / owner, categories in use (sorted, distinct)';
    t_det := t_det || left(r::text, 300);
    -- both flows were made in this one transaction (same created_at), so check the order rule itself, not a fixed first row
    t_pass := t_pass || ((r->'rows') @> jsonb_build_array(jsonb_build_object('id', fid2)) and (r->>'total')::int = jsonb_array_length(r->'rows')
                         and not exists (select 1 from (select (e->>'created_at')::timestamptz c, lag((e->>'created_at')::timestamptz) over (order by o) p
                                                          from jsonb_array_elements(r->'rows') with ordinality as t(e, o)) x where x.c > x.p)
                         and not exists (select 1 from jsonb_array_elements(r->'rows') x, jsonb_object_keys(x) k
                                          where k not in ('id', 'name', 'description', 'module', 'category', 'status', 'created_at', 'screen_count'))
                         and r->'categories' @> '["ZZ Admissions", "ZZ Category"]'::jsonb
                         and position(adm::text in r::text) = 0);
    r := pg_temp.call_as(adm, format('select public.comm_flow_get(%L::uuid)', fid2));
    t_name := t_name || text 'C get: the screens exactly as saved, no owner';
    t_det := t_det || left(r::text, 300);
    t_pass := t_pass || (r->'screens' = sc::jsonb and not (r ? 'owner_id') and position(adm::text in r::text) = 0);

    r := pg_temp.call_as(adm, format('select public.comm_flow_duplicate(%L::uuid)', fid2));
    t_name := t_name || text 'C duplicate: "Copy of …", Draft, same screens'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'name' = 'Copy of ZZ VSAT Slot' and r->>'status' = 'Draft'
                         and (select screens from public.comm_flows where id = (r->>'id')::uuid) = sc::jsonb);
    r := pg_temp.call_as(adm, format('select public.comm_flow_duplicate(%L::uuid)', fid2));
    t_name := t_name || text 'C duplicate again: "Copy 2 of …"'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'name' = 'Copy 2 of ZZ VSAT Slot');
    r := pg_temp.mk(adm, repeat('L', 80), sc);
    r := pg_temp.call_as(adm, format('select public.comm_flow_duplicate(%L::uuid)', (r->>'id')::uuid));
    t_name := t_name || text 'C duplicate of an 80-character name stays within 80'; t_det := t_det || coalesce(r->>'name', r::text);
    t_pass := t_pass || (char_length(r->>'name') = 80 and r->>'name' like 'Copy of L%');
    r := pg_temp.mk(adm, 'ZZ हिंदी फ़्लो', sc);
    t_name := t_name || text 'C non-English name is fine'; t_det := t_det || r::text; t_pass := t_pass || (r->>'name' = 'ZZ हिंदी फ़्लो');

    -- ════ D. names ════
    r := pg_temp.mk(adm, 'zz vsat slot', sc);
    t_name := t_name || text 'D duplicate name (different case) → 23505 name_taken'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'sqlstate' = '23505' and r->>'message' = 'name_taken');
    foreach s in array array['', '   ', repeat('n', 81), 'ZZ <script>alert(1)</script>', 'ZZ a>b', 'ZZ tab' || chr(9) || 'name', 'ZZ new' || chr(10) || 'line'] loop
      r := pg_temp.mk(adm, s, sc);
      t_name := t_name || ('D name refused: ' || replace(replace(left(s, 30), chr(10), '\n'), chr(9), '\t') || ' (len ' || char_length(s) || ')'); t_det := t_det || r::text;
      t_pass := t_pass || (r->>'sqlstate' = '22023');
    end loop;
    foreach s in array array['tab' || chr(9) || 'x', 'a <b>', repeat('d', 301)] loop
      r := pg_temp.mk(adm, 'ZZ desc ' || char_length(s), sc, s);
      t_name := t_name || ('D description refused: ' || replace(left(s, 20), chr(9), '\t') || ' (len ' || char_length(s) || ')'); t_det := t_det || r::text;
      t_pass := t_pass || (r->>'sqlstate' = '22023');
    end loop;
    r := pg_temp.mk(adm, 'ZZ module', sc, 'x', 'Opportunity');
    t_name := t_name || text 'D module other than Leads / Raw Data refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '22023');
    foreach s in array array['', repeat('c', 41), 'ZZ <cat>', 'cat' || chr(10)] loop
      r := pg_temp.mk(adm, 'ZZ cat ' || char_length(s), sc, 'x', 'Leads', s);
      t_name := t_name || ('D category refused: ' || replace(left(s, 20), chr(10), '\n') || ' (len ' || char_length(s) || ')'); t_det := t_det || r::text;
      t_pass := t_pass || (r->>'sqlstate' = '22023');
    end loop;

    -- ════ E. screens (break-it) ════
    big := '[{"id":"screen_one","title":"T","cta":"Go","fields":[{"label":"' || repeat('x', 80) || '","kind":"text","placeholder":"' || repeat('p', 60) || '"}]}';
    for i in 2..10 loop
      big := big || ',{"id":"s' || i || '","title":"' || repeat('t', 60) || '","cta":"' || repeat('c', 30) || '","fields":['
             || (select string_agg('{"label":"' || repeat('l', 80) || '","kind":"select","placeholder":"' || repeat('p', 60) || '"}', ',') from generate_series(1, 12)) || ']}';
    end loop;
    big := big || ']';
    foreach s in array array[
      'null', '{}', '"x"', '[]',
      '[' || (select string_agg('{"id":"s' || g || '","title":"T","cta":"Go","fields":[]}', ',') from generate_series(1, 11) g) || ']',
      '[{"id":"screen_one","title":"T","cta":"Go","fields":[{"label":"A","kind":"file"}]}]',
      '[{"id":"screen_one","title":"T","cta":"Go","fields":[{"label":"A","kind":"text","x":1}]}]',
      '[{"id":"screen_one","title":"T","cta":"Go","fields":[{"label":"A"}]}]',
      '[{"id":"screen_one","title":"T","cta":"Go","fields":[],"onload":"x"}]',
      '[{"id":"screen_one","title":"T","fields":[]}]',
      '[{"id":"screen_one","title":"<script>alert(1)</script>","cta":"Go","fields":[]}]',
      '[{"id":"screen_one","title":"T","cta":"Go","fields":[{"label":"<img src=x onerror=alert(1)>","kind":"text"}]}]',
      '[{"id":"screen_one","title":"T","cta":"Go >","fields":[]}]',
      '[{"id":"screen_one","title":"T","cta":"Go","fields":[{"label":"A","kind":"text","placeholder":"a\u0007b"}]}]',
      '[{"id":"screen_one","title":"   ","cta":"Go","fields":[]}]',
      '[{"id":"screen_one","title":"' || repeat('t', 61) || '","cta":"Go","fields":[]}]',
      '[{"id":"screen_one","title":"T","cta":"' || repeat('c', 31) || '","fields":[]}]',
      '[{"id":"screen_one","title":"T","cta":"Go","fields":[{"label":"' || repeat('l', 81) || '","kind":"text"}]}]',
      '[{"id":"screen_one","title":"T","cta":"Go","fields":[{"label":"A","kind":"text","placeholder":"' || repeat('p', 61) || '"}]}]',
      '[{"id":"screen_one","title":"T","cta":"Go","fields":[' || (select string_agg('{"label":"A","kind":"text"}', ',') from generate_series(1, 13) g) || ']}]',
      '[{"id":"Screen One","title":"T","cta":"Go","fields":[]}]',
      '[{"id":"s1","title":"T","cta":"Go","fields":[]},{"id":"s1","title":"T","cta":"Go","fields":[]}]',
      '[{"id":1,"title":"T","cta":"Go","fields":[]}]',
      '[{"id":"screen_one","title":"T","cta":"Go","fields":{}}]',
      '["screen"]',
      big] loop
      r := pg_temp.mk(adm, 'ZZ screens ' || md5(s), s);
      t_name := t_name || ('E screens refused: ' || left(s, 70) || ' (' || octet_length(s) || ' bytes)'); t_det := t_det || left(r::text, 200);
      t_pass := t_pass || (r->>'sqlstate' = '22023');
    end loop;
    t_name := t_name || text 'E the big screens really are over 20 KB as jsonb text'; t_det := t_det || octet_length(big::jsonb::text)::text;
    t_pass := t_pass || (octet_length(big::jsonb::text) > 20480);
    r := pg_temp.mk(adm, 'ZZ ten screens', '[' || (select string_agg('{"id":"s' || g || '","title":"T","cta":"Go","fields":[]}', ',') from generate_series(1, 10) g) || ']');
    t_name := t_name || text 'E exactly 10 screens with no fields is allowed'; t_det := t_det || r::text; t_pass := t_pass || (r->>'screen_count' = '10');
    begin
      insert into public.comm_flows (name, module, category, screens, owner_id) values ('ZZ direct', 'Leads', 'ZZ', '[{"id":"s","title":"<b>","cta":"x","fields":[]}]', adm);
      ok := false;
    exception when others then ok := sqlstate = '22023';
    end;
    t_name := t_name || text 'E the table CHECK refuses bad screens even on a direct insert'; t_det := t_det || ok::text; t_pass := t_pass || ok;
    begin
      insert into public.comm_flows (name, module, category, screens, status, owner_id) values ('ZZ active', 'Leads', 'ZZ', sc::jsonb, 'Active', adm);
      ok := false;
    exception when check_violation then ok := true;
    end;
    t_name := t_name || text 'E status can only be Draft or Inactive (Active refused by the table)'; t_det := t_det || ok::text; t_pass := t_pass || ok;

    -- ════ F. delete (soft) and deleted flows ════
    r := pg_temp.call_as(adm, format('select public.comm_flow_delete(%L::uuid)', fid2));
    t_name := t_name || text 'F delete: soft (row kept with deleted_at), gone from the list'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'deleted' = 'true' and exists (select 1 from public.comm_flows where id = fid2 and deleted_at is not null)
                         and not (pg_temp.call_as(adm, 'select public.comm_flow_list()')->'rows') @> jsonb_build_array(jsonb_build_object('id', fid2)));
    foreach s in array array[
      format('select public.comm_flow_get(%L::uuid)', fid2), format('select public.comm_flow_duplicate(%L::uuid)', fid2),
      format('select public.comm_flow_delete(%L::uuid)', fid2), format('select public.comm_flow_get(%L::uuid)', gen_random_uuid()),
      format('select public.comm_flow_delete(%L::uuid)', gen_random_uuid())] loop
      r := pg_temp.call_as(adm, s);
      t_name := t_name || ('F deleted / unknown flow → P0002: ' || substring(s from 'comm_[a-z_]+')); t_det := t_det || r::text;
      t_pass := t_pass || (r->>'sqlstate' = 'P0002');
    end loop;
    r := pg_temp.call_as(adm, 'select public.comm_flow_get(null)');
    t_name := t_name || text 'F null id → 22023'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '22023');
    r := pg_temp.mk(adm, 'ZZ VSAT Slot', sc);
    t_name := t_name || text 'F the name of a deleted flow can be used again'; t_det := t_det || r::text; t_pass := t_pass || (r->>'name' = 'ZZ VSAT Slot');
    t_name := t_name || text 'F audit rows written for create and delete';
    t_det := t_det || (select count(*)::text from public.audit_log where table_name = 'comm_flows' and record_id = fid2::text);
    t_pass := t_pass || ((select count(*) from public.audit_log where table_name = 'comm_flows' and record_id = fid2::text) >= 2);

    -- ════ G. at most 200 live flows ════
    select count(*) into n from public.comm_flows where deleted_at is null;
    insert into public.comm_flows (name, module, category, screens, owner_id)
      select 'ZZ cap ' || g, 'Leads', 'ZZ Cap', sc::jsonb, adm from generate_series(1, 200 - n) g;
    r := pg_temp.mk(adm, 'ZZ two hundred and one', sc);
    t_name := t_name || text 'G the 201st live flow is refused (22023)'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '22023');
    r := pg_temp.call_as(adm, format('select public.comm_flow_duplicate(%L::uuid)', fid));
    t_name := t_name || text 'G duplicate is refused at the cap too'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '22023');
    perform pg_temp.call_as(adm, format('select public.comm_flow_delete(%L::uuid)', fid));
    r := pg_temp.mk(adm, 'ZZ after one delete', sc);
    t_name := t_name || text 'G after deleting one, a new flow fits again'; t_det := t_det || r::text; t_pass := t_pass || (r->>'status' = 'Draft');
    r := pg_temp.call_as(adm, 'select public.comm_flow_list()');
    t_name := t_name || text 'G list at the cap: total 200'; t_det := t_det || (r->>'total'); t_pass := t_pass || ((r->>'total')::int = 200);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select * from pg_temp.run_comm_slice6_tests();
