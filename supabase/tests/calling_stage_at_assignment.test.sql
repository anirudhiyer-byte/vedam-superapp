-- Calling pool · VSAT stage at assignment + stage now — tests for migration 0181 (STAGING ONLY)
--
-- Paste into the staging SQL editor (or run via the Supabase MCP) in ONE call. The last statement
-- returns one row per test: test | pass | detail. Everything is rolled back at the end (ZDONE).
-- Fake data only (ZZCST names / @example.invalid). Refuses to run unless app_flags.environment = 'staging'.

create or replace function pg_temp.cst_user(p_tag text, p_role text default null)
returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid(); e text := 'zzcst-' || lower(p_tag) || '@example.invalid';
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
    values (u, e, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id, email, full_name) values (u, e, 'ZZCST ' || p_tag) on conflict (id) do nothing;
  if p_role is not null then insert into public.user_roles (user_id, role) values (u, p_role::public.app_role); end if;
  return u;
end $$;

-- an application for the student p_user, moved to p_stage
create or replace function pg_temp.cst_app(p_id text, p_user uuid, p_date uuid, p_stage text)
returns text language plpgsql as $$
declare s text;
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, lead_stage)
    values (p_user, 'ZZCST ' || p_id, lower(p_id) || '@example.invalid', 'applicant_paid') on conflict (lead_id) do nothing;
  insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email, campus_applied, exam_date_id,
    class10_year, class10_percentage, class10_maths_percentage, class12_year, class12_percentage, class12_maths_percentage,
    marks_physics_12, marks_chemistry_12, marks_maths_12, exam_percentile, exam_obtained_marks, exam_max_marks, vps_score)
  values (p_id, p_user, p_id, 'ZZCST ' || p_id, lower(p_id) || '@example.invalid', 'Ajeenkya DY Patil University — Pune', p_date,
    2024, 90, 85, 2026, 80, 70, 70, 70, 70, 80, 40, 50, 8.43);
  update public.application_manager set exam_given = true where application_id = p_id;
  foreach s in array array['vsat_cleared', 'interview_scheduled', 'interviewed', 'pi_cleared'] loop
    perform public.vsat__move(p_id, s, 'active', 'zz test', 'system', null, null);
    exit when s = p_stage;
  end loop;
  return p_id;
end $$;

create or replace function pg_temp.cst_call(p_uid uuid, p_sql text, p_anon boolean default false)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  if p_anon then perform set_config('request.jwt.claims', '{"role":"anon"}', true); set local role anon;
  else perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); set local role authenticated; end if;
  execute p_sql into r; reset role; perform set_config('request.jwt.claims', '', true); return coalesce(r, 'null'::jsonb);
exception when others then reset role; perform set_config('request.jwt.claims', '', true); return jsonb_build_object('sqlstate', sqlstate, 'message', sqlerrm);
end $$;

create or replace function pg_temp.cst_rpc(p_fn text, p jsonb)
returns text language sql as $$ select format('select public.%I(%L::jsonb)', p_fn, p::text) $$;

create or replace function pg_temp.cst_snap(p_lead uuid)
returns text language sql as $$ select coalesce(stage_at_assignment, '∅') from public.calling_leads where id = p_lead $$;

-- the admin list row for one lead, picked by its exact name (name search is a contains-match, so pick the exact one)
create or replace function pg_temp.cst_row(p_adm uuid, p_name text)
returns jsonb language sql as $$
  select x from jsonb_array_elements(
    pg_temp.cst_call(p_adm, pg_temp.cst_rpc('calling_admin_list', jsonb_build_object('search', p_name, 'limit', 500)))->'rows') x
   where x->>'name' = p_name
$$;

create or replace function pg_temp.run_calling_stage_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  tn text[] := '{}'; tp boolean[] := '{}'; td text[] := '{}';
  adm uuid; cA uuid; cB uuid; usr uuid; stu1 uuid; stu2 uuid; d uuid;
  l_app uuid; l_noapp uuid; l_unreg uuid; r jsonb; s text;
begin
  begin
    if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then raise exception 'not staging'; end if;

    adm := pg_temp.cst_user('admin', 'admin');
    cA  := pg_temp.cst_user('callerA', 'caller');
    cB  := pg_temp.cst_user('callerB', 'caller');
    usr := pg_temp.cst_user('plain');
    stu1 := pg_temp.cst_user('stu1');   -- has an application (VSAT cleared)
    stu2 := pg_temp.cst_user('stu2');   -- registered, no application
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at)
      values ('ZZCST batch', 'zz-cst', current_date, now(), now() + interval '2 hours') returning id into d;
    perform pg_temp.cst_app('ZZCST-APP-1', stu1, d, 'vsat_cleared');
    insert into public.calling_leads (name, phone, source) values ('ZZCST Lead App', '919100000001', 'manual') returning id into l_app;
    insert into public.calling_leads (name, phone, source) values ('ZZCST Lead NoApp', '919100000002', 'manual') returning id into l_noapp;
    insert into public.calling_leads (name, phone, source) values ('ZZCST Lead Unreg', '919100000003', 'manual') returning id into l_unreg;
    update public.calling_leads set linked_profile_id = stu1 where id = l_app;
    update public.calling_leads set linked_profile_id = stu2 where id = l_noapp;

    -- ── A. the helper ──
    tn := tn || text 'A helper: no linked profile → not_registered';
    s := public.calling__vsat_stage(null); td := td || s; tp := tp || (s = 'not_registered');
    tn := tn || text 'A helper: registered without an application → no_application';
    s := public.calling__vsat_stage(stu2); td := td || s; tp := tp || (s = 'no_application');
    tn := tn || text 'A helper: with an application → its VSAT stage';
    s := public.calling__vsat_stage(stu1); td := td || s; tp := tp || (s = 'vsat_cleared');

    -- ── B. assigning takes the snapshot ──
    r := pg_temp.cst_call(adm, pg_temp.cst_rpc('calling_assign', jsonb_build_object('ids', jsonb_build_array(l_app, l_noapp, l_unreg), 'assignee', cA)));
    tn := tn || text 'B assign 3 leads to caller A'; td := td || r::text; tp := tp || (r->>'ok' = 'true' and (r->>'updated')::int = 3);
    tn := tn || text 'B snapshot per lead: vsat_cleared / no_application / not_registered';
    s := pg_temp.cst_snap(l_app) || ' / ' || pg_temp.cst_snap(l_noapp) || ' / ' || pg_temp.cst_snap(l_unreg);
    td := td || s; tp := tp || (s = 'vsat_cleared / no_application / not_registered');

    -- ── C. the student moves on: snapshot stays, the list shows where they are now ──
    perform public.vsat__move('ZZCST-APP-1', 'interview_scheduled', 'active', 'zz test', 'system', null, null);
    r := pg_temp.cst_row(adm, 'ZZCST Lead App');
    tn := tn || text 'C admin list: stage now = interview_scheduled, at assignment = vsat_cleared';
    td := td || coalesce(r::text, '∅');
    tp := tp || (r->>'vsat_stage' = 'interview_scheduled' and r->>'stage_at_assignment' = 'vsat_cleared');
    r := pg_temp.cst_row(adm, 'ZZCST Lead Unreg');
    tn := tn || text 'C admin list: an unlinked lead shows not_registered';
    td := td || coalesce(r::text, '∅'); tp := tp || (r->>'vsat_stage' = 'not_registered' and r->>'stage_at_assignment' = 'not_registered');
    r := pg_temp.cst_call(adm, pg_temp.cst_rpc('calling_admin_list', jsonb_build_object('search', 'ZZCST Lead', 'limit', 1)));
    tn := tn || text 'C admin list: paging unchanged (limit 1 → 1 row, total 3), old fields still there';
    td := td || left(r::text, 300);
    tp := tp || (jsonb_array_length(r->'rows') = 1 and (r->>'total')::int = 3 and r->'rows'->0 ? 'vsat_stage'
                 and r->'rows'->0 ? 'assignee_email' and r->'rows'->0 ? 'call_status' and not (r->'rows'->0 ? 'tot'));

    -- ── D. re-assignment = fresh snapshot; unassign clears it ──
    r := pg_temp.cst_call(adm, pg_temp.cst_rpc('calling_assign', jsonb_build_object('ids', jsonb_build_array(l_app), 'assignee', cB)));
    tn := tn || text 'D re-assign to caller B: fresh snapshot (interview_scheduled)';
    s := pg_temp.cst_snap(l_app); td := td || (r::text || ' ' || s); tp := tp || (s = 'interview_scheduled');
    r := pg_temp.cst_call(adm, pg_temp.cst_rpc('calling_assign', jsonb_build_object('ids', jsonb_build_array(l_noapp), 'assignee', '')));
    tn := tn || text 'D unassign: snapshot cleared, assignee cleared';
    td := td || (r::text || ' ' || pg_temp.cst_snap(l_noapp));
    tp := tp || (pg_temp.cst_snap(l_noapp) = '∅' and (select assigned_to from public.calling_leads where id = l_noapp) is null);

    -- ── E. refusals change nothing ──
    r := pg_temp.cst_call(adm, pg_temp.cst_rpc('calling_assign', jsonb_build_object('ids', jsonb_build_array(l_unreg), 'assignee', usr)));
    tn := tn || text 'E assignee who is not a caller: refused, snapshot kept';
    td := td || r::text; tp := tp || (r->>'error' = 'assignee_not_caller' and pg_temp.cst_snap(l_unreg) = 'not_registered');
    r := pg_temp.cst_call(cA, pg_temp.cst_rpc('calling_assign', jsonb_build_object('ids', jsonb_build_array(l_unreg), 'assignee', cA)));
    tn := tn || text 'E a caller cannot assign'; td := td || r::text; tp := tp || (r->>'message' = 'forbidden');
    r := pg_temp.cst_call(usr, pg_temp.cst_rpc('calling_admin_list', '{}'::jsonb));
    tn := tn || text 'E a non-admin cannot list'; td := td || r::text; tp := tp || (r->>'message' = 'forbidden');
    r := pg_temp.cst_call(null, pg_temp.cst_rpc('calling_admin_list', '{}'::jsonb), true);
    tn := tn || text 'E anon cannot list'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');

    -- ── F. the caller console is untouched ──
    r := pg_temp.cst_call(cA, pg_temp.cst_rpc('calling_my_queue', '{}'::jsonb));
    tn := tn || text 'F caller queue: same shape as before (no stage fields added)';
    td := td || left(r::text, 300);
    tp := tp || ((r->>'total')::int = 1 and not (r->'rows'->0 ? 'stage_at_assignment') and not (r->'rows'->0 ? 'vsat_stage'));

    -- ── G. grants ──
    tn := tn || text 'G helper: server only, definer, empty search_path';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'calling__vsat_stage'
       and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')
            or not has_function_privilege('service_role', p.oid, 'execute') or not p.prosecdef or p.proconfig is distinct from array['search_path=""']);
    td := td || coalesce(s, 'ok'); tp := tp || (s is null and exists (select 1 from pg_proc where proname = 'calling__vsat_stage'));
    tn := tn || text 'G assign + list: signed-in only (the role check is inside), definer, empty search_path';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('calling_assign', 'calling_admin_list')
       and not (has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
                and p.prosecdef and p.proconfig = array['search_path=""']);
    td := td || coalesce(s, 'ok'); tp := tp || (s is null);
    tn := tn || text 'G calling_leads: RLS on, no browser table access';
    td := td || (select relrowsecurity::text from pg_class where oid = 'public.calling_leads'::regclass);
    tp := tp || ((select relrowsecurity from pg_class where oid = 'public.calling_leads'::regclass)
                 and not has_table_privilege('authenticated', 'public.calling_leads', 'select')
                 and not has_table_privilege('anon', 'public.calling_leads', 'select'));

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(tn, tp, td) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_calling_stage_tests();
