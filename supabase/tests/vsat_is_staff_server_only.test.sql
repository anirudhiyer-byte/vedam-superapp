-- vsat__is_staff · server only — tests for migration 0183 (STAGING ONLY)
--
-- Paste into the staging SQL editor (or run via the Supabase MCP) in ONE call. The last statement
-- returns one row per test: test | pass | detail. Everything is rolled back at the end (ZDONE).
-- Fake data only (@example.invalid; one fake @vedam.org staff address that never receives mail).

create or replace function pg_temp.sso_user(p_email text, p_role text default null)
returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
    values (u, p_email, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id, email, full_name) values (u, p_email, 'ZZSSO ' || split_part(p_email, '@', 1)) on conflict (id) do nothing;
  if p_role is not null then insert into public.user_roles (user_id, role) values (u, p_role::public.app_role); end if;
  return u;
end $$;

create or replace function pg_temp.sso_call(p_uid uuid, p_sql text, p_anon boolean default false)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  if p_anon then perform set_config('request.jwt.claims', '{"role":"anon"}', true); set local role anon;
  else perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true); set local role authenticated; end if;
  execute p_sql into r; reset role; perform set_config('request.jwt.claims', '', true); return coalesce(r, 'null'::jsonb);
exception when others then reset role; perform set_config('request.jwt.claims', '', true); return jsonb_build_object('sqlstate', sqlstate, 'message', sqlerrm);
end $$;

create or replace function pg_temp.run_is_staff_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  tn text[] := '{}'; tp boolean[] := '{}'; td text[] := '{}';
  staff uuid; adm uuid; stu uuid; r jsonb; s text;
begin
  begin
    if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then raise exception 'not staging'; end if;
    staff := pg_temp.sso_user('zzsso-staff-' || substr(md5(random()::text), 1, 8) || '@vedam.org');
    adm   := pg_temp.sso_user('zzsso-admin@example.invalid', 'admin');
    stu   := pg_temp.sso_user('zzsso-student@example.invalid');

    -- ── A. nobody can call it from a browser ──
    r := pg_temp.sso_call(stu, 'select to_jsonb(public.vsat__is_staff())');
    tn := tn || text 'A a signed-in student cannot call it'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    r := pg_temp.sso_call(staff, 'select to_jsonb(public.vsat__is_staff())');
    tn := tn || text 'A a signed-in staff user cannot call it directly either'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');
    r := pg_temp.sso_call(null, 'select to_jsonb(public.vsat__is_staff())', true);
    tn := tn || text 'A anon cannot call it'; td := td || r::text; tp := tp || (r->>'sqlstate' = '42501');

    -- ── B. the form functions that use it still work (they run as the owner) ──
    r := pg_temp.sso_call(staff, 'select public.vsat_form_active_for_fill()');
    tn := tn || text 'B staff: vsat_form_active_for_fill still answers (no permission error)'; td := td || left(r::text, 200);
    tp := tp || (not (r ? 'sqlstate'));
    r := pg_temp.sso_call(adm, 'select public.vsat_form_active_for_fill()');
    tn := tn || text 'B admin: vsat_form_active_for_fill still answers'; td := td || left(r::text, 200); tp := tp || (not (r ? 'sqlstate'));
    r := pg_temp.sso_call(stu, 'select public.vsat_form_active_for_fill()');
    tn := tn || text 'B student: vsat_form_active_for_fill still answers'; td := td || left(r::text, 200); tp := tp || (not (r ? 'sqlstate'));
    r := pg_temp.sso_call(staff, 'select public.vsat_form_autosave_category(''{}''::jsonb)');
    tn := tn || text 'B staff: autosave reaches its own checks (not a permission error on the helper)'; td := td || left(r::text, 200);
    tp := tp || (coalesce(r->>'message', '') not ilike '%vsat__is_staff%' and coalesce(r->>'sqlstate', '') <> '42501');
    r := pg_temp.sso_call(staff, 'select public.vsat_form_save_category(''{}''::jsonb)');
    tn := tn || text 'B staff: save reaches its own checks (not a permission error on the helper)'; td := td || left(r::text, 200);
    tp := tp || (coalesce(r->>'message', '') not ilike '%vsat__is_staff%' and coalesce(r->>'sqlstate', '') <> '42501');

    -- ── C. the helper itself is unchanged and still right ──
    perform set_config('request.jwt.claims', json_build_object('sub', staff, 'role', 'authenticated')::text, true);
    tn := tn || text 'C as the owner: a @vedam.org user is staff'; s := public.vsat__is_staff()::text; td := td || s; tp := tp || (s = 'true');
    perform set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
    tn := tn || text 'C as the owner: a student is not staff'; s := public.vsat__is_staff()::text; td := td || s; tp := tp || (s = 'false');
    perform set_config('request.jwt.claims', '', true);
    tn := tn || text 'C grants: service_role only, definer, empty search_path';
    select p.proacl::text || ' definer=' || p.prosecdef into s from pg_proc p where p.oid = 'public.vsat__is_staff'::regproc;
    td := td || s;
    tp := tp || (select not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
                        and has_function_privilege('service_role', p.oid, 'execute') and p.prosecdef and p.proconfig = array['search_path=""']
                   from pg_proc p where p.oid = 'public.vsat__is_staff'::regproc);
    tn := tn || text 'C no vsat__ helper is left callable from a browser';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname like 'vsat\_\_%'
       and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'));
    td := td || coalesce(s, 'none'); tp := tp || (s is null);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(tn, tp, td) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_is_staff_tests();
