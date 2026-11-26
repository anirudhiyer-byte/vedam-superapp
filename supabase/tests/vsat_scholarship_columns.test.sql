-- VSAT Counselling table · sir's three scholarship columns — tests for migration 0192 (STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the Supabase MCP.
-- The last statement returns one row per test: test | pass | detail.
--
-- A. the three columns are in the column list (Counselling, number, filterable)
-- B. for every student at PI cleared or later, the three values follow sir's sheet, worked out here on their own:
--    "Scholarship as Per Weightage" = the engine's bucket % (auto_step), "Scholarship as Per JEE Mains" = the JEE slab
--    (90 / 93 / 95 / 97 / 98.5 → 30 / 40 / 50 / 60 / 70) when the JEE percentile is 90 or more, else the weightage %, and
--    "Max Scholarship" = the higher of the two (JEE only where the campus uses the JEE floor) +10 when achievements = 5 and
--    that is 30 % or less, at most 100. Uses the staging students, which include students with a JEE slab and with the +10.
-- C. the Counselling table returns them (an admin asking for the three columns) and a filter on them works
-- D. a student with missing data gets none (no error); the helper is closed to browsers
--
-- Nothing is left behind: the test admin and anything the table call logs are made inside a block that is rolled back at
-- the end with a private error code. Fake data only (@example.invalid, ZZTEST names).

create or replace function pg_temp.call_as(p_uid uuid, p_sql text)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute p_sql into r;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return coalesce(r, 'null'::jsonb);
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('sqlstate', sqlstate, 'message', sqlerrm);
end $$;

create or replace function pg_temp.run_vsat_scholarship_columns_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  s text; ok boolean; n int; m int; ex int; adm uuid; r jsonb; r2 jsonb;
  later jsonb := '["pi_cleared","counselling_scheduled","counselled","counselling_not_appeared","offer_sent","enrolled","offer_lapsed","offer_cancelled"]';
begin
  begin -- rolled back at the end (ZDONE)
    -- ── A ──
    t_name := t_name || text 'A the three columns are in the column list: Counselling, number, filterable';
    select string_agg(c.key || ':' || c.grp || ':' || c.typ || ':' || c.virt || ':' || (public.vsat__grid_virt_expr(c.key) is not null), ',' order by c.key)
      into s from public.vsat__grid_catalog() c where c.key in ('cs_weightage_pct', 'cs_jee_pct', 'cs_max_pct');
    t_det := t_det || coalesce(s, '∅');
    t_pass := t_pass || (s = 'cs_jee_pct:Counselling:num:true:true,cs_max_pct:Counselling:num:true:true,cs_weightage_pct:Counselling:num:true:true');

    -- ── B ── (worked out here on their own, from the engine's bucket % and the sheet's rules)
    create temp table zz_sc on commit drop as
    with p as (
      select vp.application_id, public.vsat__campus_key(am.campus_applied) k, am.exam_date_id d,
             public.vsat__scholarship_inputs(vp.application_id) inp,
             (select case when a.rubric_achievements between 1 and 5 and a.rubric_achievements = trunc(a.rubric_achievements) then a.rubric_achievements::int end
                from public.interview_assignments a where a.application_id = vp.application_id and a.attempt_no = coalesce(vp.attempt_no, 1)
               order by a.created_at desc limit 1) rt
        from public.vsat_pipeline vp join public.application_manager am on am.application_id = vp.application_id
       where vp.stage in (select jsonb_array_elements_text(later))
         and public.vsat__campus_key(am.campus_applied) in ('pune', 'gurugram')
    ), e as (
      select p.*, public.vsat__calc_safe(p.inp, p.k, p.d) sc, (p.inp ->> 'jee_pct')::numeric jee,
             (select c.jee_floor_enabled from public.vsat_campus_settings c where c.campus = p.k) floor_on,
             public.vsat__scholarship_cols(p.application_id) got
        from p
    ), x as (
      select e.*, (e.sc ->> 'auto_step')::numeric w,
             case when e.jee >= 98.5 then 70 when e.jee >= 97 then 60 when e.jee >= 95 then 50 when e.jee >= 93 then 40 when e.jee >= 90 then 30 end slab
        from e
    )
    select x.application_id, x.w, coalesce(x.slab, x.w) want_jee, x.slab, x.rt,
           least(100, b.base + case when x.rt = 5 and b.base <= 30 then 10 else 0 end) want_max, b.base, x.got
      from x cross join lateral (select greatest(x.w, case when x.floor_on then coalesce(x.slab, 0) else 0 end) base) b;

    select count(*) filter (where w is not null), count(*) filter (where w is not null and (got ->> 'cs_weightage_pct')::numeric is distinct from w),
           count(*) filter (where w is null and got <> '{}'::jsonb)
      into n, m, ex from zz_sc;
    t_name := t_name || text 'B "Scholarship as per weightage" = the bucket % for every student at PI cleared or later';
    t_det := t_det || format('%s students, %s differ; %s without a bucket %% still got values', n, m, ex); t_pass := t_pass || (n > 0 and m = 0 and ex = 0);

    select count(*) filter (where w is not null and slab is not null), count(*) filter (where w is not null and (got ->> 'cs_jee_pct')::numeric is distinct from want_jee)
      into n, m from zz_sc;
    t_name := t_name || text 'B "Scholarship as per JEE Mains" = the JEE slab when 90 or more, else the weightage %';
    t_det := t_det || format('%s students with a JEE slab, %s differ', n, m); t_pass := t_pass || (n > 0 and m = 0);

    select count(*) filter (where w is not null and rt = 5 and base <= 30), count(*) filter (where w is not null and (got ->> 'cs_max_pct')::numeric is distinct from want_max)
      into n, m from zz_sc;
    t_name := t_name || text 'B "Max scholarship" = the higher of the two, +10 when achievements = 5 and 30 % or less, at most 100';
    t_det := t_det || format('%s students with the +10, %s differ', n, m); t_pass := t_pass || (n > 0 and m = 0);

    -- ── C ── (as a test admin made here)
    adm := gen_random_uuid();
    insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
    values (adm, 'zztest-sc-admin@example.invalid', 'authenticated', 'authenticated', now(), '{}'::jsonb);
    insert into public.profiles (id, email, full_name) values (adm, 'zztest-sc-admin@example.invalid', 'ZZTEST sc admin')
    on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
    insert into public.user_roles (user_id, role) values (adm, 'admin');

    r := pg_temp.call_as(adm, format('select public.vsat_grid_list(%L::jsonb)', jsonb_build_object('scope', later,
           'columns', '["cs_weightage_pct","cs_jee_pct","cs_max_pct"]'::jsonb, 'limit', 200)::text));
    select count(*), count(*) filter (where (x -> 'cs_max_pct') is distinct from (z.got -> 'cs_max_pct')
                                         or (x -> 'cs_jee_pct') is distinct from (z.got -> 'cs_jee_pct')
                                         or (x -> 'cs_weightage_pct') is distinct from (z.got -> 'cs_weightage_pct'))
      into n, m from jsonb_array_elements(coalesce(r -> 'rows', '[]'::jsonb)) x join zz_sc z on z.application_id = x ->> 'application_id';
    t_name := t_name || text 'C the Counselling table returns the three columns, the same values as above';
    t_det := t_det || format('%s rows checked, %s differ %s', n, m, coalesce(r ->> 'message', '')); t_pass := t_pass || (n > 0 and m = 0);

    r2 := pg_temp.call_as(adm, format('select public.vsat_grid_list(%L::jsonb)', jsonb_build_object('scope', later,
           'columns', '["cs_max_pct"]'::jsonb, 'limit', 200,
           'filters', '[{"column":"cs_max_pct","op":"gte","v":"40"}]'::jsonb)::text));
    select count(*), count(*) filter (where x ->> 'cs_max_pct' is null or (x ->> 'cs_max_pct')::numeric < 40) into n, m
      from jsonb_array_elements(coalesce(r2 -> 'rows', '[]'::jsonb)) x;
    select count(*) into ex from zz_sc where want_max >= 40;
    t_name := t_name || text 'C filter "Max scholarship ≥ 40" keeps exactly those students';
    t_det := t_det || format('total %s, %s rows shown, %s below 40; expected %s %s', r2 ->> 'total', n, m, ex, coalesce(r2 ->> 'message', ''));
    t_pass := t_pass || (n > 0 and m = 0 and (r2 ->> 'total')::int = ex);

    -- ── D ──
    t_name := t_name || text 'D unknown student → no values, no error';
    r := public.vsat__scholarship_cols('ZZ-NO-SUCH-APP');
    t_det := t_det || r::text; t_pass := t_pass || (r = '{}'::jsonb);

    t_name := t_name || text 'D helper: SECURITY DEFINER, empty search_path, no browser role';
    select format('definer=%s config=%s anon=%s auth=%s', p.prosecdef, p.proconfig, has_function_privilege('anon', p.oid, 'execute'), has_function_privilege('authenticated', p.oid, 'execute')),
           (p.prosecdef and p.proconfig = array['search_path=""'] and not has_function_privilege('anon', p.oid, 'execute')
             and not has_function_privilege('authenticated', p.oid, 'execute'))
      into s, ok from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = 'vsat__scholarship_cols';
    t_det := t_det || s; t_pass := t_pass || coalesce(ok, false);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_vsat_scholarship_columns_tests();
