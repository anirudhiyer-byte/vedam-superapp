-- VSAT grid · Counsellor dropdown + "Counselling Meet" column — tests for migration 0158 (STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the Supabase MCP.
-- The last statement returns one row per test: test | pass | detail.
--
-- Nothing is left behind: all test data is created inside a block that is rolled back with a private
-- error code at the end. Fake data only (@example.invalid, ZZTEST names). Every grid call is limited to the
-- test students (application_ids), so other staging data never changes a count.

create or replace function pg_temp.mk_user(p_email text)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  values (v, p_email, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id, email, full_name) values (v, p_email, 'ZZTEST ' || split_part(p_email, '@', 1))
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
  return v;
end $$;

-- applicant at "counselling_scheduled"
create or replace function pg_temp.mk_app(p_id text, p_campus text)
returns text language plpgsql as $$
declare u uuid := pg_temp.mk_user(lower(p_id) || '@example.invalid'); s text;
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, lead_stage) values (u, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', 'applicant_paid')
  on conflict (lead_id) do nothing;
  insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email, campus_applied)
  values (p_id, u, p_id, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', p_campus);
  foreach s in array array['vsat_cleared', 'interview_scheduled', 'interviewed', 'pi_cleared', 'counselling_scheduled'] loop
    perform public.vsat__move(p_id, s, 'active', 'zz test', 'system', null, null);
  end loop;
  return p_id;
end $$;

create or replace function pg_temp.call_as(p_uid uuid, p_sql text, p_role text default 'authenticated')
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  if p_role = 'anon' then
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

create or replace function pg_temp.rpc(p_fn text, p jsonb)
returns text language sql as $$ select format('select public.%I(%L::jsonb)', p_fn, p::text) $$;

-- the grid as p_who, limited to the test students
create or replace function pg_temp.grid(p_who uuid, p_apps text[], p_extra jsonb default '{}'::jsonb)
returns jsonb language sql as $$
  select pg_temp.call_as(p_who, pg_temp.rpc('vsat_grid_list',
    jsonb_build_object('application_ids', to_jsonb(p_apps), 'columns', jsonb_build_array('counselling_meet', 'counsellor'), 'limit', 50) || p_extra))
$$;

create or replace function pg_temp.ids(r jsonb)
returns text language sql as $$ select coalesce(string_agg(x->>'application_id', ',' order by x->>'application_id'), '') from jsonb_array_elements(r->'rows') x $$;

create or replace function pg_temp.run_vsat_grid_counsellor_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; c1 uuid; c2 uuid; i1 uuid; nobody uuid;
  g1 text; g2 text; g3 text; g4 text; g5 text; g6 text; apps text[];
  r jsonb; s text; many jsonb;
  pune constant text := 'Ajeenkya DY Patil University — Pune';
  ggn constant text := 'Sushant University — Gurugram';
begin
  begin -- rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('zztest-gc-adm@example.invalid');
    c1 := pg_temp.mk_user('zztest-gc-couns1@example.invalid');
    c2 := pg_temp.mk_user('zztest-gc-couns2@example.invalid');
    i1 := pg_temp.mk_user('zztest-gc-int1@example.invalid');
    nobody := pg_temp.mk_user('zztest-gc-nobody@example.invalid');
    insert into public.vsat_team (user_id, role) values (adm, 'admissions'), (c1, 'counsellor'), (c2, 'counsellor'), (i1, 'interviewer');
    g1 := pg_temp.mk_app('ZZT-GC-1', pune);
    g2 := pg_temp.mk_app('ZZT-GC-2', pune);
    g3 := pg_temp.mk_app('ZZT-GC-3', pune);
    g4 := pg_temp.mk_app('ZZT-GC-4', pune);
    g5 := pg_temp.mk_app('ZZT-GC-5', ggn);
    g6 := pg_temp.mk_app('ZZT-GC-6', pune);
    apps := array[g1, g2, g3, g4, g5, g6];
    delete from public.counselling_assignments where application_id = any(apps);
    insert into public.counselling_assignments (application_id, attempt_no, counsellor_id, slot_datetime, meet_mode, meet_sync, zoom_link, cancelled_at) values
      (g1, 1, c1, now() + interval '1 day', 'auto', 'ok', 'https://meet.google.com/aaa-bbbb-ccc', null),
      (g2, 1, c1, now() + interval '1 day 1 hour', 'auto', 'pending', null, null),
      (g3, 1, c2, now() + interval '1 day', 'auto', 'failed', null, null),
      (g4, 1, c2, now() + interval '1 day 1 hour', 'manual', 'none', 'https://zoom.example.invalid/x', null),
      (g5, 1, c1, now() + interval '1 day 2 hours', 'auto', 'ok', null, now());
    delete from public.interview_assignments where application_id = any(apps);
    insert into public.interview_assignments (application_id, attempt_no, interviewer_id) values (g1, 1, i1);

    -- ════ M. the Counselling Meet column ════
    r := pg_temp.grid(adm, apps);
    select string_agg(x->>'application_id' || '=' || coalesce(x->>'counselling_meet', '∅'), ',' order by x->>'application_id') into s from jsonb_array_elements(r->'rows') x;
    t_name := t_name || text 'M Counselling Meet: ready / creating / failed / own link / cancelled / none';
    t_det := t_det || (coalesce(s, r::text));
    t_pass := t_pass || (s = 'ZZT-GC-1=ready,ZZT-GC-2=creating,ZZT-GC-3=failed,ZZT-GC-4=own_link,ZZT-GC-5=cancelled,ZZT-GC-6=∅');

    -- ════ F. the Counsellor dropdown ════
    t_name := t_name || text 'F one counsellor → only their students';
    r := pg_temp.grid(adm, apps, jsonb_build_object('counsellor_ids', jsonb_build_array(c1)));
    t_det := t_det || (format('total=%s %s', r->>'total', pg_temp.ids(r)));
    t_pass := t_pass || (r->>'total' = '3' and pg_temp.ids(r) = 'ZZT-GC-1,ZZT-GC-2,ZZT-GC-5');
    t_name := t_name || text 'F "No counsellor" → students without a counselling row';
    r := pg_temp.grid(adm, apps, jsonb_build_object('counsellor_ids', jsonb_build_array('none')));
    t_det := t_det || (format('total=%s %s', r->>'total', pg_temp.ids(r)));
    t_pass := t_pass || (r->>'total' = '1' and pg_temp.ids(r) = 'ZZT-GC-6');
    t_name := t_name || text 'F several choices add up (counsellor 2 + no counsellor)';
    r := pg_temp.grid(adm, apps, jsonb_build_object('counsellor_ids', jsonb_build_array(c2, 'none')));
    t_det := t_det || (format('total=%s %s', r->>'total', pg_temp.ids(r)));
    t_pass := t_pass || (r->>'total' = '3' and pg_temp.ids(r) = 'ZZT-GC-3,ZZT-GC-4,ZZT-GC-6');

    r := pg_temp.grid(adm, apps);
    t_name := t_name || text 'F counts per counsellor (+ none) and their names';
    t_det := t_det || (format('%s %s', r->'facets'->'counsellor', r->'facets'->'counsellor_name'));
    t_pass := t_pass || ((r->'facets'->'counsellor'->>c1::text) = '3' and (r->'facets'->'counsellor'->>c2::text) = '2'
                         and (r->'facets'->'counsellor'->>'none') = '1'
                         and r->'facets'->'counsellor_name'->>c1::text = 'ZZTEST zztest-gc-couns1'
                         and r->'facets'->'counsellor_name'->>c2::text = 'ZZTEST zztest-gc-couns2');
    r := pg_temp.grid(adm, apps, jsonb_build_object('campuses', jsonb_build_array('gurugram')));
    t_name := t_name || text 'F the counsellor counts follow the other filters (campus Gurugram)';
    t_det := t_det || ((r->'facets'->'counsellor')::text);
    t_pass := t_pass || (r->'facets'->'counsellor' = jsonb_build_object(c1::text, 1));
    r := pg_temp.grid(adm, apps, jsonb_build_object('counsellor_ids', jsonb_build_array(c2)));
    t_name := t_name || text 'F the other counts follow the counsellor choice; the counsellor counts still list every option';
    t_det := t_det || (format('campus=%s counsellor=%s', r->'facets'->'campus', r->'facets'->'counsellor'));
    t_pass := t_pass || (r->'facets'->'campus' = '{"pune": 2}'::jsonb and (r->'facets'->'counsellor'->>c1::text) = '3');
    r := pg_temp.grid(adm, apps, jsonb_build_object('counsellor_ids', jsonb_build_array(c1), 'interviewer_ids', jsonb_build_array(i1)));
    t_name := t_name || text 'F works together with the Interviewer dropdown';
    t_det := t_det || (format('total=%s %s', r->>'total', pg_temp.ids(r)));
    t_pass := t_pass || (r->>'total' = '1' and pg_temp.ids(r) = 'ZZT-GC-1');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_export', jsonb_build_object('purpose', 'csv', 'application_ids', to_jsonb(apps),
           'counsellor_ids', jsonb_build_array(c1), 'columns', jsonb_build_array('registered_name', 'counselling_meet'))));
    t_name := t_name || text 'F CSV export uses the counsellor choice too';
    t_det := t_det || (format('total=%s', coalesce(r->>'total', r::text)));
    t_pass := t_pass || (r->>'total' = '3');

    -- ════ V. bad values are refused ════
    select jsonb_agg(gen_random_uuid()) into many from generate_series(1, 51);
    r := pg_temp.grid(adm, apps, jsonb_build_object('counsellor_ids', jsonb_build_array('x''; drop table x; --')));
    s := r->>'message';
    r := pg_temp.grid(adm, apps, jsonb_build_object('counsellor_ids', 'not-a-list'));
    s := s || ' | ' || (r->>'message');
    r := pg_temp.grid(adm, apps, jsonb_build_object('counsellor_ids', many));
    s := s || ' | ' || (r->>'message');
    t_name := t_name || text 'V not an id / not a list / more than 50 → refused';
    t_det := t_det || (s);
    t_pass := t_pass || (s = 'BAD_VALUE: counsellor_ids | BAD_VALUE: counsellor_ids | BAD_VALUE: counsellor_ids');
    r := pg_temp.grid(adm, apps, jsonb_build_object('counsellor_id', jsonb_build_array(c1)));
    t_name := t_name || text 'V a misspelt key is refused, not ignored';
    t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' like 'UNKNOWN_KEY%');

    -- ════ S. who sees what (unchanged) ════
    r := pg_temp.grid(c1, apps);
    t_name := t_name || text 'S a counsellor sees only their own students, and only themselves in the counts';
    t_det := t_det || (format('%s %s', pg_temp.ids(r), r->'facets'->'counsellor'));
    t_pass := t_pass || (pg_temp.ids(r) = 'ZZT-GC-1,ZZT-GC-2,ZZT-GC-5' and r->'facets'->'counsellor' = jsonb_build_object(c1::text, 3));
    r := pg_temp.grid(c1, apps, jsonb_build_object('counsellor_ids', jsonb_build_array(c2)));
    t_name := t_name || text 'S choosing another counsellor shows a counsellor nothing of theirs';
    t_det := t_det || (format('total=%s', r->>'total')); t_pass := t_pass || (r->>'total' = '0');
    r := pg_temp.grid(nobody, apps);
    t_name := t_name || text 'S no VSAT role → refused'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(null, pg_temp.rpc('vsat_grid_list', jsonb_build_object('application_ids', to_jsonb(apps))), 'anon');
    t_name := t_name || text 'S signed out → refused'; t_det := t_det || (r::text); t_pass := t_pass || (r ? 'sqlstate');
    t_name := t_name || text 'S the grid engine stays private (security definer, empty search_path, no browser role)';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat__grid', 'vsat__grid_catalog')
       and (not p.prosecdef or p.proconfig is distinct from array['search_path=""']
            or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
    t_det := t_det || (coalesce(s, 'ok')); t_pass := t_pass || (s is null);

    -- ════ C. the column list ════
    t_name := t_name || text 'C catalogue: Counselling Meet in the Counselling group, open to every VSAT role, not filterable';
    select string_agg(c.grp || '/' || c.typ || '/' || c.sens || '/' || c.virt, ',') into s from public.vsat__grid_catalog() c where c.key = 'counselling_meet';
    r := pg_temp.call_as(adm, 'select public.vsat_grid_columns()');
    select x into r from jsonb_array_elements(r->'columns') x where x->>'key' = 'counselling_meet';
    t_det := t_det || (format('%s %s', s, r));
    t_pass := t_pass || (s = 'Counselling/text/open/true' and r is not null and coalesce((r->>'filterable')::boolean, false) = false);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_vsat_grid_counsellor_tests();
