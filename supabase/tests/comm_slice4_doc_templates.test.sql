-- Communication Manager · Slice 4 (Manage Document Templates) · database tests for migration 0066
--
-- How to run (STAGING ONLY): paste this whole file into the staging SQL editor, or run it through the
-- Supabase MCP / psql. The last statement returns one row per test: test | pass | detail.
-- Refuses to run unless app_flags.environment = 'staging'.
--
-- Nothing is left behind: all test data is created inside a block that is rolled back with a private
-- error code at the end. Fake data only (@example.invalid e-mails, ZZ names). Templates hold no personal data.

do $$ begin
  if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
    raise exception 'not the staging database - refusing to run tests';
  end if;
end $$;

-- ── helpers (session-temporary) ────────────────────────────────────────────────
create or replace function pg_temp.mk_user(p_email text)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  values (v, p_email, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id) values (v) on conflict (id) do nothing;
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

create or replace function pg_temp.mk(p_uid uuid, p_name text, p_html text, p_dry boolean default false)
returns jsonb language sql as $$
  select pg_temp.call_as(p_uid, format('select public.comm_doc_template_create(%L, %L, %L)', p_name, p_html, p_dry));
$$;

-- ── the tests ──────────────────────────────────────────────────────────────────
create or replace function pg_temp.run_comm_slice4_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; adm2 uuid; usr uuid; tid uuid; tid2 uuid;
  r jsonb; s text; f text; n bigint; n2 bigint; ok boolean; before_counts text; after_counts text; bad text[];
  good text := '<h1>Offer</h1><p style="text-align:center">Dear {{full_name}} ({{vsat_id}}),</p><p>Campus: {{campus}} · {{today}} · {{full_name}}</p>'
               || '<table><tr><td colspan="2">a</td></tr></table><br />';
begin
  begin -- everything below is rolled back at the end (ZDONE)
    adm  := pg_temp.mk_user('zz-s4-admin@example.invalid');  perform pg_temp.mk_admin(adm);
    adm2 := pg_temp.mk_user('zz-s4-admin2@example.invalid'); perform pg_temp.mk_admin(adm2);
    usr  := pg_temp.mk_user('zz-s4-user@example.invalid');
    select format('%s/%s/%s', (select count(*) from public.profiles), (select count(*) from public.comm_lists),
                  (select count(*) from public.comms_optouts)) into before_counts;

    -- ════ A. who may call ════
    r := pg_temp.mk(adm, 'ZZ seed', '<p>seed</p>');
    tid := (r->>'id')::uuid;
    foreach s in array array[
      'select public.comm_doc_template_list(null, 1, 10)',
      format('select public.comm_doc_template_get(%L::uuid)', tid),
      format('select public.comm_doc_template_create(%L, %L, true)', 'ZZ a', '<p>a</p>'),
      format('select public.comm_doc_template_create(%L, %L, false)', 'ZZ a', '<p>a</p>'),
      format('select public.comm_doc_template_update(%L::uuid, %L, null)', tid, 'ZZ renamed'),
      format('select public.comm_doc_template_delete(%L::uuid)', tid)] loop
      f := substring(s from 'public\.(comm_[a-z_]+)') || case when s like '%, true)' then ' (dry run)' else '' end;
      r := pg_temp.call_as(null, s, true);
      t_name := t_name || ('A anon refused: ' || f); t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(null, s);
      t_name := t_name || ('A logged in without user id refused: ' || f); t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(usr, s);
      t_name := t_name || ('A non-admin refused: ' || f); t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    end loop;
    select count(*) into n from public.comm_doc_templates;
    t_name := t_name || text 'A refused callers wrote nothing (only the seed exists, not renamed, not deleted)';
    t_det := t_det || n::text;
    t_pass := t_pass || (n = 1 and exists (select 1 from public.comm_doc_templates where id = tid and name = 'ZZ seed' and deleted_at is null));

    -- ════ B. grants, settings, table ════
    for f, ok in
      select p.oid::regprocedure::text,
             p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') = 'search_path=""'
               and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname like 'comm\_doc\_template\_%'
    loop
      t_name := t_name || ('B page function: definer, search_path '''', authenticated yes, anon no: ' || f); t_det := t_det || ok::text; t_pass := t_pass || ok;
    end loop;
    select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname like 'comm\_doc\_template\_%';
    t_name := t_name || text 'B exactly 5 page functions (list, get, create, update, delete), no overloads'; t_det := t_det || n::text; t_pass := t_pass || (n = 5);
    select not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
           and not p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') = 'search_path=""'
      into ok from pg_proc p where p.oid = 'public.comm__doc_html_check(text)'::regprocedure;
    t_name := t_name || text 'B helper comm__doc_html_check: not callable by anon/authenticated, not definer, search_path '''''; t_det := t_det || ok::text; t_pass := t_pass || ok;
    select c.relrowsecurity and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'comm_doc_templates')
           and not exists (select 1 from unnest(array['anon', 'authenticated']) ro, unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) pr
                            where has_table_privilege(ro, c.oid, pr))
      into ok from pg_class c where c.oid = 'public.comm_doc_templates'::regclass;
    t_name := t_name || text 'B comm_doc_templates: RLS on, no policies, no privilege at all for anon/authenticated'; t_det := t_det || ok::text; t_pass := t_pass || ok;
    select string_agg(column_name, ',' order by ordinal_position) into s from information_schema.columns where table_schema = 'public' and table_name = 'comm_doc_templates';
    t_name := t_name || text 'B comm_doc_templates has only the agreed columns'; t_det := t_det || s;
    t_pass := t_pass || (s = 'id,name,html,merge_fields,owner_id,created_at,updated_at,deleted_at');
    select exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
                    where t.tgrelid = 'public.comm_doc_templates'::regclass and p.proname = 'audit_trigger' and not t.tgisinternal) into ok;
    t_name := t_name || text 'B the existing audit_trigger() is attached to comm_doc_templates'; t_det := t_det || ok::text; t_pass := t_pass || ok;
    select count(*) into n from pg_constraint where conrelid = 'public.comm_doc_templates'::regclass and contype = 'f';
    t_name := t_name || text 'B comm_doc_templates has no foreign key to existing tables'; t_det := t_det || n::text; t_pass := t_pass || (n = 0);
    r := pg_temp.call_as(adm, 'select to_jsonb(x) from (select * from public.comm_doc_templates limit 1) x');
    t_name := t_name || text 'B even an admin cannot read comm_doc_templates directly'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    begin
      insert into public.comm_doc_templates (name, html, merge_fields, owner_id) values ('ZZ bad', '<p>x</p>', array['email'], adm);
      ok := false;
    exception when check_violation then ok := true;
    end;
    t_name := t_name || text 'B table check refuses an unknown merge field even on a direct insert'; t_det := t_det || ok::text; t_pass := t_pass || ok;
    begin
      insert into public.comm_doc_templates (name, html, owner_id) values ('ZZ big', repeat('a', 102401), adm);
      ok := false;
    exception when check_violation then ok := true;
    end;
    t_name := t_name || text 'B table check refuses HTML over 100 KB even on a direct insert'; t_det := t_det || ok::text; t_pass := t_pass || ok;

    -- ════ C. create ════
    select count(*) into n from public.comm_doc_templates;
    select count(*) into n2 from public.audit_log;
    r := pg_temp.mk(adm, 'ZZ offer', good, true);
    t_name := t_name || text 'C dry run: merge fields found, size returned, nothing written (no row, no audit)'; t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'dry_run')::boolean and r->'merge_fields' = '["campus","full_name","today","vsat_id"]'::jsonb
                         and (r->>'size')::int = octet_length(good) and (select count(*) from public.comm_doc_templates) = n
                         and (select count(*) from public.audit_log) = n2);
    r := pg_temp.mk(adm, '  ZZ offer  ', good);
    t_name := t_name || text 'C create: name trimmed, merge fields computed by the database (sorted, distinct), owner = me'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'name' = 'ZZ offer' and r->'merge_fields' = '["campus","full_name","today","vsat_id"]'::jsonb
                         and (r->>'owner_is_me')::boolean and r->>'id' is not null and not (r->>'dry_run')::boolean);
    tid2 := (r->>'id')::uuid;
    select html = good and owner_id = adm into ok from public.comm_doc_templates where id = tid2;
    t_name := t_name || text 'C the stored HTML is exactly what was sent (already cleaned by the route)'; t_det := t_det || coalesce(ok::text, 'null'); t_pass := t_pass || coalesce(ok, false);
    r := pg_temp.mk(adm, 'ZZ plain', '<p>No fields at all</p>');
    t_name := t_name || text 'C a template without merge fields is fine (merge_fields = [])'; t_det := t_det || r::text;
    t_pass := t_pass || (r->'merge_fields' = '[]'::jsonb);

    -- ════ D. second line of defence: refused with 22023, nothing written ════
    select count(*) into n from public.comm_doc_templates;
    bad := array[
      '<script>alert(1)</script>', '<p>a</p><SCRIPT>alert(1)</SCRIPT>', '<p onclick="alert(1)">a</p>', '<p ONMOUSEOVER="x">a</p>',
      '<p>a <img src=x onerror=alert(1)></p>', '<a href="https://example.invalid">x</a>', '<p>javascript:alert(1)</p>', '<p>JavaScript : x</p>',
      '<p>vbscript:x</p>', '<iframe src="x"></iframe>', '<svg onload="x"></svg>', '<math></math>', '<style>p{}</style>', '<link rel="stylesheet">',
      '<meta charset="utf-8">', '<base href="/">', '<form><input></form>', '<object></object>', '<embed>', '<p>a</p><!-- c -->', '<!--[if IE]><p>x</p><![endif]-->',
      '<![CDATA[x]]>', '<?xml version="1.0"?><p>a</p>', '<p style="width:url(x)">a</p>', '<p style="width:expression(alert(1))">a</p>',
      '<p style="background:URL(x)">a</p>', '<p style="@import ''x''">a</p>', '<p style="width:\65 xpression(1)">a</p>', '<p style="x:data:text/html">a</p>',
      '<p class="x">a</p>', '<p id="x">a</p>', '<p title="x">a</p>', '<p data-x="1">a</p>', '<p style=''text-align:left''>a</p>', '<p style=text-align:left>a</p>',
      '<td colspan="21">a</td>', '<td colspan="0">a</td>', '<td colspan="2 ">a</td>', '<p colspan="2">a</p>', '<font>a</font>', '<img src="x">', '<p>a</p><p',
      '<p>a < b</p>', '<p>a<<p>b</p>', '<p>{{email}}</p>', '<p>{{ first_name }}</p>', '<p>{{constructor}}</p>', '<p>{{__proto__}}</p>', '<p>{{first_name</p>',
      '<p>first_name}}</p>', '<p>{{{first_name}}}</p>', '<p>{{First_Name}}</p>', '', '   ', repeat('a', 102401), '<p>a' || chr(1) || '</p>',
      -- style allowlist (same 8 properties and value patterns as the route) and no "&" inside a tag
      '<p style="position:fixed">a</p>', '<p style="width:&#117;rl(x)">a</p>', '<p style="width:&#x75;rl(1)">a</p>',
      '<p style="text-align:left&amp;">a</p>', '<td colspan="2" style="width:1px&amp;">a</td>', '<p style="background:red">a</p>',
      '<p style="behavior:x">a</p>', '<p style="-moz-binding:x">a</p>', '<p style="text-align:center;color:red">a</p>',
      '<p style="width:100vw">a</p>', '<p style="padding:-5px">a</p>', '<p style="margin:1px 2px 3px 4px 5px">a</p>',
      '<p style="font-weight:900px">a</p>', '<p style="border:1px solid red">a</p>', '<p style="text-align">a</p>',
      '<p style="text-align:center !important;position:absolute">a</p>', '<p style="TEXT-ALIGN:expression">a</p>'];
    foreach s in array bad loop
      r := pg_temp.mk(adm, 'ZZ bad', s);
      t_name := t_name || ('D refused: ' || left(regexp_replace(s, '\s+', ' ', 'g'), 60) || case when length(s) > 60 then ' …(' || length(s) || ' chars)' else '' end);
      t_det := t_det || left(r::text, 200);
      t_pass := t_pass || (r->>'sqlstate' = '22023');
    end loop;
    r := pg_temp.mk(adm, 'ZZ styles ok', '<p style="text-align:center;font-weight:bold;font-style:italic;text-decoration:underline;margin:0 auto;padding:4px 8px;width:50%;border:1px solid #000">a</p>'
                                         || '<p style="margin:-4px 0;border:none;width:auto;text-align:left !important">b</p><table><tr><td colspan="2" style="width:120px">c</td></tr></table>', true);
    t_name := t_name || text 'D all 8 allowed style properties with valid values are accepted (dry run)'; t_det := t_det || left(r::text, 160);
    t_pass := t_pass || (r->>'sqlstate' is null and (r->>'dry_run')::boolean);
    r := pg_temp.mk(adm, 'ZZ big ok', '<p>' || repeat('a', 102400 - 7) || '</p>');
    t_name := t_name || text 'D exactly 100 KB is accepted'; t_det := t_det || left(r::text, 120); t_pass := t_pass || (r->>'sqlstate' is null and (r->>'size')::int = 102400);
    foreach s in array array['', '   ', repeat('n', 81), 'bad' || chr(10) || 'name'] loop
      r := pg_temp.mk(adm, s, '<p>a</p>');
      t_name := t_name || ('D refuses name: ' || replace(left(s, 20), chr(10), '\n') || ' (len ' || length(s) || ')'); t_det := t_det || r::text;
      t_pass := t_pass || (r->>'sqlstate' = '22023');
    end loop;
    r := pg_temp.mk(adm, null, '<p>a</p>');
    t_name := t_name || text 'D refuses a missing name'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '22023');
    r := pg_temp.mk(adm, 'ZZ dry bad', '<script>x</script>', true);
    t_name := t_name || text 'D dry run applies the same checks (unsafe HTML refused)'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '22023');
    t_name := t_name || text 'D refused calls wrote nothing (only the accepted 100 KB template was added)'; t_det := t_det || format('%s→%s', n, (select count(*) from public.comm_doc_templates));
    t_pass := t_pass || ((select count(*) from public.comm_doc_templates) = n + 1);

    -- ════ E. list and get ════
    r := pg_temp.call_as(adm, 'select public.comm_doc_template_list(''ZZ offer'', 1, 10)');
    t_name := t_name || text 'E list: search finds it, no HTML in the list rows'; t_det := t_det || left(r::text, 200);
    t_pass := t_pass || (r->>'total' = '1' and r#>>'{rows,0,id}' = tid2::text and not (r->'rows'->0 ? 'html')
                         and r#>'{rows,0,merge_fields}' = '["campus","full_name","today","vsat_id"]'::jsonb);
    r := pg_temp.call_as(adm2, 'select public.comm_doc_template_list(''ZZ offer'', 1, 10)');
    t_name := t_name || text 'E another admin sees it, owner_is_me = false'; t_det := t_det || left(r::text, 160); t_pass := t_pass || (r#>>'{rows,0,owner_is_me}' = 'false');
    r := pg_temp.call_as(adm, 'select public.comm_doc_template_list(''ZZ'', 2, 2)');
    t_name := t_name || text 'E paging: page 2 of size 2 has 2 rows, total 4'; t_det := t_det || left(r::text, 160);
    t_pass := t_pass || (r->>'total' = '4' and jsonb_array_length(r->'rows') = 2);
    r := pg_temp.call_as(adm, 'select public.comm_doc_template_list(''ZZ%'', 1, 10)');
    t_name := t_name || text 'E search treats % literally'; t_det := t_det || (r->>'total'); t_pass := t_pass || (r->>'total' = '0');
    foreach s in array array['select public.comm_doc_template_list(null, 0, 10)', 'select public.comm_doc_template_list(null, 1, 101)',
                             format('select public.comm_doc_template_list(%L, 1, 10)', repeat('s', 101)), 'select public.comm_doc_template_get(null)'] loop
      r := pg_temp.call_as(adm, s);
      t_name := t_name || ('E refuses: ' || left(s, 70)); t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '22023');
    end loop;
    r := pg_temp.call_as(adm, format('select public.comm_doc_template_get(%L::uuid)', tid2));
    t_name := t_name || text 'E get returns the HTML and the fields'; t_det := t_det || left(r::text, 160);
    t_pass := t_pass || (r->>'html' = good and r->>'name' = 'ZZ offer' and (r->>'size')::int = octet_length(good));
    r := pg_temp.call_as(adm, format('select public.comm_doc_template_get(%L::uuid)', gen_random_uuid()));
    t_name := t_name || text 'E get of an unknown id → P0002'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = 'P0002');

    -- ════ F. update ════
    r := pg_temp.call_as(adm, format('select public.comm_doc_template_update(%L::uuid, %L, null)', tid2, '  ZZ offer v2 '));
    t_name := t_name || text 'F update name only: HTML and fields kept'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'name' = 'ZZ offer v2' and r->'merge_fields' = '["campus","full_name","today","vsat_id"]'::jsonb
                         and (select html from public.comm_doc_templates where id = tid2) = good);
    r := pg_temp.call_as(adm, format('select public.comm_doc_template_update(%L::uuid, null, %L)', tid2, '<p>Hi {{first_name}}</p>'));
    t_name := t_name || text 'F update HTML only: fields recomputed by the database'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'name' = 'ZZ offer v2' and r->'merge_fields' = '["first_name"]'::jsonb);
    r := pg_temp.call_as(adm, format('select public.comm_doc_template_update(%L::uuid, null, %L)', tid2, '<p onclick="x">Hi</p>'));
    t_name := t_name || text 'F update with unsafe HTML refused, old HTML kept'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'sqlstate' = '22023' and (select html from public.comm_doc_templates where id = tid2) = '<p>Hi {{first_name}}</p>');
    r := pg_temp.call_as(adm, format('select public.comm_doc_template_update(%L::uuid, %L, null)', tid2, repeat('n', 81)));
    t_name := t_name || text 'F update with a bad name refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '22023');
    r := pg_temp.call_as(adm2, format('select public.comm_doc_template_update(%L::uuid, %L, null)', tid2, 'ZZ edited by admin 2'));
    t_name := t_name || text 'F owner-or-admin: another admin may edit'; t_det := t_det || r::text; t_pass := t_pass || (r->>'name' = 'ZZ edited by admin 2');
    r := pg_temp.call_as(adm, format('select public.comm_doc_template_update(%L::uuid, %L, null)', gen_random_uuid(), 'ZZ x'));
    t_name := t_name || text 'F update of an unknown id → P0002'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = 'P0002');
    r := pg_temp.call_as(adm, format('select public.comm_doc_template_update(null, %L, null)', 'ZZ x'));
    t_name := t_name || text 'F update without an id → 22023'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '22023');

    -- ════ G. soft delete ════
    r := pg_temp.call_as(adm, format('select public.comm_doc_template_delete(%L::uuid)', tid2));
    t_name := t_name || text 'G delete is soft: row kept with deleted_at, gone from list and get'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'deleted' = 'true' and exists (select 1 from public.comm_doc_templates where id = tid2 and deleted_at is not null)
                         and (pg_temp.call_as(adm, 'select public.comm_doc_template_list(''edited by admin 2'', 1, 10)')->>'total') = '0'
                         and (pg_temp.call_as(adm, format('select public.comm_doc_template_get(%L::uuid)', tid2))->>'sqlstate') = 'P0002');
    r := pg_temp.call_as(adm, format('select public.comm_doc_template_delete(%L::uuid)', tid2));
    t_name := t_name || text 'G delete twice → P0002'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = 'P0002');
    r := pg_temp.call_as(adm, format('select public.comm_doc_template_update(%L::uuid, %L, null)', tid2, 'ZZ back'));
    t_name := t_name || text 'G update a deleted template → P0002'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = 'P0002');
    r := pg_temp.call_as(adm, 'select public.comm_doc_template_delete(null)');
    t_name := t_name || text 'G delete without an id → 22023'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '22023');

    -- ════ H. audit ════
    select count(*) into n from public.audit_log where table_name = 'comm_doc_templates' and record_id = tid2::text;
    t_name := t_name || text 'H audit rows for create, updates and delete of one template (existing audit trigger)'; t_det := t_det || n::text;
    t_pass := t_pass || (n = 5);   -- insert + 3 successful updates (name, html, admin 2) + soft delete
    select count(*) into n from public.audit_log where table_name = 'comm_doc_templates' and record_id = tid2::text and actor_id = adm2;
    t_name := t_name || text 'H the audit row records which admin made the change'; t_det := t_det || n::text; t_pass := t_pass || (n = 1);

    -- ════ I. cap: at most 200 live templates ════
    insert into public.comm_doc_templates (name, html, owner_id)
      select 'ZZ cap ' || g, '<p>x</p>', adm from generate_series(1, greatest(0, 200 - (select count(*) from public.comm_doc_templates where deleted_at is null))) g;
    r := pg_temp.mk(adm, 'ZZ over cap', '<p>a</p>');
    t_name := t_name || text 'I the 201st live template is refused (22023)'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '22023');
    r := pg_temp.mk(adm, 'ZZ over cap', '<p>a</p>', true);
    t_name := t_name || text 'I at the cap a dry run still works (it writes nothing)'; t_det := t_det || r::text; t_pass := t_pass || ((r->>'dry_run')::boolean);
    perform pg_temp.call_as(adm, format('select public.comm_doc_template_delete(%L::uuid)', tid));
    r := pg_temp.mk(adm, 'ZZ after delete', '<p>a</p>');
    t_name := t_name || text 'I soft-deleted templates do not count: after one delete a new one fits'; t_det := t_det || left(r::text, 120); t_pass := t_pass || (r->>'id' is not null);

    -- ════ J. nothing else touched ════
    select format('%s/%s/%s', (select count(*) from public.profiles), (select count(*) from public.comm_lists),
                  (select count(*) from public.comms_optouts)) into after_counts;
    t_name := t_name || text 'J profiles / comm_lists / comms_optouts row counts unchanged'; t_det := t_det || (before_counts || ' -> ' || after_counts);
    t_pass := t_pass || (before_counts = after_counts);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select * from pg_temp.run_comm_slice4_tests();
