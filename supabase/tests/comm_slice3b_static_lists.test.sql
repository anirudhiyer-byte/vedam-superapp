-- Communication Manager · Slice 3b (static lists from a CSV upload) · database tests for migration 0065
--
-- How to run (STAGING ONLY): paste this whole file into the staging SQL editor, or run it through the
-- Supabase MCP / psql. The last statement returns one row per test: test | pass | detail.
-- Refuses to run unless app_flags.environment = 'staging'.
--
-- Nothing is left behind: all test data is created inside a block that is rolled back with a private
-- error code at the end. Fake data only (@example.invalid e-mails, 90000003xx numbers, ZZ names).
-- No big inserts here: the 5000-row volume run is done on a local Postgres, not on staging.

do $$ begin
  if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
    raise exception 'not the staging database - refusing to run tests';
  end if;
end $$;

-- ── helpers (session-temporary) ────────────────────────────────────────────────
create or replace function pg_temp.mk_user(p_email text, p_phone text default null, p_consent boolean default false)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  values (v, coalesce(nullif(btrim(p_email), ''), 'zz-3b-noemail-' || substr(v::text, 1, 8) || '@example.invalid'),
          'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id) values (v) on conflict (id) do nothing;
  update public.profiles set email = p_email, phone = p_phone, consent_given = coalesce(p_consent, false) where id = v;
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

create or replace function pg_temp.imp(p_uid uuid, p_name text, p_ids jsonb, p_dry boolean)
returns jsonb language sql as $$
  select pg_temp.call_as(p_uid, format('select public.comm_list_import(%L, %L::jsonb, %L)', p_name, p_ids, p_dry));
$$;

-- ── the tests ──────────────────────────────────────────────────────────────────
create or replace function pg_temp.run_comm_slice3b_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; usr uuid; p1 uuid; p2 uuid; p3 uuid; p4 uuid;
  r jsonb; r2 jsonb; s text; f text; n bigint; n2 bigint; ok boolean; lid uuid; lid2 uuid; dyn uuid;
  ids jsonb; before_counts text; after_counts text; lists_before bigint; members_before bigint; audit_before bigint;
  bad text[]; i int;
begin
  begin -- everything below is rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('zz-3b-admin@example.invalid'); perform pg_temp.mk_admin(adm);
    usr := pg_temp.mk_user('zz-3b-user@example.invalid');
    p1 := pg_temp.mk_user('zz-3b-p1@example.invalid', '9000000301', true);
    p2 := pg_temp.mk_user(null, '+91 90000 00302', false);
    p3 := pg_temp.mk_user('ZZ-3b-P3@Example.invalid ', null, true);
    p4 := pg_temp.mk_user('zz-3b-p4@example.invalid', '919000000304', false);   -- in VSAT but not in the CSV

    -- the CSV, as the browser sends it (phone "p" / e-mail "e" only)
    ids := jsonb_build_array(
      jsonb_build_object('p', '+91 90000 00301'),                              -- 1 matched (P1 by phone)
      jsonb_build_object('e', '  zz-3B-p3@example.INVALID'),                    -- 2 matched (P3 by e-mail, both sides cleaned)
      jsonb_build_object('p', '09000000302', 'e', 'zz-3b-nobody1@example.invalid'), -- 3 matched (P2 by phone)
      jsonb_build_object('p', '919000000301'),                                 -- 4 duplicate of row 1 (same phone)
      jsonb_build_object('e', 'zz-3b-p1@example.invalid'),                      -- 5 matched (P1 again, by e-mail) → still 1 member
      jsonb_build_object('p', '9000000399'),                                   -- 6 valid, unmatched
      jsonb_build_object('e', 'zz-3b-nobody2@example.invalid'),                 -- 7 valid, unmatched
      jsonb_build_object('p', '12345', 'e', 'not-an-email'),                    -- 8 invalid
      '{}'::jsonb,                                                             -- 9 invalid (empty row)
      jsonb_build_object('p', '=cmd|calc', 'e', '=HYPERLINK("x")'),             -- 10 invalid (formula-like cells)
      jsonb_build_object('e', 'ZZ-3B-NOBODY2@example.invalid'));                -- 11 duplicate of row 7

    select format('%s/%s/%s', (select count(*) from public.profiles), (select count(*) from public.lead_manager),
                  (select count(*) from public.vsat_registrations)) into before_counts;
    select count(*) into lists_before from public.comm_lists;
    select count(*) into members_before from public.comm_list_members;
    select count(*) into audit_before from public.audit_log;

    -- ════ A. who may call ════
    foreach s in array array[
      format('select public.comm_list_import(%L, %L::jsonb, true)', 'ZZ 3b', ids),
      format('select public.comm_list_import(%L, %L::jsonb, false)', 'ZZ 3b', ids),
      format('select public.comm_list_count(%L::uuid)', gen_random_uuid())] loop
      f := substring(s from 'public\.(comm_[a-z_]+)') || case when s like '%, true)' then ' (preview)' when s like '%, false)' then ' (save)' else '' end;
      r := pg_temp.call_as(null, s, true);
      t_name := t_name || ('A anon refused: ' || f); t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(null, s);
      t_name := t_name || ('A logged in without user id refused: ' || f); t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(usr, s);
      t_name := t_name || ('A non-admin refused: ' || f); t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    end loop;
    t_name := t_name || text 'A refused callers wrote nothing (no list, no member, no audit row)';
    t_det := t_det || format('lists %s→%s members %s→%s', lists_before, (select count(*) from public.comm_lists), members_before, (select count(*) from public.comm_list_members));
    t_pass := t_pass || ((select count(*) from public.comm_lists) = lists_before and (select count(*) from public.comm_list_members) = members_before
                         and (select count(*) from public.audit_log) = audit_before);

    -- ════ B. grants, table, constraints ════
    for f, ok in
      select p.oid::regprocedure::text,
             p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') = 'search_path=""'
               and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
        from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname in ('comm_list_import', 'comm_list_count')
    loop
      t_name := t_name || ('B page function: definer, search_path '''', authenticated yes, anon no: ' || f); t_det := t_det || ok::text; t_pass := t_pass || ok;
    end loop;
    select not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
           and not p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') = 'search_path=""'
      into ok from pg_proc p where p.oid = 'public.comm__list_members_on_delete()'::regprocedure;
    t_name := t_name || text 'B trigger helper comm__list_members_on_delete: not callable by anon/authenticated, not definer'; t_det := t_det || ok::text; t_pass := t_pass || ok;
    select c.relrowsecurity and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'comm_list_members')
           and not exists (select 1 from unnest(array['anon', 'authenticated']) ro, unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) pr
                            where has_table_privilege(ro, c.oid, pr))
      into ok from pg_class c where c.oid = 'public.comm_list_members'::regclass;
    t_name := t_name || text 'B comm_list_members: RLS on, no policies, no privilege at all for anon/authenticated'; t_det := t_det || ok::text; t_pass := t_pass || ok;
    select string_agg(column_name, ',' order by ordinal_position) into s from information_schema.columns where table_schema = 'public' and table_name = 'comm_list_members';
    t_name := t_name || text 'B comm_list_members holds user ids only (list_id, user_id)'; t_det := t_det || s; t_pass := t_pass || (s = 'list_id,user_id');
    select string_agg(pg_get_constraintdef(oid), ' | ') into s from pg_constraint where conrelid = 'public.comm_list_members'::regclass and contype = 'f';
    t_name := t_name || text 'B the only FK is list_id → comm_lists ON DELETE CASCADE (no FK to existing tables)'; t_det := t_det || coalesce(s, 'none');
    t_pass := t_pass || (s = 'FOREIGN KEY (list_id) REFERENCES comm_lists(id) ON DELETE CASCADE');
    select not exists (select 1 from pg_trigger t where t.tgrelid = 'public.comm_list_members'::regclass and not t.tgisinternal) into ok;
    t_name := t_name || text 'B comm_list_members has no audit (or any other) trigger: no per-member audit rows'; t_det := t_det || ok::text; t_pass := t_pass || ok;
    r := pg_temp.call_as(adm, 'select to_jsonb(x) from (select * from public.comm_list_members limit 1) x');
    t_name := t_name || text 'B even an admin cannot read comm_list_members directly'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    select pg_get_constraintdef(oid) into s from pg_constraint where conrelid = 'public.comm_lists'::regclass and conname = 'comm_lists_kind_check';
    t_name := t_name || text 'B comm_lists kind check now allows dynamic and static'; t_det := t_det || s;
    t_pass := t_pass || (s like '%dynamic%' and s like '%static%');
    begin
      insert into public.comm_lists (name, kind, conditions, owner_id) values ('ZZ bad kind', 'other', '{}', adm);
      ok := false;
    exception when check_violation then ok := true;
    end;
    t_name := t_name || text 'B comm_lists still refuses any other kind'; t_det := t_det || ok::text; t_pass := t_pass || ok;

    -- ════ C. preview (dry run): counts only, nothing written ════
    r := pg_temp.imp(adm, null, ids, true);
    t_name := t_name || text 'C preview counts: rows 11, invalid 3, duplicate 2, matched 4, unmatched 2, members 3';
    t_det := t_det || (r - 'sample')::text;
    t_pass := t_pass || (r->>'rows' = '11' and r->>'invalid' = '3' and r->>'duplicate' = '2' and r->>'matched' = '4'
                         and r->>'unmatched' = '2' and r->>'members' = '3' and r->>'id' is null and (r->>'dry_run')::boolean);
    t_name := t_name || text 'C preview: consent and contact counts come from the live profiles (consented 2, with phone 2, with e-mail 2)';
    t_det := t_det || (r - 'sample')::text;
    t_pass := t_pass || (r->>'consented' = '2' and r->>'with_phone' = '2' and r->>'with_email' = '2');
    t_name := t_name || text 'C preview wrote nothing (no list, no member, no audit row)';
    t_det := t_det || format('lists %s→%s, members %s→%s, audit %s→%s', lists_before, (select count(*) from public.comm_lists), members_before,
                              (select count(*) from public.comm_list_members), audit_before, (select count(*) from public.audit_log));
    t_pass := t_pass || ((select count(*) from public.comm_lists) = lists_before and (select count(*) from public.comm_list_members) = members_before
                         and (select count(*) from public.audit_log) = audit_before);
    t_name := t_name || text 'C sample: 3 masked rows, keys phone/email/consent only, never a full phone or e-mail';
    t_det := t_det || (r->'sample')::text;
    t_pass := t_pass || (jsonb_array_length(r->'sample') = 3
      and not exists (select 1 from jsonb_array_elements(r->'sample') x, jsonb_object_keys(x) k where k not in ('phone', 'email', 'consent'))
      and (r->'sample')::text !~ '[0-9]{3}' and (r->'sample')::text !~* 'example|@[a-z]');
    t_name := t_name || text 'C the whole answer holds no contact (no 8+ digit number, no e-mail)'; t_det := t_det || left(r::text, 160);
    t_pass := t_pass || (r::text !~ '[0-9]{8}' and r::text !~ '[a-z0-9]@[a-z]');
    r := pg_temp.imp(adm, null, jsonb_build_array(jsonb_build_object('p', '9000000401'), jsonb_build_object('e', 'zz-3b-none@example.invalid')), true);
    t_name := t_name || text 'C preview with no match at all: matched 0, members 0, empty sample'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'matched' = '0' and r->>'members' = '0' and r->>'unmatched' = '2' and r->'sample' = '[]'::jsonb);

    -- ════ D. save: user ids only ════
    select count(*) into audit_before from public.audit_log;
    r := pg_temp.imp(adm, '  ZZ 3b static  ', ids, false);
    t_name := t_name || text 'D save adds exactly 2 audit rows: 1 import summary + 1 comm_lists insert (existing trigger); 0 for comm_list_members';
    t_det := t_det || format('added %s (summary %s, comm_lists %s, members %s)', (select count(*) from public.audit_log) - audit_before,
                              (select count(*) from public.audit_log where action = 'comm_list_import' and record_id = r->>'id'),
                              (select count(*) from public.audit_log where table_name = 'comm_lists' and record_id = r->>'id'),
                              (select count(*) from public.audit_log where table_name = 'comm_list_members'));
    t_pass := t_pass || ((select count(*) from public.audit_log) - audit_before = 2
                         and (select count(*) from public.audit_log where action = 'comm_list_import' and record_id = r->>'id') = 1
                         and (select count(*) from public.audit_log where table_name = 'comm_lists' and record_id = r->>'id' and action = 'INSERT') = 1
                         and not exists (select 1 from public.audit_log where table_name = 'comm_list_members'));
    t_name := t_name || text 'D save: same counts as the preview, a list id, name trimmed, kind static'; t_det := t_det || (r - 'sample')::text;
    t_pass := t_pass || (r->>'members' = '3' and r->>'matched' = '4' and r->>'id' is not null and r->>'name' = 'ZZ 3b static' and r->>'kind' = 'static'
                         and not (r->>'dry_run')::boolean);
    lid := (r->>'id')::uuid;
    select array_agg(user_id order by user_id)::text into s from public.comm_list_members where list_id = lid;
    t_name := t_name || text 'D members = exactly P1, P2, P3 (matched user ids, P4 not in the CSV is not added)'; t_det := t_det || s;
    t_pass := t_pass || (s = (select array_agg(x order by x)::text from unnest(array[p1, p2, p3]) x));
    select to_jsonb(l)::text into s from public.comm_lists l where l.id = lid;
    t_name := t_name || text 'D the list row stores no contact (conditions {}, owner = admin)'; t_det := t_det || s;
    t_pass := t_pass || ((select conditions from public.comm_lists where id = lid) = '{}'::jsonb and (select owner_id from public.comm_lists where id = lid) = adm
                         and s !~ '[0-9]{8}' and s !~ '[a-z0-9]@[a-z]');
    select count(*) into n from public.audit_log a
     where a.created_at >= now() - interval '1 minute' and a.new_data::text ~* 'zz-3b-nobody|9000000399|not-an-email|HYPERLINK|=cmd';
    t_name := t_name || text 'D unmatched / invalid / duplicate rows are stored nowhere (not in lists, members or audit_log)'; t_det := t_det || n::text;
    t_pass := t_pass || (n = 0 and not exists (select 1 from public.comm_lists l where to_jsonb(l)::text ~* 'nobody|9000000399'));
    r := pg_temp.call_as(adm, 'select public.comm_lists_list(''ZZ 3b static'', 1, 10)');
    t_name := t_name || text 'D the saved list shows in Manage List with kind static'; t_det := t_det || left(r::text, 160);
    t_pass := t_pass || (r->>'total' = '1' and r#>>'{rows,0,kind}' = 'static');

    -- ════ E. live count (comm_list_count) ════
    r := pg_temp.call_as(adm, format('select public.comm_list_count(%L::uuid)', lid));
    t_name := t_name || text 'E count of the static list: total 3, consented 2, kind static, masked sample'; t_det := t_det || (r - 'sample')::text;
    t_pass := t_pass || (r->>'kind' = 'static' and r->>'total' = '3' and r->>'consented' = '2' and jsonb_array_length(r->'sample') = 3
                         and (r->'sample')::text !~ '[0-9]{3}');
    update public.profiles set consent_given = false where id = p3;
    update public.profiles set phone = null where id = p1;
    r := pg_temp.call_as(adm, format('select public.comm_list_count(%L::uuid)', lid));
    t_name := t_name || text 'E counts follow the live profiles (P3 withdrew consent → consented 1; P1 lost the phone → with phone 1)'; t_det := t_det || (r - 'sample')::text;
    t_pass := t_pass || (r->>'total' = '3' and r->>'consented' = '1' and r->>'with_phone' = '1');
    r := pg_temp.call_as(adm, format('select public.comm_list_create(%L, %L::jsonb)', 'ZZ 3b dynamic', '{"consent_given":true}'));
    dyn := (r->>'id')::uuid;
    r := pg_temp.call_as(adm, format('select public.comm_list_count(%L::uuid)', dyn));
    r2 := pg_temp.call_as(adm, 'select public.comm_audience_preview(''{"consent_given":true}''::jsonb)');
    t_name := t_name || text 'E count of a dynamic list = comm_audience_preview of its filters'; t_det := t_det || ((r - 'sample')::text || ' vs ' || (r2 - 'sample')::text);
    t_pass := t_pass || (r->>'kind' = 'dynamic' and (r - 'kind') = r2);
    r := pg_temp.call_as(adm, format('select public.comm_list_count(%L::uuid)', gen_random_uuid()));
    t_name := t_name || text 'E count of an unknown list → P0002'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = 'P0002');
    r := pg_temp.call_as(adm, 'select public.comm_list_count(null)');
    t_name := t_name || text 'E count without an id → 22023'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '22023');

    -- ════ F. delete: members go with the list ════
    r := pg_temp.call_as(adm, format('select public.comm_list_delete(%L::uuid)', lid));
    t_name := t_name || text 'F soft delete (comm_list_delete, unchanged): members removed too'; t_det := t_det || (r::text || ' members left ' || (select count(*) from public.comm_list_members where list_id = lid));
    t_pass := t_pass || (r->>'deleted' = 'true' and not exists (select 1 from public.comm_list_members where list_id = lid));
    r := pg_temp.call_as(adm, format('select public.comm_list_count(%L::uuid)', lid));
    t_name := t_name || text 'F count of a deleted list → P0002'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = 'P0002');
    select count(*) into n from public.audit_log where table_name = 'comm_list_members';
    t_name := t_name || text 'F removing members (soft delete) writes no per-member audit rows'; t_det := t_det || n::text; t_pass := t_pass || (n = 0);
    r := pg_temp.imp(adm, 'ZZ 3b second', ids, false);
    lid2 := (r->>'id')::uuid;
    delete from public.comm_lists where id = lid2;
    t_name := t_name || text 'F hard delete of a list cascades to its members'; t_det := t_det || (select count(*) from public.comm_list_members where list_id = lid2)::text;
    t_pass := t_pass || not exists (select 1 from public.comm_list_members where list_id = lid2);

    -- ════ G. audit ════
    select count(*) into n from public.audit_log
     where action = 'comm_list_import' and actor_id = adm and record_id = lid::text
       and new_data = '{"rows":11,"invalid":3,"duplicate":2,"matched":4,"unmatched":2,"members":3}'::jsonb;
    t_name := t_name || text 'G save writes one audit row: who, the list id, counts only (no contact)'; t_det := t_det || n::text; t_pass := t_pass || (n = 1);
    select count(*) into n from public.audit_log where table_name = 'comm_lists' and action = 'INSERT' and record_id = lid::text and actor_id = adm;
    t_name := t_name || text 'G the existing comm_lists audit trigger logged the new list'; t_det := t_det || n::text; t_pass := t_pass || (n = 1);

    -- ════ H. limits and bad input → 22023, nothing written ════
    select count(*) into n from public.comm_lists;
    bad := array['[]', '{}', '"x"', '[1]', '["a@example.invalid"]', '[{"p":"9000000301","name":"x"}]', '[{"p":9000000301}]', '[{"e":true}]',
                 '[{"p":"' || repeat('9', 65) || '"}]', '[{"e":"' || repeat('a', 250) || '@x.in"}]'];
    foreach s in array bad loop
      r := pg_temp.imp(adm, 'ZZ 3b bad', s::jsonb, true);
      t_name := t_name || ('H refuses identifiers: ' || left(s, 60)); t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '22023');
    end loop;
    r := pg_temp.imp(adm, 'ZZ 3b bad', null, true);
    t_name := t_name || text 'H refuses missing identifiers'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '22023');
    r := pg_temp.imp(adm, 'ZZ 3b big', (select jsonb_agg(jsonb_build_object('p', '90000' || lpad(g::text, 5, '0'))) from generate_series(1, 5001) g), true);
    t_name := t_name || text 'H refuses 5001 rows'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '22023');
    r := pg_temp.imp(adm, 'ZZ 3b big', (select jsonb_agg(jsonb_build_object('p', '90000' || lpad(g::text, 5, '0'))) from generate_series(1, 5000) g), true);
    t_name := t_name || text 'H accepts exactly 5000 rows (preview, nothing written)'; t_det := t_det || (r - 'sample')::text;
    t_pass := t_pass || (r->>'rows' = '5000' and r->>'sqlstate' is null);
    foreach s in array array['', '   ', repeat('n', 81), 'bad' || chr(10) || 'name'] loop
      r := pg_temp.imp(adm, s, ids, false);
      t_name := t_name || ('H save refuses name: ' || replace(left(s, 20), chr(10), '\n') || ' (len ' || length(s) || ')'); t_det := t_det || r::text;
      t_pass := t_pass || (r->>'sqlstate' = '22023');
    end loop;
    r := pg_temp.imp(adm, 'ZZ 3b nobody', jsonb_build_array(jsonb_build_object('p', '9000000401')), false);
    t_name := t_name || text 'H save with no match is refused (no empty list)'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '22023');
    t_name := t_name || text 'H refused calls wrote no list'; t_det := t_det || format('%s→%s', n, (select count(*) from public.comm_lists));
    t_pass := t_pass || ((select count(*) from public.comm_lists) = n);
    insert into public.comm_lists (name, kind, conditions, owner_id)
      select 'ZZ 3b cap ' || g, 'dynamic', '{}', adm from generate_series(1, greatest(0, 500 - (select count(*) from public.comm_lists where deleted_at is null))) g;
    r := pg_temp.imp(adm, 'ZZ 3b over cap', ids, false);
    t_name := t_name || text 'H the 500-list cap applies to static lists too'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '22023');
    r := pg_temp.imp(adm, null, ids, true);
    t_name := t_name || text 'H at the cap a preview still works (it writes nothing)'; t_det := t_det || (r - 'sample')::text; t_pass := t_pass || (r->>'members' = '3');

    -- ════ J. nothing else touched ════
    select format('%s/%s/%s', (select count(*) from public.profiles), (select count(*) from public.lead_manager),
                  (select count(*) from public.vsat_registrations)) into after_counts;
    t_name := t_name || text 'J profiles / lead_manager / vsat_registrations row counts unchanged'; t_det := t_det || (before_counts || ' -> ' || after_counts);
    t_pass := t_pass || (before_counts = after_counts);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select * from pg_temp.run_comm_slice3b_tests();
