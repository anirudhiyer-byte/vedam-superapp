-- VSAT Phase 7 · Profile Analysis page (migration 0191, STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the Supabase MCP.
-- The last statement returns one row per test: test | pass | detail.
-- Covers: the VSAT list and the student search (who sees which students, search as text, limits), one student's profile
-- (fields = the AI's fields, saved summary, WRONG_VSAT, access), and function access. The analyser itself (start / save /
-- limits) is covered by vsat_profile_analyser.test.sql.
--
-- Nothing is left behind: test data is created inside a block that is rolled back with a private error code at the end.
-- Fake data only (@example.invalid, ZZTEST names).

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

-- applicant at "vsat_cleared" on the given campus and VSAT
create or replace function pg_temp.mk_app(p_id text, p_date uuid, p_campus text)
returns text language plpgsql as $$
declare u uuid := pg_temp.mk_user(lower(p_id) || '@example.invalid');
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, lead_stage) values (u, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', 'applicant_paid')
  on conflict (lead_id) do nothing;
  insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email, campus_applied, exam_date_id,
    class10_year, class10_percentage, class10_maths_percentage, class12_year, class12_percentage, class12_maths_percentage,
    marks_physics_12, marks_chemistry_12, marks_maths_12, jee_registered, entrance_percentile, jee_main_maths_percentile,
    exam_percentile, exam_obtained_marks, exam_max_marks, vps_score)
  values (p_id, u, p_id, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', p_campus, p_date,
    2024, 90, 85, 2026, 80, 70, 70, 70, 70, false, null, null, 80, 30, 50, 8.43);
  update public.application_manager set counselling_mode = 'online', counselling_mode_at = now() where application_id = p_id;
  update public.application_manager set exam_given = true where application_id = p_id;
  perform public.vsat__move(p_id, 'vsat_cleared', 'active', 'zz test', 'system', null, null);
  return p_id;
end $$;

create or replace function pg_temp.call_as(p_uid uuid, p_sql text, p_anon boolean default false)
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

create or replace function pg_temp.rpc(p_fn text, p jsonb)
returns text language sql as $$ select format('select public.%I(%L::jsonb)', p_fn, p::text) $$;

-- interview (given achievements score) → pi_cleared → counselling_scheduled
-- 0166: booking and submitting no longer move the stage, so admissions moves it by hand at each step (as staff do now).
-- The optional interviewer verdict is still sent here: test A reads it back as "Final Verdict".
create or replace function pg_temp.move_to(p_adm uuid, p_app text, p_stage text)
returns jsonb language sql as $$
  select pg_temp.call_as(p_adm, pg_temp.rpc('vsat_move_stage', jsonb_build_object('application_id', p_app, 'to_stage', p_stage)))
$$;
create or replace function pg_temp.to_counselling(p_app text, p_ach int, p_n int, p_adm uuid, p_int uuid, p_cou uuid)
returns jsonb language plpgsql as $$
declare r jsonb; slot text := to_char(now() + make_interval(days => 10 + p_n), 'YYYY-MM-DD"T"HH24:00:00"Z"');
begin
  r := pg_temp.call_as(p_adm, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', p_app, 'interviewer_id', p_int, 'slot_datetime', slot)));
  if r ? 'sqlstate' then return r; end if;
  r := pg_temp.move_to(p_adm, p_app, 'interview_scheduled'); if r ? 'sqlstate' then return r; end if;
  r := pg_temp.call_as(p_int, pg_temp.rpc('vsat_submit_interview', jsonb_build_object('application_id', p_app, 'communication', 4, 'logic', 4,
         'passion', 3, 'achievements', p_ach, 'why_program', 4, 'cheating_seen', false, 'interviewer_verdict', 'selected')));
  if r ? 'sqlstate' then return r; end if;
  r := pg_temp.move_to(p_adm, p_app, 'interviewed'); if r ? 'sqlstate' then return r; end if;
  r := pg_temp.move_to(p_adm, p_app, 'pi_cleared'); if r ? 'sqlstate' then return r; end if;
  r := pg_temp.call_as(p_adm, pg_temp.rpc('vsat_assign_counsellor', jsonb_build_object('application_id', p_app, 'counsellor_id', p_cou, 'slot_datetime', slot)));
  if r ? 'sqlstate' then return r; end if;
  r := pg_temp.move_to(p_adm, p_app, 'counselling_scheduled'); if r ? 'sqlstate' then return r; end if;
  return pg_temp.call_as(p_adm, format('select public.vsat_student(%L)', p_app));
end $$;

create or replace function pg_temp.call_svc(p_sql text)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  execute p_sql into r;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return coalesce(r, 'null'::jsonb);
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('sqlstate', sqlstate, 'message', sqlerrm);
end $$;

create or replace function pg_temp.lookup(p_who uuid, p jsonb)
returns jsonb language sql as $$ select pg_temp.call_as(p_who, pg_temp.rpc('vsat_profile_lookup', p)) $$;
create or replace function pg_temp.get(p_who uuid, p jsonb)
returns jsonb language sql as $$ select pg_temp.call_as(p_who, pg_temp.rpc('vsat_profile_get', p)) $$;
-- the application ids a lookup returned, in order
create or replace function pg_temp.ids(r jsonb)
returns text language sql as $$ select coalesce(string_agg(x->>'application_id', ',' order by o), '∅') from jsonb_array_elements(r->'students') with ordinality t(x, o) $$;

create or replace function pg_temp.run_vsat_profile_analysis_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; adm_g uuid; int1 uuid; cou1 uuid; cou2 uuid; usr uuid; d uuid; d2 uuid;
  b1 text; b2 text; b4 text; b5 text; r jsonb; r2 jsonb; run uuid; s text;
  pune constant text := 'Ajeenkya DY Patil University — Pune';
  ggn constant text := 'Sushant University — Gurugram';
begin
  begin -- rolled back at the end (ZDONE)
    adm   := pg_temp.mk_user('zztest-pa-adm@example.invalid');
    adm_g := pg_temp.mk_user('zztest-pa-admg@example.invalid');
    int1  := pg_temp.mk_user('zztest-pa-int1@example.invalid');
    cou1  := pg_temp.mk_user('zztest-pa-cou1@example.invalid');
    cou2  := pg_temp.mk_user('zztest-pa-cou2@example.invalid');
    usr   := pg_temp.mk_user('zztest-pa-user@example.invalid');
    insert into public.vsat_team (user_id, role) values (adm, 'admissions'), (int1, 'interviewer'), (cou1, 'counsellor'), (cou2, 'counsellor');
    insert into public.vsat_team (user_id, role, campus) values (adm_g, 'admissions', 'gurugram');
    insert into public.vsat_counsellor_zoom (counsellor_id, zoom_link) values (cou1, 'https://zoom.us/j/zztest-pa-cou1'), (cou2, 'https://zoom.us/j/zztest-pa-cou2');
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at)
    values ('ZZTEST profile analysis A', 'zz-pa-a', current_date, now(), now() + interval '2 hours') returning id into d;
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at)
    values ('ZZTEST profile analysis B', 'zz-pa-b', current_date, now(), now() + interval '2 hours') returning id into d2;
    b1 := pg_temp.mk_app('ZZT-PA-1', d, pune);     -- counselling with cou1
    b2 := pg_temp.mk_app('ZZT-PA-2', d, pune);     -- PI cleared, no counsellor
    b4 := pg_temp.mk_app('ZZT-PA-4', d, ggn);      -- Gurugram, same VSAT
    b5 := pg_temp.mk_app('ZZT-PA-5', d2, pune);    -- the other VSAT
    r := pg_temp.to_counselling(b1, 4, 1, adm, int1, cou1);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', b2, 'interviewer_id', int1,
           'slot_datetime', to_char(now() + interval '12 days', 'YYYY-MM-DD"T"HH24:00:00"Z"'))));
    r := pg_temp.move_to(adm, b2, 'interview_scheduled');
    r := pg_temp.call_as(int1, pg_temp.rpc('vsat_submit_interview', jsonb_build_object('application_id', b2, 'communication', 4, 'logic', 4,
           'passion', 3, 'achievements', 4, 'why_program', 4, 'cheating_seen', false, 'interviewer_verdict', 'selected')));
    r := pg_temp.move_to(adm, b2, 'interviewed');
    r := pg_temp.move_to(adm, b2, 'pi_cleared');
    t_name := t_name || text 'setup: b1 counselling_scheduled, b2 pi_cleared, b4 / b5 vsat_cleared';
    select string_agg(vp.stage, ',' order by vp.application_id) into s from public.vsat_pipeline vp where vp.application_id in (b1, b2, b4, b5);
    t_det := t_det || s; t_pass := t_pass || (s = 'counselling_scheduled,pi_cleared,vsat_cleared,vsat_cleared');

    -- ── L. the VSAT list and the search ──
    r := pg_temp.lookup(adm, '{}');
    t_name := t_name || text 'L no VSAT picked: the VSAT list (both test VSATs), no students';
    t_det := t_det || format('vsats has A=%s B=%s students=%s', r->'vsats' @> jsonb_build_array(jsonb_build_object('id', d)),
                             r->'vsats' @> jsonb_build_array(jsonb_build_object('id', d2)), r->'students');
    t_pass := t_pass || (r->'vsats' @> jsonb_build_array(jsonb_build_object('id', d, 'label', 'ZZTEST profile analysis A'))
                         and r->'vsats' @> jsonb_build_array(jsonb_build_object('id', d2)) and r->'students' = '[]'::jsonb and (r->>'total')::int = 0);

    r := pg_temp.lookup(adm, jsonb_build_object('exam_date_id', d));
    t_name := t_name || text 'L admissions (all campuses), VSAT A: its three students, not the other VSAT''s';
    t_det := t_det || format('%s total=%s', pg_temp.ids(r), r->>'total');
    t_pass := t_pass || (pg_temp.ids(r) = 'ZZT-PA-1,ZZT-PA-2,ZZT-PA-4' and (r->>'total')::int = 3);

    r := pg_temp.lookup(adm, jsonb_build_object('exam_date_id', d, 'q', ' zzt-pa-2 '));
    r2 := pg_temp.lookup(adm, jsonb_build_object('exam_date_id', d, 'q', 'ZZTEST ZZT-PA-4'));
    t_name := t_name || text 'L search by application ID (any case, spaces trimmed) and by name';
    t_det := t_det || format('id: %s · name: %s', pg_temp.ids(r), pg_temp.ids(r2));
    t_pass := t_pass || (pg_temp.ids(r) = 'ZZT-PA-2' and pg_temp.ids(r2) = 'ZZT-PA-4');

    r := pg_temp.lookup(adm, jsonb_build_object('exam_date_id', d, 'q', '%'));
    r2 := pg_temp.lookup(adm, jsonb_build_object('exam_date_id', d, 'q', 'ZZT_PA_1'));
    t_name := t_name || text 'L the search words are text, not a pattern (% and _ match only themselves)';
    t_det := t_det || format('%%: %s · _: %s', pg_temp.ids(r), pg_temp.ids(r2));
    t_pass := t_pass || (pg_temp.ids(r) = '∅' and pg_temp.ids(r2) = '∅');

    r := pg_temp.lookup(adm, jsonb_build_object('exam_date_id', d, 'q', 'ZZT-PA-5'));
    t_name := t_name || text 'L a student of another VSAT is not found in this one';
    t_det := t_det || pg_temp.ids(r); t_pass := t_pass || (pg_temp.ids(r) = '∅');

    r := pg_temp.lookup(adm_g, jsonb_build_object('exam_date_id', d));
    t_name := t_name || text 'L Gurugram-only admissions sees only the Gurugram student';
    t_det := t_det || pg_temp.ids(r); t_pass := t_pass || (pg_temp.ids(r) = 'ZZT-PA-4');

    r := pg_temp.lookup(cou1, jsonb_build_object('exam_date_id', d));
    r2 := pg_temp.lookup(cou2, jsonb_build_object('exam_date_id', d));
    t_name := t_name || text 'L a counsellor sees only the students assigned to them';
    t_det := t_det || format('cou1: %s · cou2: %s', pg_temp.ids(r), pg_temp.ids(r2));
    t_pass := t_pass || (pg_temp.ids(r) = 'ZZT-PA-1' and pg_temp.ids(r2) = '∅' and jsonb_array_length(r2->'vsats') > 0);

    r := pg_temp.lookup(adm, jsonb_build_object('exam_date_id', d, 'q', 'ZZT-PA-1'));
    t_name := t_name || text 'L a search row has only id, application no, name, campus, stage, status';
    select string_agg(k, ',' order by k) into s from jsonb_object_keys(r->'students'->0) k;
    t_det := t_det || coalesce(s, '∅'); t_pass := t_pass || (s = 'application_id,application_no,campus,name,stage,status');

    t_name := t_name || text 'L refused: interviewer, non-staff user (FORBIDDEN), signed-out visitor';
    r := pg_temp.lookup(int1, '{}'); r2 := pg_temp.lookup(usr, '{}');
    s := pg_temp.call_as(null, pg_temp.rpc('vsat_profile_lookup', '{}'), true)->>'sqlstate';
    t_det := t_det || format('%s · %s · anon %s', r->>'message', r2->>'message', s);
    t_pass := t_pass || (r->>'message' = 'FORBIDDEN' and r2->>'message' = 'FORBIDDEN' and s = '42501');

    t_name := t_name || text 'L bad requests refused: unknown key, bad VSAT id, search over 80 characters';
    r := pg_temp.lookup(adm, '{"x":1}');
    r2 := pg_temp.lookup(adm, '{"exam_date_id":"not-a-uuid"}');
    s := pg_temp.lookup(adm, jsonb_build_object('exam_date_id', d, 'q', repeat('a', 81)))->>'message';
    t_det := t_det || format('%s · %s · %s', r->>'message', r2->>'message', s);
    t_pass := t_pass || (r->>'message' = 'UNKNOWN_KEY: x' and r2->>'message' = 'BAD_VALUE: exam_date_id' and s = 'BAD_VALUE: q');

    -- ── G. one student's profile ──
    r := pg_temp.get(cou1, jsonb_build_object('application_id', b1, 'exam_date_id', d));
    t_name := t_name || text 'G assigned counsellor: name, application no, campus, VSAT, stage, counselling yes, no summary yet';
    t_det := t_det || left(r::text, 300);
    t_pass := t_pass || (r->>'name' = 'ZZTEST ZZT-PA-1' and r->>'application_no' = 'ZZT-PA-1' and r->>'campus' = 'pune'
                         and r->'vsat'->>'label' = 'ZZTEST profile analysis A' and r->>'stage' = 'counselling_scheduled'
                         and (r->>'has_counselling')::boolean and r->'analysis' = 'null'::jsonb);

    r2 := pg_temp.call_as(cou1, format('select public.vsat_profile_start(%L)', b1));
    run := (r2->>'run_id')::uuid;
    t_name := t_name || text 'G the page shows exactly the fields the AI gets (same list, same order)';
    t_det := t_det || format('page %s fields, AI %s fields', jsonb_array_length(r->'fields'), jsonb_array_length(r2->'fields'));
    t_pass := t_pass || (run is not null and r->'fields' = r2->'fields' and jsonb_array_length(r->'fields') >= 20);

    t_name := t_name || text 'G fields carry VSAT, interview and scholarship data; no email or phone';
    t_det := t_det || left((r->'fields')::text, 200);
    t_pass := t_pass || ((r->'fields') @> '[["VPS (out of 10)", "8.43"]]' and (r->'fields') @> '[["Communication & Behavioural Skills (out of 5)", "4"]]'
                         and (r->'fields')::text not like '%example.invalid%');

    r2 := pg_temp.call_svc(format('select public.vsat_profile_save(%L::uuid, %L, %L)', run, '**High-impact summary line** zz test', 'claude-sonnet-5-5'));
    r := pg_temp.get(adm, jsonb_build_object('application_id', b1));
    t_name := t_name || text 'G after the server saves the summary, the page shows it with when and the model';
    t_det := t_det || coalesce((r->'analysis')::text, '∅');
    t_pass := t_pass || (r->'analysis'->>'text' = '**High-impact summary line** zz test' and r->'analysis'->>'model' = 'claude-sonnet-5-5'
                         and r->'analysis'->>'generated_at' is not null);

    r := pg_temp.get(adm, jsonb_build_object('application_id', b2, 'exam_date_id', d));
    t_name := t_name || text 'G a student without a counselling record: fields shown, counselling no, no summary';
    t_det := t_det || format('fields=%s has_counselling=%s analysis=%s', jsonb_array_length(r->'fields'), r->>'has_counselling', r->'analysis');
    t_pass := t_pass || (jsonb_array_length(r->'fields') > 0 and not (r->>'has_counselling')::boolean and r->'analysis' = 'null'::jsonb);

    r := pg_temp.get(adm, jsonb_build_object('application_id', b1, 'exam_date_id', d2));
    t_name := t_name || text 'G picked VSAT is not the student''s → WRONG_VSAT';
    t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'WRONG_VSAT');

    t_name := t_name || text 'G refused (FORBIDDEN, no hint): other counsellor, Gurugram-only admissions on a Pune student, interviewer, non-staff, unknown id';
    s := concat_ws(' · ', pg_temp.get(cou2, jsonb_build_object('application_id', b1))->>'message',
                          pg_temp.get(adm_g, jsonb_build_object('application_id', b1))->>'message',
                          pg_temp.get(int1, jsonb_build_object('application_id', b1))->>'message',
                          pg_temp.get(usr, jsonb_build_object('application_id', b1))->>'message',
                          pg_temp.get(adm, '{"application_id":"ZZT-NOPE"}')->>'message');
    t_det := t_det || s; t_pass := t_pass || (s = 'FORBIDDEN · FORBIDDEN · FORBIDDEN · FORBIDDEN · FORBIDDEN');

    r := pg_temp.get(adm_g, jsonb_build_object('application_id', b4));
    t_name := t_name || text 'G Gurugram-only admissions opens the Gurugram student';
    t_det := t_det || coalesce(r->>'name', r::text); t_pass := t_pass || (r->>'name' = 'ZZTEST ZZT-PA-4');

    t_name := t_name || text 'G bad requests refused: no id, unknown key, bad VSAT id; signed-out visitor';
    s := concat_ws(' · ', pg_temp.get(adm, '{}')->>'message', pg_temp.get(adm, jsonb_build_object('application_id', b1, 'x', 1))->>'message',
                          pg_temp.get(adm, jsonb_build_object('application_id', b1, 'exam_date_id', 'nope'))->>'message',
                          pg_temp.call_as(null, pg_temp.rpc('vsat_profile_get', jsonb_build_object('application_id', b1)), true)->>'sqlstate');
    t_det := t_det || s; t_pass := t_pass || (s = 'BAD_VALUE: application_id · UNKNOWN_KEY: x · BAD_VALUE: exam_date_id · 42501');

    -- ── S. function access ──
    t_name := t_name || text 'S lookup / get: SECURITY DEFINER, empty search_path, authenticated only; the field helper closed to browsers';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat_profile_lookup', 'vsat_profile_get', 'vsat__profile_fields', 'vsat_profile_start')
       and (not p.prosecdef or p.proconfig is distinct from array['search_path=""'] or has_function_privilege('anon', p.oid, 'execute')
            or (p.proname = 'vsat__profile_fields' and has_function_privilege('authenticated', p.oid, 'execute'))
            or (p.proname <> 'vsat__profile_fields' and not has_function_privilege('authenticated', p.oid, 'execute')));
    t_det := t_det || coalesce(s, 'ok'); t_pass := t_pass || (s is null);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_vsat_profile_analysis_tests();
