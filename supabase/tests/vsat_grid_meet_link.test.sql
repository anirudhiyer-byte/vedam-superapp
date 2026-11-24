-- VSAT grid · the meeting link next to the Interview / Counselling Meet column, and the reschedule counts — tests
-- for migration 0163 (STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the Supabase MCP.
-- The last statement returns one row per test: test | pass | detail.
--
-- Nothing is left behind: all test data is created inside a block that is rolled back with a private
-- error code at the end. Fake data only (@example.invalid, ZZTEST names). Every grid call is limited to the
-- test students (application_ids), so other staging data never changes a result.

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

-- applicant at "counselling_scheduled" (has been through the interview)
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

-- the grid as p_who, limited to the test students, with the given columns
create or replace function pg_temp.grid(p_who uuid, p_apps text[], p_cols jsonb, p_fn text default 'vsat_grid_list')
returns jsonb language sql as $$
  select pg_temp.call_as(p_who, pg_temp.rpc(p_fn,
    jsonb_build_object('application_ids', to_jsonb(p_apps), 'columns', p_cols, 'limit', 50)
    || case when p_fn = 'vsat_grid_export' then jsonb_build_object('purpose', 'csv') else '{}'::jsonb end))
$$;

-- "APP=interview link|counselling link" per row (∅ = no key), sorted by application id
create or replace function pg_temp.links(r jsonb)
returns text language sql as $$
  select coalesce(string_agg(x->>'application_id' || '=' || coalesce(x->>'interview_meet_link', '∅') || '|' || coalesce(x->>'counselling_meet_link', '∅'),
                             ',' order by x->>'application_id'), coalesce(r->>'message', ''))
    from jsonb_array_elements(r->'rows') x
$$;

create or replace function pg_temp.run_vsat_grid_meet_link_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; adm_pune uuid; i1 uuid; i2 uuid; c1 uuid; nobody uuid;
  k1 text; k2 text; k3 text; k4 text; k5 text; k6 text; apps text[];
  r jsonb; s text;
  both_cols constant jsonb := '["interview_meet", "counselling_meet"]';
  pune constant text := 'Ajeenkya DY Patil University — Pune';
  ggn constant text := 'Sushant University — Gurugram';
  l_iv1 constant text := 'https://meet.google.com/zzt-ivaa-one';
  l_cs1 constant text := 'https://meet.google.com/zzt-csaa-one';
  l_own constant text := 'https://zoom.example.invalid/j/zzt';
  l_ggn constant text := 'https://meet.google.com/zzt-ggnn-six';
begin
  begin -- rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('zztest-ml-adm@example.invalid');
    adm_pune := pg_temp.mk_user('zztest-ml-admpune@example.invalid');
    i1 := pg_temp.mk_user('zztest-ml-int1@example.invalid');
    i2 := pg_temp.mk_user('zztest-ml-int2@example.invalid');
    c1 := pg_temp.mk_user('zztest-ml-couns1@example.invalid');
    nobody := pg_temp.mk_user('zztest-ml-nobody@example.invalid');
    insert into public.vsat_team (user_id, role, campus) values
      (adm, 'admissions', null), (adm_pune, 'admissions', 'pune'), (i1, 'interviewer', null), (i2, 'interviewer', null), (c1, 'counsellor', null);
    k1 := pg_temp.mk_app('ZZT-ML-1', pune);   -- Google Meet interview (i1) + Google Meet counselling (c1)
    k2 := pg_temp.mk_app('ZZT-ML-2', pune);   -- own-link interview (i2)
    k3 := pg_temp.mk_app('ZZT-ML-3', pune);   -- cancelled interview (i1) that still has its old link
    k4 := pg_temp.mk_app('ZZT-ML-4', pune);   -- own "link" that is not https (i1)
    k5 := pg_temp.mk_app('ZZT-ML-5', pune);   -- Meet still being made, no link yet (i1)
    k6 := pg_temp.mk_app('ZZT-ML-6', ggn);    -- Gurugram, Google Meet interview (i2)
    apps := array[k1, k2, k3, k4, k5, k6];
    delete from public.interview_assignments where application_id = any(apps);
    delete from public.counselling_assignments where application_id = any(apps);
    insert into public.interview_assignments (application_id, attempt_no, interviewer_id, slot_datetime, meet_mode, meet_sync, meet_link, cancelled_at) values
      (k1, 1, i1, now() + interval '2 days',          'auto',   'ok',      l_iv1, null),
      (k2, 1, i2, now() + interval '2 days 1 hour',   'manual', 'none',    l_own, null),
      (k3, 1, i1, now() + interval '2 days 2 hours',  'auto',   'ok',      'https://meet.google.com/zzt-gone-three', now()),
      (k4, 1, i1, now() + interval '2 days 3 hours',  'manual', 'none',    'javascript:alert(1)', null),
      (k5, 1, i1, now() + interval '2 days 4 hours',  'auto',   'pending', null, null),
      (k6, 1, i2, now() + interval '2 days 5 hours',  'auto',   'ok',      l_ggn, null);
    insert into public.counselling_assignments (application_id, attempt_no, counsellor_id, slot_datetime, meet_mode, meet_sync, zoom_link, cancelled_at) values
      (k1, 1, c1, now() + interval '3 days', 'auto', 'ok', l_cs1, null);

    -- ════ A. admin / admissions ════
    r := pg_temp.grid(adm, apps, both_cols);
    t_name := t_name || text 'A admissions: the link of each live meeting (Google Meet and own link); none when cancelled, not https or not made yet';
    t_det := t_det || pg_temp.links(r);
    t_pass := t_pass || (pg_temp.links(r) = format('ZZT-ML-1=%s|%s,ZZT-ML-2=%s|∅,ZZT-ML-3=∅|∅,ZZT-ML-4=∅|∅,ZZT-ML-5=∅|∅,ZZT-ML-6=%s|∅', l_iv1, l_cs1, l_own, l_ggn));

    r := pg_temp.grid(adm, apps, '["interview_meet"]');
    t_name := t_name || text 'A only the interview link comes with the Interview Meet column';
    t_det := t_det || pg_temp.links(r);
    t_pass := t_pass || (pg_temp.links(r) like format('ZZT-ML-1=%s|∅,%%', l_iv1));

    r := pg_temp.grid(adm, apps, '["counselling_meet"]');
    t_name := t_name || text 'A only the counselling link comes with the Counselling Meet column';
    t_det := t_det || pg_temp.links(r);
    t_pass := t_pass || (pg_temp.links(r) = format('ZZT-ML-1=∅|%s,ZZT-ML-2=∅|∅,ZZT-ML-3=∅|∅,ZZT-ML-4=∅|∅,ZZT-ML-5=∅|∅,ZZT-ML-6=∅|∅', l_cs1));

    r := pg_temp.grid(adm, apps, '["registered_name", "interviewer", "interview_slot"]');
    t_name := t_name || text 'A no Meet column asked → no link at all';
    select count(*)::text into s from jsonb_array_elements(r->'rows') x where x ? 'interview_meet_link' or x ? 'counselling_meet_link';
    t_det := t_det || format('rows with a link key: %s (rows %s)', s, jsonb_array_length(r->'rows'));
    t_pass := t_pass || (s = '0' and jsonb_array_length(r->'rows') = 6);

    r := pg_temp.grid(adm, apps, both_cols);
    select string_agg(x->>'application_id' || '=' || coalesce(x->>'interview_meet', '∅'), ',' order by x->>'application_id') into s from jsonb_array_elements(r->'rows') x;
    t_name := t_name || text 'A the Meet column itself is unchanged';
    t_det := t_det || coalesce(s, r::text);
    t_pass := t_pass || (s = 'ZZT-ML-1=ready,ZZT-ML-2=own_link,ZZT-ML-3=cancelled,ZZT-ML-4=own_link,ZZT-ML-5=creating,ZZT-ML-6=ready');

    r := pg_temp.grid(adm_pune, apps, both_cols);
    t_name := t_name || text 'A Pune-only admissions: Pune links only (the Gurugram row stays hidden, as before)';
    t_det := t_det || pg_temp.links(r);
    t_pass := t_pass || (pg_temp.links(r) = format('ZZT-ML-1=%s|%s,ZZT-ML-2=%s|∅,ZZT-ML-3=∅|∅,ZZT-ML-4=∅|∅,ZZT-ML-5=∅|∅', l_iv1, l_cs1, l_own));

    -- ════ H. interviewers / counsellors: their own meeting only ════
    r := pg_temp.grid(i1, apps, both_cols);
    t_name := t_name || text 'H interviewer 1: own interview links, never the counselling link of the same student';
    t_det := t_det || pg_temp.links(r);
    t_pass := t_pass || (pg_temp.links(r) = format('ZZT-ML-1=%s|∅,ZZT-ML-3=∅|∅,ZZT-ML-4=∅|∅,ZZT-ML-5=∅|∅', l_iv1));

    r := pg_temp.grid(i2, apps, both_cols);
    t_name := t_name || text 'H interviewer 2: own students and links only (both campuses)';
    t_det := t_det || pg_temp.links(r);
    t_pass := t_pass || (pg_temp.links(r) = format('ZZT-ML-2=%s|∅,ZZT-ML-6=%s|∅', l_own, l_ggn));

    r := pg_temp.grid(c1, apps, both_cols);
    t_name := t_name || text 'H counsellor: own counselling link, never the interview link of the same student';
    t_det := t_det || pg_temp.links(r);
    t_pass := t_pass || (pg_temp.links(r) = format('ZZT-ML-1=∅|%s', l_cs1));

    update public.interview_assignments set interviewer_id = i2 where application_id = k1;
    r := pg_temp.grid(i1, apps, both_cols);
    t_name := t_name || text 'H after a change of interviewer the old one no longer sees that student or link';
    t_det := t_det || pg_temp.links(r);
    t_pass := t_pass || (pg_temp.links(r) not like '%ZZT-ML-1%' and pg_temp.links(r) not like '%' || l_iv1 || '%');
    update public.interview_assignments set interviewer_id = i1 where application_id = k1;

    -- ════ C. reschedule counts (0163) ════
    update public.interview_assignments set reschedule_count = 2 where application_id = k1;
    update public.counselling_assignments set reschedule_count = 1 where application_id = k1;
    r := pg_temp.grid(adm, array[k1, k5], '["interview_reschedules", "counselling_reschedules"]');
    select string_agg(x->>'application_id' || '=' || coalesce(x->>'interview_reschedules', '∅') || '/' || coalesce(x->>'counselling_reschedules', '∅'), ',' order by x->>'application_id') into s
      from jsonb_array_elements(r->'rows') x;
    t_name := t_name || text 'C reschedule counts come as columns (none when there is no booking)';
    t_det := t_det || coalesce(s, r::text);
    t_pass := t_pass || (s = 'ZZT-ML-1=2/1,ZZT-ML-5=0/∅');
    select string_agg(c.key || ':' || c.grp || ':' || c.typ, ',' order by c.key) into s from public.vsat__grid_catalog() c where c.key like '%reschedules';
    t_name := t_name || text 'C the two reschedule columns are in the catalogue (Interview / Counselling, number)';
    t_det := t_det || coalesce(s, 'none');
    t_pass := t_pass || (s = 'counselling_reschedules:Counselling:num,interview_reschedules:Interview:num');

    -- ════ R. refused / private ════
    r := pg_temp.grid(adm, apps, '["interview_meet_link"]');
    s := r->>'message';
    r := pg_temp.grid(adm, apps, '["counselling_meet_link"]');
    s := s || ' | ' || (r->>'message');
    t_name := t_name || text 'R a link can''t be asked for as a column of its own';
    t_det := t_det || coalesce(s, 'not refused');
    t_pass := t_pass || (s = 'BAD_VALUE: columns | BAD_VALUE: columns');

    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', jsonb_build_object('application_ids', to_jsonb(apps), 'columns', both_cols,
           'filters', jsonb_build_array(jsonb_build_object('column', 'interview_meet_link', 'op', 'contains', 'v', 'meet')))));
    t_name := t_name || text 'R a link can''t be filtered on';
    t_det := t_det || coalesce(r->>'message', 'not refused');
    t_pass := t_pass || (r ? 'sqlstate');

    select string_agg(c.key, ',') into s from public.vsat__grid_catalog() c where c.key like '%link%';
    t_name := t_name || text 'R the link keys are not in the column catalogue';
    t_det := t_det || coalesce(s, 'none');
    t_pass := t_pass || (s is null or (s not like '%interview_meet_link%' and s not like '%counselling_meet_link%'));

    r := pg_temp.grid(nobody, apps, both_cols);
    t_name := t_name || text 'R no VSAT role → refused'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(null, pg_temp.rpc('vsat_grid_list', jsonb_build_object('application_ids', to_jsonb(apps), 'columns', both_cols)), 'anon');
    t_name := t_name || text 'R signed out → refused'; t_det := t_det || (r::text); t_pass := t_pass || (r ? 'sqlstate');

    t_name := t_name || text 'R the grid engine stays private (security definer, empty search_path, no browser role)';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat__grid', 'vsat__grid_catalog')
       and (not p.prosecdef or p.proconfig is distinct from array['search_path=""']
            or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
    t_det := t_det || (coalesce(s, 'ok')); t_pass := t_pass || (s is null);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_vsat_grid_meet_link_tests();
