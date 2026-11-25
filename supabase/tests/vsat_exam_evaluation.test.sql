-- VSAT Phase 2 · Exam Evaluation + the sheet columns on the VSAT Exam table — tests for migration 0172 (STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the Supabase MCP.
-- The last statement returns one row per test: test | pass | detail.
--
-- A. The 32 students of the "Test Result" sheet (VSAT 14 July; only %, percentile, gender, campus and the disqualified
--    flag — no names) give exactly the sheet's numbers: Average 75.84375, > 70 = 24, slabs 0/4/1/8/18, Male 24 /
--    Female 7, and the Overall / ADYPU Pune / Gurugram tables at 35, 60 and 65 (all not disqualified).
-- B. The new grid columns (first / last name, user id, the Wheebox test-result fields).
-- C. vsat_exam_below_cutoff · D. vsat_exam_raise · E. access rules.
--
-- Nothing is left behind: all test data is created inside a block that is rolled back with a private error code at
-- the end. Fake data only (@example.invalid, ZZTEST names).

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

-- a student of one VSAT at "Exam taken" (pctl null = no result yet: left at "Booked")
create or replace function pg_temp.mk_taker(p_id text, p_date uuid, p_pct numeric, p_pctl numeric, p_gender text, p_campus text)
returns text language plpgsql as $$
declare u uuid := pg_temp.mk_user(lower(p_id) || '@example.invalid');
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, lead_stage) values (u, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', 'applicant_paid')
  on conflict (lead_id) do nothing;
  insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email, campus_applied, exam_date_id,
    gender, class10_year, class10_percentage, class12_year, class12_percentage, marks_physics_12, marks_chemistry_12, marks_maths_12,
    exam_percentile, exam_obtained_marks, exam_max_marks, vps_score)
  values (p_id, u, p_id, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid',
    case p_campus when 'pune' then 'Ajeenkya DY Patil University — Pune' else 'Sushant University — Gurugram' end, p_date,
    p_gender, 2024, 90, 2026, 80, 70, 70, 70, p_pctl, p_pct * 2, 200, null);
  if p_pctl is not null then
    perform public.vsat__move(p_id, 'exam_taken', 'active', 'zz test', 'system', null, null);
  end if;
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

create or replace function pg_temp.stage(p_app text)
returns text language sql as $$ select vp.stage || ':' || vp.status from public.vsat_pipeline vp where vp.application_id = p_app $$;

-- one cut-off table of vsat_exam_analysis as "male/female/total" for overall, pune, gurugram
create or replace function pg_temp.cut3(r jsonb)
returns text language sql as $$
  select format('%s/%s/%s|%s/%s/%s|%s/%s/%s',
    r->'cutoff'->'overall'->>'male', r->'cutoff'->'overall'->>'female', r->'cutoff'->>'total',
    r->'cutoff'->'by_campus'->'pune'->>'male', r->'cutoff'->'by_campus'->'pune'->>'female', r->'cutoff'->'by_campus'->'pune'->>'total',
    r->'cutoff'->'by_campus'->'gurugram'->>'male', r->'cutoff'->'by_campus'->'gurugram'->>'female', r->'cutoff'->'by_campus'->'gurugram'->>'total')
$$;

create or replace function pg_temp.run_vsat_exam_evaluation_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  curve jsonb := '[{"percentile":0,"vps":0},{"percentile":65,"vps":7.4},{"percentile":100,"vps":9.8}]';
  adm uuid; admis uuid; d uuid; d2 uuid; x record; r jsonb; r2 jsonb; s text; n int; cut numeric; lead uuid;
  a_top text; a_56 text; a_30 text; a_26 text; x_dq text; x_inel text; x_hold text; x_none text; o_id text;
  sheet_cols jsonb := '["first_name", "last_name", "user_id", "exam_test_name", "exam_started_at", "exam_ended_at", "exam_time_taken",
                        "exam_total_questions", "exam_attempted", "exam_correct", "exam_incorrect", "exam_unattempted"]';
begin
  begin -- rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('zztest-ee-admin@example.invalid');
    insert into public.user_roles (user_id, role) values (adm, 'admin');
    admis := pg_temp.mk_user('zztest-ee-admissions@example.invalid');
    insert into public.vsat_team (user_id, role) values (admis, 'admissions');
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at, vps_anchors)
    values ('ZZTEST VSAT-EE', 'zz-ee-1', current_date, now(), now() + interval '2 hours', curve) returning id into d;
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at, vps_anchors)
    values ('ZZTEST VSAT-EE2', 'zz-ee-2', current_date, now(), now() + interval '2 hours', curve) returning id into d2;

    -- the sheet's 32 rows: (n, percentage, percentile, gender, campus, disqualified)
    for x in select * from (values
      (1, 65.0, 65.0, 'Male', 'ggn', false), (2, 92.5, 92.0, 'Male', 'pune', false), (3, 73.0, 73.0, 'Female', 'ggn', false), (4, 77.5, 78.0, 'Male', 'pune', true),
      (5, 26.5, 26.0, 'Male', 'pune', false), (6, 81.5, 82.0, 'Male', 'pune', false), (7, 92.5, 92.0, 'Male', 'pune', false), (8, 74.0, 74.0, 'Male', 'ggn', false),
      (9, 80.0, 80.0, 'Male', 'pune', false), (10, 88.5, 88.0, 'Male', 'pune', false), (11, 30.0, 30.0, 'Male', 'pune', false), (12, 95.0, 95.0, 'Female', 'ggn', false),
      (13, 80.0, 80.0, 'Female', 'pune', false), (14, 87.5, 88.0, 'Male', 'pune', false), (15, 75.0, 75.0, 'Male', 'ggn', false), (16, 82.0, 82.0, 'Female', 'pune', false),
      (17, 91.0, 91.0, 'Male', 'pune', false), (18, 80.0, 80.0, 'Female', 'pune', false), (19, 82.5, 82.0, 'Male', 'pune', false), (20, 69.5, 70.0, 'Male', 'pune', false),
      (21, 95.0, 95.0, 'Male', 'ggn', false), (22, 97.5, 98.0, 'Male', 'ggn', false), (23, 95.0, 95.0, 'Male', 'pune', false), (24, 67.5, 68.0, 'Male', 'ggn', false),
      (25, 95.5, 96.0, 'Male', 'ggn', false), (26, 77.5, 78.0, 'Male', 'pune', false), (27, 92.5, 92.0, 'Male', 'ggn', false), (28, 33.0, 33.0, 'Female', 'pune', false),
      (29, 85.0, 85.0, 'Female', 'pune', false), (30, 77.5, 78.0, 'Male', 'ggn', false), (31, 56.5, 56.0, 'Male', 'pune', false), (32, 31.0, 31.0, 'Male', 'ggn', false)
    ) v(i, pct, pctl, g, campus, dq) loop
      perform pg_temp.mk_taker('ZZT-EE-' || lpad(x.i::text, 2, '0'), d, x.pct, x.pctl, x.g, x.campus);
      if x.dq then
        insert into public.vsat_proctoring (application_id, attempt_no, verdict, reason, set_by)
        values ('ZZT-EE-' || lpad(x.i::text, 2, '0'), 1, 'disqualified', 'zz sheet', adm);
      end if;
    end loop;
    a_top := 'ZZT-EE-22'; a_56 := 'ZZT-EE-31'; a_30 := 'ZZT-EE-11'; a_26 := 'ZZT-EE-05';

    -- ════ A. the sheet's numbers ════
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_exam_analysis', jsonb_build_object('exam_date_ids', jsonb_build_array(d), 'percentile', 35)));
    t_name := t_name || text 'A took the test 32 of 32 booked · 1 disqualified · 31 not disqualified';
    t_det := t_det || (format('%s/%s/%s/%s', r->>'takers', r->>'booked', r->>'disqualified', r->>'not_disqualified'));
    t_pass := t_pass || (r->>'takers' = '32' and r->>'booked' = '32' and r->>'disqualified' = '1' and r->>'not_disqualified' = '31');
    t_name := t_name || text 'A Average (sheet AF3 = 75.84375) and percentile > 70 (sheet AG3 = 24), every taker';
    t_det := t_det || (format('%s | %s', r->>'avg_percentage', r->>'above_70'));
    t_pass := t_pass || ((r->>'avg_percentage')::numeric = round(75.84375, 2) and r->>'above_70' = '24');
    t_name := t_name || text 'A Marks slab, not disqualified (sheet AG7:AG11 = 0 / 4 / 1 / 8 / 18)';
    select string_agg(e->>'n', '/' order by o) into s from jsonb_array_elements(r->'slabs') with ordinality t(e, o);
    t_det := t_det || (s); t_pass := t_pass || (s = '0/4/1/8/18');
    t_name := t_name || text 'A Male / Female, not disqualified (sheet AG13:AG14 = 24 / 7)';
    t_det := t_det || (r->'gender')::text;
    t_pass := t_pass || (r->'gender'->>'male' = '24' and r->'gender'->>'female' = '7' and r->'gender'->>'other' = '0');
    t_name := t_name || text 'A 35% and above, not disqualified: Overall 21/6/27 · ADYPU Pune 12/4/16 · Gurugram 9/2/11';
    t_det := t_det || (pg_temp.cut3(r)); t_pass := t_pass || (pg_temp.cut3(r) = '21/6/27|12/4/16|9/2/11');
    r2 := pg_temp.call_as(adm, pg_temp.rpc('vsat_exam_analysis', jsonb_build_object('exam_date_ids', jsonb_build_array(d), 'percentile', 60)));
    t_name := t_name || text 'A 60% and above, not disqualified: Overall 20/6/26 · ADYPU Pune 11/4/15 · Gurugram 9/2/11';
    t_det := t_det || (pg_temp.cut3(r2)); t_pass := t_pass || (pg_temp.cut3(r2) = '20/6/26|11/4/15|9/2/11');
    r2 := pg_temp.call_as(adm, pg_temp.rpc('vsat_exam_analysis', jsonb_build_object('exam_date_ids', jsonb_build_array(d), 'percentile', 65)));
    t_name := t_name || text 'A 65% and above, not disqualified: Overall 20/6/26 · ADYPU Pune 11/4/15 · Gurugram 9/2/11; VPS 7.4 on the curve';
    t_det := t_det || (pg_temp.cut3(r2) || ' vps ' || coalesce(r2->'cutoff'->>'vps', '-'));
    t_pass := t_pass || (pg_temp.cut3(r2) = '20/6/26|11/4/15|9/2/11' and (r2->'cutoff'->>'vps')::numeric = 7.4);
    t_name := t_name || text 'A highest / lowest of every taker: score 97.5 / 26.5 %, percentile 98 / 26';
    t_det := t_det || (format('%s %s %s %s', r->>'max_percentage', r->>'min_percentage', r->>'max_percentile', r->>'min_percentile'));
    t_pass := t_pass || ((r->>'max_percentage')::numeric = 97.5 and (r->>'min_percentage')::numeric = 26.5
                         and (r->>'max_percentile')::numeric = 98 and (r->>'min_percentile')::numeric = 26);
    r2 := pg_temp.call_as(admis, pg_temp.rpc('vsat_exam_analysis', jsonb_build_object('exam_date_ids', jsonb_build_array(d), 'percentile', 35)));
    t_name := t_name || text 'A admissions (all campuses) see the same numbers';
    t_det := t_det || (format('%s %s', r2->>'not_disqualified', pg_temp.cut3(r2)));
    t_pass := t_pass || (r2->>'not_disqualified' = '31' and pg_temp.cut3(r2) = '21/6/27|12/4/16|9/2/11');

    -- ════ B. the sheet columns on the grid ════
    update public.application_manager set registered_name = '  Ravi   Kumar Sharma ' where application_id = a_top;
    insert into public.vsat_exam_results (application_id, lead_id, wheebox_test_id, is_mock, obtained_marks, max_marks, percentile, raw, received_at)
    select a_top, am.lead_id, 'zz-ee-1', false, 90, 100, 98, jsonb_build_object('OVERALL', jsonb_build_object(
             'testName', 'ZZ OLD', 'test_start_time', '2026-07-14 09:00:00', 'test_end_time', '2026-07-14 09:30:00', 'totalQuestion', '50',
             'totalQuestionAttempted', 10, 'correctAttempt', '5', 'incorrectAttempt', '5', 'leftBlank', '40')), now() - interval '2 days'
      from public.application_manager am where am.application_id = a_top;
    insert into public.vsat_exam_results (application_id, lead_id, wheebox_test_id, is_mock, obtained_marks, max_marks, percentile, raw, received_at)
    select a_top, am.lead_id, 'zz-ee-1', false, 195, 200, 98, jsonb_build_object('OVERALL', jsonb_build_object(
             'testName', 'VSAT 14 July', 'test_start_time', '2026-07-14 10:00:05', 'test_end_time', '2026-07-14 11:02:35', 'totalQuestion', '50',
             'totalQuestionAttempted', 48, 'correctAttempt', '40', 'incorrectAttempt', '8', 'leftBlank', '2')), now() - interval '1 day'
      from public.application_manager am where am.application_id = a_top;
    insert into public.vsat_exam_results (application_id, lead_id, wheebox_test_id, is_mock, obtained_marks, max_marks, percentile, raw, received_at)
    select a_top, am.lead_id, 'OCT PM TEST', true, 3, 5, null, jsonb_build_object('OVERALL', jsonb_build_object(
             'testName', 'ZZ MOCK', 'test_start_time', '2026-07-15 09:00:00', 'test_end_time', '2026-07-15 09:10:00', 'totalQuestion', '5',
             'totalQuestionAttempted', 5, 'correctAttempt', '3', 'incorrectAttempt', '2', 'leftBlank', '0')), now()
      from public.application_manager am where am.application_id = a_top;
    select am.lead_id into lead from public.application_manager am where am.application_id = a_top;
    update public.application_manager set registered_name = 'Solo' where application_id = a_56;

    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', jsonb_build_object('exam_date_ids', jsonb_build_array(d),
           'search', jsonb_build_object('column', '_any', 'values', jsonb_build_array(a_top, a_56)), 'columns', sheet_cols)));
    select e into r2 from jsonb_array_elements(r->'rows') e where e->>'application_id' = a_top;
    t_name := t_name || text 'B First Name / Last Name split at the first space (extra spaces dropped), User Id = the student''s user id';
    t_det := t_det || (format('%s | %s | %s', r2->>'first_name', r2->>'last_name', (r2->>'user_id' = lead::text)));
    t_pass := t_pass || (r2->>'first_name' = 'Ravi' and r2->>'last_name' = 'Kumar Sharma' and r2->>'user_id' = lead::text);
    t_name := t_name || text 'B test-result columns from the latest REAL result (an older real one and a newer mock are ignored)';
    t_det := t_det || (format('%s|%s|%s|%s|%s|%s|%s|%s|%s', r2->>'exam_test_name', r2->>'exam_started_at', r2->>'exam_ended_at', r2->>'exam_time_taken',
                              r2->>'exam_total_questions', r2->>'exam_attempted', r2->>'exam_correct', r2->>'exam_incorrect', r2->>'exam_unattempted'));
    t_pass := t_pass || (r2->>'exam_test_name' = 'VSAT 14 July' and r2->>'exam_started_at' = '2026-07-14 10:00:05' and r2->>'exam_ended_at' = '2026-07-14 11:02:35'
                         and r2->>'exam_time_taken' = '01:02:30' and (r2->>'exam_total_questions')::numeric = 50 and (r2->>'exam_attempted')::numeric = 48
                         and (r2->>'exam_correct')::numeric = 40 and (r2->>'exam_incorrect')::numeric = 8 and (r2->>'exam_unattempted')::numeric = 2);
    select e into r2 from jsonb_array_elements(r->'rows') e where e->>'application_id' = a_56;
    t_name := t_name || text 'B one-word name: no Last Name; no Wheebox result: the test columns are empty';
    t_det := t_det || (left(r2::text, 300));
    t_pass := t_pass || (r2->>'first_name' = 'Solo' and r2->>'last_name' is null and r2->>'exam_test_name' is null and r2->>'exam_correct' is null);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', jsonb_build_object('exam_date_ids', jsonb_build_array(d),
           'search', jsonb_build_object('column', '_any', 'values', jsonb_build_array(a_top)), 'columns', '["registered_name", "exam_percentile"]'::jsonb)));
    t_name := t_name || text 'B not asked for → not looked up (no sheet keys in the row)';
    t_det := t_det || (left((r->'rows'->0)::text, 200));
    t_pass := t_pass || ((r->>'total')::int = 1 and not (r->'rows'->0 ? 'first_name') and not (r->'rows'->0 ? 'exam_correct'));
    r := pg_temp.call_as(adm, 'select public.vsat_grid_columns()');
    t_name := t_name || text 'B the 12 columns are offered (virtual, open, not filterable; test fields in the Exam group)';
    select count(*) into n from jsonb_array_elements(r->'columns') c
     where c->>'key' in (select jsonb_array_elements_text(sheet_cols)) and (c->>'virtual')::boolean and not (c->>'restricted')::boolean
       and not (c->>'filterable')::boolean and (c->>'key' not like 'exam\_%' or c->>'group' = 'Exam');
    t_det := t_det || (n::text); t_pass := t_pass || (n = 12);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', jsonb_build_object('filters', jsonb_build_array(jsonb_build_object('column', 'exam_correct', 'op', 'gt', 'v', 1)))));
    t_name := t_name || text 'B filtering on a sheet column is refused (no expression for it)';
    t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'BAD_VALUE: filters');

    -- ════ C. below the cut-off ════
    x_dq := pg_temp.mk_taker('ZZT-EE-X1', d, 40, 40, 'Male', 'pune');
    insert into public.vsat_proctoring (application_id, attempt_no, verdict, reason, set_by) values (x_dq, 1, 'disqualified', 'zz', adm);
    x_inel := pg_temp.mk_taker('ZZT-EE-X2', d, 45, 45, 'Male', 'pune');
    insert into public.vsat_overrides (application_id, field, value, reason, set_by) values (x_inel, 'eligible', 'false'::jsonb, 'zz not eligible', adm);
    x_hold := pg_temp.mk_taker('ZZT-EE-X3', d, 50, 50, 'Female', 'ggn');
    update public.vsat_pipeline set status = 'on_hold' where application_id = x_hold;
    x_none := pg_temp.mk_taker('ZZT-EE-X4', d, null, null, 'Male', 'pune');
    o_id := pg_temp.mk_taker('ZZT-EE-O1', d2, 70, 50, 'Male', 'pune');

    r := pg_temp.call_as(admis, pg_temp.rpc('vsat_exam_below_cutoff', jsonb_build_object('exam_date_id', d)));
    t_name := t_name || text 'C admissions cannot read the raise list (admins only)'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(null, pg_temp.rpc('vsat_exam_below_cutoff', jsonb_build_object('exam_date_id', d)), true);
    t_name := t_name || text 'C signed out → refused'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_exam_below_cutoff', jsonb_build_object('exam_date_id', d, 'percentile', 65)));
    t_name := t_name || text 'C unknown key refused'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' like 'UNKNOWN_KEY%');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_exam_below_cutoff', jsonb_build_object('exam_date_id', 'nope')));
    t_name := t_name || text 'C a bad VSAT id refused'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'BAD_VALUE: exam_date_id');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_exam_below_cutoff', jsonb_build_object('exam_date_id', d)));
    t_name := t_name || text 'C before the cut-off is decided: no cut-off, nobody listed';
    t_det := t_det || (r::text); t_pass := t_pass || (r->'vps_cutoff' = 'null'::jsonb and (r->>'total')::int = 0);

    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_select_for_pi', jsonb_build_object('exam_date_id', d, 'percentile', 65, 'apply', true)));
    select d0.cleared_vps_cutoff into cut from public.vsat_exam_dates d0 where d0.id = d;
    t_name := t_name || text 'C Select for PI at 65 moves the 26 (sheet: 65% and above, not disqualified) and saves VPS 7.4';
    t_det := t_det || (format('moved %s cut %s', r->>'moved', cut));
    t_pass := t_pass || ((r->>'moved')::int = 26 and cut = 7.4);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_exam_below_cutoff', jsonb_build_object('exam_date_id', d)));
    t_name := t_name || text 'C below the cut-off: the 5 below 65, highest VPS first; disqualified, ineligible, on hold, no result and selected left out';
    select string_agg(e->>'application_id', ',' order by o) into s from jsonb_array_elements(r->'students') with ordinality t(e, o);
    t_det := t_det || (coalesce(s, '-') || ' total ' || (r->>'total'));
    t_pass := t_pass || ((r->>'total')::int = 5 and s = 'ZZT-EE-31,ZZT-EE-28,ZZT-EE-32,ZZT-EE-11,ZZT-EE-05' and (r->>'vps_cutoff')::numeric = 7.4);
    t_name := t_name || text 'C each row carries percentile, %, VPS (calculated, no override yet), gender and campus';
    r2 := r->'students'->0;
    t_det := t_det || (r2::text);
    t_pass := t_pass || ((r2->>'percentile')::numeric = 56 and (r2->>'percentage')::numeric = 56.5 and (r2->>'vps')::numeric = 6.38
                         and r2->'vps_override' = 'null'::jsonb and r2->>'gender' = 'male' and r2->>'campus' = 'pune' and r2->>'stage' = 'exam_taken');

    -- ════ D. raise one student by hand ════
    r := pg_temp.call_as(admis, pg_temp.rpc('vsat_exam_raise', jsonb_build_object('application_id', a_56, 'vps', 7.4, 'reason', 'zz manager ok')));
    t_name := t_name || text 'D admissions cannot raise (admins only)'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(null, pg_temp.rpc('vsat_exam_raise', jsonb_build_object('application_id', a_56, 'vps', 7.4, 'reason', 'zz manager ok')), true);
    t_name := t_name || text 'D signed out → refused'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_exam_raise', jsonb_build_object('application_id', a_56, 'vps', 7.4, 'reason', 'zz manager ok', 'stage', 'pi_cleared')));
    t_name := t_name || text 'D unknown key refused'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' like 'UNKNOWN_KEY%');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_exam_raise', jsonb_build_object('application_id', a_56, 'vps', '7.4', 'reason', 'zz manager ok')));
    r2 := pg_temp.call_as(adm, pg_temp.rpc('vsat_exam_raise', jsonb_build_object('application_id', a_56, 'vps', 10.5, 'reason', 'zz manager ok')));
    t_name := t_name || text 'D VPS must be a number from 0 to 10'; t_det := t_det || (r::text || ' ' || r2::text);
    t_pass := t_pass || (r->>'message' = 'BAD_VALUE: vps' and r2->>'message' = 'BAD_VALUE: vps');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_exam_raise', jsonb_build_object('application_id', a_56, 'vps', 7.4, 'reason', 'ok')));
    t_name := t_name || text 'D a reason is required'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'REASON_REQUIRED');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_exam_raise', jsonb_build_object('application_id', a_26, 'vps', 7.39, 'reason', 'zz manager ok')));
    t_name := t_name || text 'D a VPS below the cut-off is refused and nothing changes';
    t_det := t_det || (r::text || ' ' || pg_temp.stage(a_26));
    t_pass := t_pass || (r->>'message' = 'BELOW_CUTOFF' and pg_temp.stage(a_26) = 'exam_taken:active'
                         and not exists (select 1 from public.vsat_overrides o where o.application_id = a_26));
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_exam_raise', jsonb_build_object('application_id', o_id, 'vps', 8, 'reason', 'zz manager ok')));
    t_name := t_name || text 'D a VSAT whose cut-off is not decided yet → NO_CUTOFF'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'NO_CUTOFF');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_exam_raise', jsonb_build_object('application_id', x_dq, 'vps', 8, 'reason', 'zz manager ok')));
    t_name := t_name || text 'D disqualified → refused'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'DISQUALIFIED');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_exam_raise', jsonb_build_object('application_id', x_hold, 'vps', 8, 'reason', 'zz manager ok')));
    t_name := t_name || text 'D on hold → refused'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'NOT_ACTIVE');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_exam_raise', jsonb_build_object('application_id', x_inel, 'vps', 8, 'reason', 'zz manager ok')));
    t_name := t_name || text 'D marked not eligible → refused'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'NOT_ELIGIBLE');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_exam_raise', jsonb_build_object('application_id', x_none, 'vps', 8, 'reason', 'zz manager ok')));
    t_name := t_name || text 'D no result → refused'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'NO_RESULT');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_exam_raise', jsonb_build_object('application_id', 'ZZT-EE-01', 'vps', 8, 'reason', 'zz manager ok')));
    t_name := t_name || text 'D already at VSAT cleared → refused'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'ALREADY_SELECTED');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_exam_raise', jsonb_build_object('application_id', 'ZZT-NOPE', 'vps', 8, 'reason', 'zz manager ok')));
    t_name := t_name || text 'D unknown student → NOT_IN_PIPELINE'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'NOT_IN_PIPELINE');

    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_exam_raise', jsonb_build_object('application_id', a_56, 'vps', 7.5, 'reason', 'zz female ratio, manager ok')));
    t_name := t_name || text 'D raise: VPS 7.5 and moved to VSAT cleared in one step';
    t_det := t_det || (r::text || ' ' || pg_temp.stage(a_56));
    t_pass := t_pass || ((r->>'moved')::boolean and r->>'from_stage' = 'exam_taken' and (r->>'vps')::numeric = 7.5 and pg_temp.stage(a_56) = 'vsat_cleared:active');
    t_name := t_name || text 'D the override keeps the calculated VPS next to it; history has the reason (manual)';
    select format('%s|%s|%s', o.value, ((o.calculated::text)::numeric = 6.38)::text, o.reason) into s
      from public.vsat_overrides o where o.application_id = a_56 and o.field = 'vps' and o.cleared_at is null;
    t_det := t_det || (coalesce(s, '-'));
    t_pass := t_pass || (s = '7.5|true|zz female ratio, manager ok'
                         and exists (select 1 from public.vsat_stage_history h where h.application_id = a_56 and h.to_stage = 'vsat_cleared'
                                       and h.source = 'manual' and h.reason like 'Raised by hand · ZZTEST VSAT-EE · VPS 7.5 (cut-off 7.40) · zz female ratio, manager ok'));
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', jsonb_build_object('search', jsonb_build_object('column', '_any', 'values', jsonb_build_array(a_56)),
           'columns', '["vps_effective", "stage"]'::jsonb)));
    t_name := t_name || text 'D the grid shows VPS 7.5 (override) and VSAT cleared';
    t_det := t_det || (left((r->'rows'->0)::text, 200));
    t_pass := t_pass || ((r->'rows'->0->>'vps_effective')::numeric = 7.5 and r->'rows'->0->>'stage' = 'vsat_cleared');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_exam_below_cutoff', jsonb_build_object('exam_date_id', d)));
    t_name := t_name || text 'D the raised student leaves the list (4 left)';
    t_det := t_det || (r->>'total'); t_pass := t_pass || ((r->>'total')::int = 4 and not exists (select 1 from jsonb_array_elements(r->'students') e where e->>'application_id' = a_56));
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_exam_raise', jsonb_build_object('application_id', a_56, 'vps', 8, 'reason', 'zz again')));
    t_name := t_name || text 'D raising again → ALREADY_SELECTED'; t_det := t_det || (r::text); t_pass := t_pass || (r->>'message' = 'ALREADY_SELECTED');

    insert into public.vsat_overrides (application_id, field, value, reason, set_by) values (a_30, 'vps', '5'::jsonb, 'zz earlier', adm);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_exam_raise', jsonb_build_object('application_id', a_30, 'vps', 7.4, 'reason', 'zz exactly at the cut-off')));
    t_name := t_name || text 'D VPS exactly at the cut-off is enough; an earlier override is closed as replaced (one live override)';
    select format('%s|%s', count(*) filter (where o.cleared_at is null), string_agg(o.clear_reason, ',') filter (where o.cleared_at is not null)) into s
      from public.vsat_overrides o where o.application_id = a_30 and o.field = 'vps';
    t_det := t_det || (r::text || ' ' || s);
    t_pass := t_pass || ((r->>'moved')::boolean and s = '1|replaced' and pg_temp.stage(a_30) = 'vsat_cleared:active');

    -- ════ E. access rules ════
    t_name := t_name || text 'E the RPCs: signed-in only, security definer, empty search_path';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat_exam_analysis', 'vsat_exam_below_cutoff', 'vsat_exam_raise')
       and not (has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
                and p.prosecdef and p.proconfig = array['search_path=""']);
    select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat_exam_analysis', 'vsat_exam_below_cutoff', 'vsat_exam_raise');
    t_det := t_det || (coalesce(s, 'all ok') || ' n=' || n); t_pass := t_pass || (s is null and n = 3);
    t_name := t_name || text 'E helper and grid functions: no browser role can run them; empty search_path';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat__exam_sheet_cols', 'vsat__grid', 'vsat__grid_catalog')
       and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')
            or p.proconfig is distinct from array['search_path=""']);
    select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat__exam_sheet_cols', 'vsat__grid', 'vsat__grid_catalog');
    t_det := t_det || (coalesce(s, 'all ok') || ' n=' || n); t_pass := t_pass || (s is null and n = 3);
    t_name := t_name || text 'E index for the result lookup exists';
    t_det := t_det || (coalesce(to_regclass('public.vsat_exam_results_app_idx')::text, '∅'));
    t_pass := t_pass || (to_regclass('public.vsat_exam_results_app_idx') is not null);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x2.n, x2.p, x2.d from unnest(t_name, t_pass, t_det) as x2(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_vsat_exam_evaluation_tests();
