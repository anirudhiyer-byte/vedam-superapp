-- VSAT Phase 3 · interview verdicts from Interview Evaluation, the form's columns on the Interview table, the PI-cleared
-- email queue — tests for migration 0173 (STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the Supabase MCP.
-- The last statement returns one row per test: test | pass | detail.
--
-- A. The verdict rule · B. the form saves the verdict once the scores are decided · C. vsat_interview_analysis (the sheet's
--    table: average / highest / lowest / median final score, ranges) · D. vsat_interview_set_verdicts · E. the Interview
--    table columns and the verdict filter · F. the PI-cleared email queue · G. the profile's Final Verdict · H. access.
--
-- Scores use the weights in force today (0.25 / 0.25 / 0.20 / 0.15 / 0.15 since 2 Apr 2026): five 4s → weighted 4.00,
-- final score (× 4) 16.
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

-- a student of VSAT p_date moved (as the system) to "VSAT cleared"
create or replace function pg_temp.mk_app(p_id text, p_date uuid)
returns text language plpgsql as $$
declare u uuid := pg_temp.mk_user(lower(p_id) || '@example.invalid');
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, lead_stage) values (u, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', 'applicant_paid')
  on conflict (lead_id) do nothing;
  insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email, campus_applied, exam_date_id)
  values (p_id, u, p_id, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', 'Ajeenkya DY Patil University — Pune', p_date);
  perform public.vsat__move(p_id, 'vsat_cleared', 'active', 'zz test', 'system', null, null);
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
returns text language sql as $$ select format('select to_jsonb(public.%I(%L::jsonb))', p_fn, p::text) $$;

create or replace function pg_temp.st(p_app text)
returns text language sql as $$ select vp.stage || '/' || vp.status from public.vsat_pipeline vp where vp.application_id = p_app $$;

-- book an interview (as admin) and, when p_score is given, submit the form with five equal parts
create or replace function pg_temp.interview(p_adm uuid, p_int uuid, p_app text, p_slot interval, p_score int, p_cheat boolean)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  r := pg_temp.call_as(p_adm, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', p_app, 'interviewer_id', p_int,
         'slot_datetime', now() + p_slot, 'duration_min', 30, 'auto_meet', true)));
  if r ? 'sqlstate' then return r; end if;
  if p_score is null then return r; end if;
  return pg_temp.call_as(p_adm, pg_temp.rpc('vsat_submit_interview', jsonb_build_object('application_id', p_app,
           'communication', p_score, 'logic', p_score, 'passion', p_score, 'achievements', p_score, 'why_program', p_score,
           'cheating_seen', p_cheat, 'remarks', jsonb_build_object('communication', 'zz comm ' || p_app, 'logic', 'zz logic'),
           'coding_talent', false, 'cert_asked', true, 'drop_year', false, 'previous_jee', 'N/A', 'jee_pct', 91.5,
           'other_exams', 'N/A', 'class10_pct', 88, 'class11_pct', 80, 'class12_pct', 85, 'financial_capability', 'medium',
           'financial_reason', 'zz salaried', 'why_accept', 'zz why ' || p_app)));
end $$;

create or replace function pg_temp.verdict(p_app text)
returns text language sql as $$
  select coalesce(a.verdict, 'null') from public.interview_assignments a where a.application_id = p_app order by a.created_at desc limit 1
$$;

create or replace function pg_temp.run_vsat_interview_evaluation_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; admis uuid; int1 uuid; int2 uuid; cou uuid; nobody uuid; d uuid; d2 uuid;
  s20 text; s16 text; s12 text; s8 text; s4 text; sch text; swait text; sother text; slate text;
  r jsonb; r2 jsonb; s text; n int;
begin
  begin -- rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('zztest-ie-admin@example.invalid');
    insert into public.user_roles (user_id, role) values (adm, 'admin');
    admis := pg_temp.mk_user('zztest-ie-admissions@example.invalid');
    int1 := pg_temp.mk_user('zztest-ie-int@example.invalid');
    int2 := pg_temp.mk_user('zztest-ie-int2@example.invalid');
    cou := pg_temp.mk_user('zztest-ie-couns@example.invalid');
    nobody := pg_temp.mk_user('zztest-ie-nobody@example.invalid');
    insert into public.vsat_team (user_id, role, campus) values (admis, 'admissions', null), (int1, 'interviewer', null), (int2, 'interviewer', null), (cou, 'counsellor', null);
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at)
    values ('ZZTEST VSAT-IE', 'zz-ie-1', current_date, now(), now() + interval '2 hours') returning id into d;
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at)
    values ('ZZTEST VSAT-IE2', 'zz-ie-2', current_date, now(), now() + interval '2 hours') returning id into d2;

    s20 := pg_temp.mk_app('ZZT-IE-20', d); s16 := pg_temp.mk_app('ZZT-IE-16', d); s12 := pg_temp.mk_app('ZZT-IE-12', d);
    s8 := pg_temp.mk_app('ZZT-IE-08', d);  s4 := pg_temp.mk_app('ZZT-IE-04', d);  sch := pg_temp.mk_app('ZZT-IE-CH', d);
    swait := pg_temp.mk_app('ZZT-IE-WT', d); sother := pg_temp.mk_app('ZZT-IE-OT', d2); slate := pg_temp.mk_app('ZZT-IE-LT', d);

    -- ════ A. the verdict rule ════
    t_name := t_name || text 'A rule: ≥ selected → selected, ≥ maybe → maybe, else rejected; cheating → rejected; no scores → none';
    s := concat_ws(',', public.vsat__interview_verdict(16, false, 16, 10), public.vsat__interview_verdict(15.99, false, 16, 10),
                   public.vsat__interview_verdict(10, false, 16, 10), public.vsat__interview_verdict(9.99, false, 16, 10),
                   public.vsat__interview_verdict(20, true, 16, 10), public.vsat__interview_verdict(20, true, null, null),
                   coalesce(public.vsat__interview_verdict(20, false, null, null), 'null'), coalesce(public.vsat__interview_verdict(null, false, 16, 10), 'null'));
    t_det := t_det || s;
    t_pass := t_pass || (s = 'selected,maybe,maybe,not_selected,not_selected,not_selected,null,null');

    -- ════ B. the form, before any scores are decided ════
    r := pg_temp.interview(adm, int1, s20, interval '1 day', 5, false);
    perform pg_temp.interview(adm, int1, s16, interval '1 day 1 hour', 4, false);
    perform pg_temp.interview(adm, int1, s12, interval '1 day 2 hours', 3, false);
    perform pg_temp.interview(adm, int1, s8,  interval '1 day 3 hours', 2, false);
    perform pg_temp.interview(adm, int1, s4,  interval '1 day 4 hours', 1, false);
    r2 := pg_temp.interview(adm, int1, sch, interval '1 day 5 hours', 4, true);
    perform pg_temp.interview(adm, int1, swait, interval '1 day 6 hours', null, null);
    perform pg_temp.interview(adm, int2, sother, interval '1 day 7 hours', 5, false);
    t_name := t_name || text 'B scores not decided yet: the form saves no verdict (interview_result_1 empty), the old fields stay as before';
    select am.interview_result_1 into s from public.application_manager am where am.application_id = s20;
    t_det := t_det || format('%s verdict=%s result_1=%s score=%s calc=%s', left(r::text, 200), pg_temp.verdict(s20), coalesce(s, 'null'),
                             r->>'score', r->>'calc_verdict');
    t_pass := t_pass || (not (r ? 'sqlstate') and pg_temp.verdict(s20) = 'null' and s is null and (r->>'score')::numeric = 5
                         and r->>'calc_verdict' = 'selected' and (r->'verdict') = 'null'::jsonb
                         and (select a.result from public.interview_assignments a where a.application_id = s20) = 'selected');
    t_name := t_name || text 'B cheating ("Yes, and hence Reject Straight Away") → Rejected at once, before any scores';
    select am.interview_result_1 into s from public.application_manager am where am.application_id = sch;
    t_det := t_det || format('%s verdict=%s result_1=%s', left(r2::text, 160), pg_temp.verdict(sch), coalesce(s, 'null'));
    t_pass := t_pass || (pg_temp.verdict(sch) = 'not_selected' and s = 'not_selected' and r2->>'verdict' = 'not_selected');
    t_name := t_name || text 'B the stage does not move when the form is saved';
    t_det := t_det || concat_ws(',', pg_temp.st(s20), pg_temp.st(sch), pg_temp.st(swait));
    t_pass := t_pass || (pg_temp.st(s20) = 'vsat_cleared/active' and pg_temp.st(sch) = 'vsat_cleared/active');

    -- ════ C. analysis ════
    r := pg_temp.call_as(admis, pg_temp.rpc('vsat_interview_analysis', jsonb_build_object('exam_date_id', d)));
    t_name := t_name || text 'C counts: booked 7, interviewed 6, waiting 1, cheating 1 (the other VSAT left out)';
    t_det := t_det || format('booked=%s interviewed=%s waiting=%s cheating=%s', r->>'booked', r->>'interviewed', r->>'waiting', r->>'cheating');
    t_pass := t_pass || ((r->>'booked')::int = 7 and (r->>'interviewed')::int = 6 and (r->>'waiting')::int = 1 and (r->>'cheating')::int = 1);
    t_name := t_name || text 'C the sheet''s table, everyone: avg 12.67, highest 20, lowest 4, median 14 (final = weighted × 4)';
    t_det := t_det || (r->'summary'->0)::text;
    t_pass := t_pass || (r->'summary'->0->>'key' = 'all' and (r->'summary'->0->>'n')::int = 6 and (r->'summary'->0->>'avg')::numeric = 12.67
                         and (r->'summary'->0->>'max')::numeric = 20 and (r->'summary'->0->>'min')::numeric = 4 and (r->'summary'->0->>'median')::numeric = 14);
    t_name := t_name || text 'C no scores yet: 5 not decided, the cheating one already Rejected';
    t_det := t_det || ((r->'ranges')::text || ' used=' || (r->'used')::text);
    t_pass := t_pass || ((r->'ranges'->>'undecided')::int = 5 and (r->'ranges'->>'not_selected')::int = 1 and (r->'ranges'->>'selected')::int = 0
                         and (r->'used'->>'select_min') is null);

    r := pg_temp.call_as(admis, pg_temp.rpc('vsat_interview_analysis', jsonb_build_object('exam_date_id', d, 'select_min', 16, 'maybe_min', 10)));
    t_name := t_name || text 'C preview 16 / 10: Selected 2 (avg 18, 20–16, median 18), Maybe 1 (12), Rejected 3 (avg 9.33, 16–4, median 8)';
    t_det := t_det || ((r->'ranges')::text || ' ' || (r->'summary')::text);
    t_pass := t_pass || ((r->'ranges'->>'selected')::int = 2 and (r->'ranges'->>'maybe')::int = 1 and (r->'ranges'->>'not_selected')::int = 3
                         and (r->'ranges'->>'undecided')::int = 0
                         and (r->'summary'->1->>'avg')::numeric = 18 and (r->'summary'->1->>'max')::numeric = 20 and (r->'summary'->1->>'min')::numeric = 16
                         and (r->'summary'->1->>'median')::numeric = 18 and (r->'summary'->2->>'avg')::numeric = 12
                         and (r->'summary'->3->>'avg')::numeric = 9.33 and (r->'summary'->3->>'max')::numeric = 16 and (r->'summary'->3->>'min')::numeric = 4
                         and (r->'summary'->3->>'median')::numeric = 8 and (r->'used'->>'preview')::boolean);
    t_name := t_name || text 'C a preview saves nothing; the student list is highest first with weighted and final scores';
    t_det := t_det || format('saved=%s verdict16=%s first=%s', r->'saved'->>'select_min', pg_temp.verdict(s16), r->'students'->0);
    t_pass := t_pass || (r->'saved'->>'select_min' is null and pg_temp.verdict(s16) = 'null'
                         and r->'students'->0->>'application_id' = s20 and (r->'students'->0->>'weighted')::numeric = 5
                         and (r->'students'->0->>'final')::numeric = 20 and r->'students'->0->>'verdict_preview' = 'selected'
                         and jsonb_array_length(r->'students') = 6);

    s := '';
    r := pg_temp.call_as(admis, pg_temp.rpc('vsat_interview_analysis', jsonb_build_object('exam_date_id', d, 'select_min', 10, 'maybe_min', 16))); s := s || (r->>'message') || ' | ';
    r := pg_temp.call_as(admis, pg_temp.rpc('vsat_interview_analysis', jsonb_build_object('exam_date_id', d, 'select_min', 16))); s := s || (r->>'message') || ' | ';
    r := pg_temp.call_as(admis, pg_temp.rpc('vsat_interview_analysis', jsonb_build_object('exam_date_id', d, 'select_min', 21, 'maybe_min', 10))); s := s || (r->>'message') || ' | ';
    r := pg_temp.call_as(admis, pg_temp.rpc('vsat_interview_analysis', jsonb_build_object('exam_date_id', 'nope'))); s := s || (r->>'message') || ' | ';
    r := pg_temp.call_as(admis, pg_temp.rpc('vsat_interview_analysis', jsonb_build_object('exam_date_id', d, 'extra', 1))); s := s || (r->>'message');
    t_name := t_name || text 'C bad input refused (maybe above selected, one score only, above 20, bad VSAT, unknown key)';
    t_det := t_det || s;
    t_pass := t_pass || (s = 'BAD_VALUE: maybe_min | BAD_VALUE: maybe_min | BAD_VALUE: select_min | BAD_VALUE: exam_date_id | UNKNOWN_KEY: extra');

    -- ════ D. save the scores ════
    r := pg_temp.call_as(admis, pg_temp.rpc('vsat_interview_set_verdicts', jsonb_build_object('exam_date_id', d, 'select_min', 16, 'maybe_min', 10)));
    t_name := t_name || text 'D admissions cannot decide the verdicts (admin only, as Select for PI)';
    t_det := t_det || (r->>'message'); t_pass := t_pass || (r->>'message' = 'FORBIDDEN');

    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_interview_set_verdicts', jsonb_build_object('exam_date_id', d, 'select_min', 16, 'maybe_min', 10)));
    t_name := t_name || text 'D admin saves 16 / 10: 2 Selected, 1 Maybe, 3 Rejected; 5 rows changed (the cheating one already was)';
    t_det := t_det || r::text;
    t_pass := t_pass || ((r->'counts'->>'selected')::int = 2 and (r->'counts'->>'maybe')::int = 1 and (r->'counts'->>'not_selected')::int = 3
                         and (r->>'changed')::int = 5);
    t_name := t_name || text 'D each student''s verdict, and interview_result_1 the same';
    select string_agg(x.application_id || '=' || coalesce(x.verdict, 'null') || '/' || coalesce(am.interview_result_1, 'null'), ',' order by x.application_id) into s
      from public.interview_assignments x join public.application_manager am using (application_id)
     where x.application_id in (s20, s16, s12, s8, s4, sch, swait, sother);
    t_det := t_det || s;
    t_pass := t_pass || (s = 'ZZT-IE-04=not_selected/not_selected,ZZT-IE-08=not_selected/not_selected,ZZT-IE-12=maybe/maybe,'
                             'ZZT-IE-16=selected/selected,ZZT-IE-20=selected/selected,ZZT-IE-CH=not_selected/not_selected,'
                             'ZZT-IE-OT=null/null,ZZT-IE-WT=null/null');
    t_name := t_name || text 'D no stage moves; the scores are saved on the VSAT with who and when; audit row written';
    select count(*) into n from public.vsat_settings_audit a where a.area = 'vsat' and a.target = d::text and a.user_id = adm and a.after ? 'interview_select_min';
    select format('%s/%s by=%s at=%s', e.interview_select_min, e.interview_maybe_min, (e.interview_verdicts_by = adm)::text, (e.interview_verdicts_at is not null)::text)
      into s from public.vsat_exam_dates e where e.id = d;
    t_det := t_det || format('%s | audit=%s | %s %s', s, n, pg_temp.st(s20), pg_temp.st(s4));
    t_pass := t_pass || (s = '16/10 by=true at=true' and n = 1 and pg_temp.st(s20) = 'vsat_cleared/active' and pg_temp.st(s4) = 'vsat_cleared/active');

    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_interview_set_verdicts', jsonb_build_object('exam_date_id', d, 'select_min', 16, 'maybe_min', 10)));
    t_name := t_name || text 'D saving the same scores again changes nothing';
    t_det := t_det || (r->>'changed'); t_pass := t_pass || ((r->>'changed')::int = 0);

    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_interview_set_verdicts', jsonb_build_object('exam_date_id', d, 'select_min', 12, 'maybe_min', 8)));
    t_name := t_name || text 'D new scores 12 / 8 re-decide everyone (12 → Selected, 8 → Maybe)';
    t_det := t_det || format('%s 12=%s 8=%s 4=%s ch=%s', r->'counts', pg_temp.verdict(s12), pg_temp.verdict(s8), pg_temp.verdict(s4), pg_temp.verdict(sch));
    t_pass := t_pass || (pg_temp.verdict(s12) = 'selected' and pg_temp.verdict(s8) = 'maybe' and pg_temp.verdict(s4) = 'not_selected'
                         and pg_temp.verdict(sch) = 'not_selected' and (r->>'changed')::int = 2);

    r := pg_temp.interview(adm, int1, slate, interval '1 day 8 hours', 3, false);
    t_name := t_name || text 'D a form saved after the scores are decided gets its verdict at once (12 ≥ 12 → Selected)';
    t_det := t_det || format('%s verdict=%s', r->>'verdict', pg_temp.verdict(slate));
    t_pass := t_pass || (r->>'verdict' = 'selected' and pg_temp.verdict(slate) = 'selected'
                         and (select am.interview_result_1 from public.application_manager am where am.application_id = slate) = 'selected');

    r := pg_temp.call_as(admis, pg_temp.rpc('vsat_interview_analysis', jsonb_build_object('exam_date_id', d)));
    t_name := t_name || text 'D the analysis shows the saved scores and saved verdicts (who saved them)';
    t_det := t_det || format('%s used=%s %s', r->'saved', r->'used', r->'ranges');
    t_pass := t_pass || ((r->'saved'->>'select_min')::numeric = 12 and (r->'saved'->>'maybe_min')::numeric = 8 and r->'saved'->>'set_by' like 'ZZTEST%'
                         and not (r->'used'->>'preview')::boolean and (r->'ranges'->>'selected')::int = 4);

    s := '';
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_interview_set_verdicts', jsonb_build_object('exam_date_id', d, 'select_min', 8, 'maybe_min', 12))); s := s || (r->>'message') || ' | ';
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_interview_set_verdicts', jsonb_build_object('exam_date_id', d, 'select_min', -1, 'maybe_min', 0))); s := s || (r->>'message') || ' | ';
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_interview_set_verdicts', jsonb_build_object('exam_date_id', d, 'maybe_min', 0))); s := s || (r->>'message') || ' | ';
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_interview_set_verdicts', jsonb_build_object('exam_date_id', gen_random_uuid(), 'select_min', 12, 'maybe_min', 8))); s := s || (r->>'message');
    t_name := t_name || text 'D bad input refused (maybe above selected, below 0, missing score, unknown VSAT)';
    t_det := t_det || s;
    t_pass := t_pass || (s = 'BAD_VALUE: maybe_min | BAD_VALUE: select_min | BAD_VALUE: select_min | BAD_VALUE: exam_date_id');

    -- ════ E. Interview table ════
    r := pg_temp.call_as(admis, pg_temp.rpc('vsat_grid_list', jsonb_build_object('application_ids', jsonb_build_array(s20), 'columns',
           jsonb_build_array('interview_submitted_at', 'iv_communication', 'iv_communication_remarks', 'iv_logic', 'iv_logic_remarks', 'iv_cert_asked',
                             'iv_previous_jee', 'iv_jee_pct', 'iv_class11_pct', 'iv_financial', 'iv_financial_reason', 'iv_why_accept',
                             'interview_verdict', 'interview_score', 'interview_final_score'))));
    t_name := t_name || text 'E the form''s answers, the verdict, weighted and final score are columns of the table';
    r2 := r->'rows'->0;
    t_det := t_det || left(coalesce(r2, r)::text, 400);
    t_pass := t_pass || (r2->>'interview_submitted_at' is not null and (r2->>'iv_communication')::numeric = 5 and r2->>'iv_communication_remarks' = 'zz comm ZZT-IE-20'
                         and r2->>'iv_logic_remarks' = 'zz logic' and (r2->>'iv_cert_asked')::boolean and r2->>'iv_previous_jee' = 'N/A'
                         and (r2->>'iv_jee_pct')::numeric = 91.5 and (r2->>'iv_class11_pct')::numeric = 80 and r2->>'iv_financial' = 'medium'
                         and r2->>'iv_financial_reason' = 'zz salaried' and r2->>'iv_why_accept' = 'zz why ZZT-IE-20'
                         and r2->>'interview_verdict' = 'selected' and (r2->>'interview_score')::numeric = 5 and (r2->>'interview_final_score')::numeric = 20);

    r := pg_temp.call_as(admis, pg_temp.rpc('vsat_grid_list', jsonb_build_object('exam_date_ids', jsonb_build_array(d), 'columns', jsonb_build_array('interview_verdict'),
           'filters', jsonb_build_array(jsonb_build_object('column', 'interview_verdict', 'op', 'eq', 'v', 'selected')))));
    select string_agg(e->>'application_id', ',' order by e->>'application_id') into s from jsonb_array_elements(r->'rows') e;
    t_name := t_name || text 'E filter Verdict = selected finds exactly the Selected students (to move them to PI cleared)';
    t_det := t_det || coalesce(s, left(r::text, 200));
    t_pass := t_pass || (s = 'ZZT-IE-12,ZZT-IE-16,ZZT-IE-20,ZZT-IE-LT');
    r := pg_temp.call_as(admis, pg_temp.rpc('vsat_grid_list', jsonb_build_object('exam_date_ids', jsonb_build_array(d), 'columns', jsonb_build_array('interview_final_score'),
           'filters', jsonb_build_array(jsonb_build_object('column', 'interview_final_score', 'op', 'lt', 'v', '10')))));
    select string_agg(e->>'application_id', ',' order by e->>'application_id') into s from jsonb_array_elements(r->'rows') e;
    t_name := t_name || text 'E filter Final score < 10';
    t_det := t_det || coalesce(s, left(r::text, 200)); t_pass := t_pass || (s = 'ZZT-IE-04,ZZT-IE-08');

    r := pg_temp.call_as(admis, 'select public.vsat_grid_columns()');
    select string_agg(c->>'key' || ':' || coalesce(c->>'filterable', 'null'), ',' order by c->>'key') into s
      from jsonb_array_elements(r->'columns') c where c->>'key' in ('interview_verdict', 'interview_final_score', 'iv_why_accept', 'interview_calc_verdict', 'interviewer_verdict');
    t_name := t_name || text 'E catalogue: verdict + final score filterable; the interviewer''s and the "lowest part" verdicts are gone';
    t_det := t_det || coalesce(s, 'none');
    t_pass := t_pass || (s = 'interview_final_score:true,interview_verdict:true,iv_why_accept:false');
    r := pg_temp.call_as(admis, pg_temp.rpc('vsat_grid_list', jsonb_build_object('columns', jsonb_build_array('interview_calc_verdict'))));
    t_name := t_name || text 'E asking for a removed column is refused';
    t_det := t_det || coalesce(r->>'message', left(r::text, 100)); t_pass := t_pass || (r->>'message' = 'BAD_VALUE: columns');

    r := pg_temp.call_as(int1, pg_temp.rpc('vsat_grid_list', jsonb_build_object('application_ids', jsonb_build_array(s20, sother), 'columns', jsonb_build_array('iv_why_accept'))));
    t_name := t_name || text 'E the interviewer sees the answers of their own students only (row rules unchanged)';
    select string_agg(e->>'application_id', ',' order by e->>'application_id') into s from jsonb_array_elements(r->'rows') e;
    t_det := t_det || coalesce(s, left(r::text, 200)); t_pass := t_pass || (s = 'ZZT-IE-20');

    -- ════ F. the PI-cleared email queue ════
    perform public.vsat__move(s20, 'interviewed', 'active', 'zz test', 'system', null, null);
    perform public.vsat__move(s20, 'pi_cleared', 'active', 'zz test', 'system', null, null);
    t_name := t_name || text 'F becoming PI cleared (active) queues one email';
    select count(*) into n from public.vsat_stage_notices sn where sn.application_id = s20 and sn.stage = 'pi_cleared' and sn.notify_status = 'pending';
    t_det := t_det || n::text; t_pass := t_pass || (n = 1);
    perform public.vsat__move(s20, 'interviewed', 'active', 'zz back', 'system', null, null);
    perform public.vsat__move(s20, 'pi_cleared', 'active', 'zz again', 'system', null, null);
    t_name := t_name || text 'F moving back and forth does not queue a second email';
    select count(*) into n from public.vsat_stage_notices sn where sn.application_id = s20;
    t_det := t_det || n::text; t_pass := t_pass || (n = 1);
    perform public.vsat__move(s16, 'interviewed', 'active', 'zz test', 'system', null, null);
    perform public.vsat__move(s16, 'pi_cleared', 'on_hold', 'zz hold', 'system', null, null);
    select count(*) into n from public.vsat_stage_notices sn where sn.application_id = s16;
    perform public.vsat__move(s16, 'pi_cleared', 'active', 'zz active', 'system', null, null);
    t_name := t_name || text 'F PI cleared on hold queues nothing; when made active it does';
    t_det := t_det || format('hold=%s active=%s', n, (select count(*) from public.vsat_stage_notices sn where sn.application_id = s16));
    t_pass := t_pass || (n = 0 and (select count(*) from public.vsat_stage_notices sn where sn.application_id = s16) = 1);
    perform public.vsat__move(s12, 'interviewed', 'active', 'zz test', 'system', null, null);
    perform public.vsat__move(s12, 'pi_cleared', 'active', 'zz test', 'system', null, null);
    perform public.vsat__move(s12, 'interviewed', 'active', 'zz back', 'system', null, null);

    r := public.vsat_stage_notices_claim(jsonb_build_object('application_ids', jsonb_build_array(s20, s16, s12)));
    t_name := t_name || text 'F claim: hands out the two current ones with the student''s email; the one moved away is skipped';
    select string_agg(e->'student'->>'application_no' || ':' || (e->'student'->>'email'), ',' order by e->'student'->>'application_no') into s from jsonb_array_elements(r) e;
    t_det := t_det || (coalesce(s, 'none') || ' | ' || (select notify_status || '/' || coalesce(notify_detail->>'why', '') from public.vsat_stage_notices where application_id = s12));
    t_pass := t_pass || (s = 'ZZT-IE-16:zzt-ie-16@example.invalid,ZZT-IE-20:zzt-ie-20@example.invalid'
                         and (select notify_status from public.vsat_stage_notices where application_id = s12) = 'skipped');
    r2 := public.vsat_stage_notice_done(jsonb_build_object('id', r->0->>'id', 'status', 'sent', 'detail', jsonb_build_object('sent_to', jsonb_build_array('student'))));
    r2 := public.vsat_stage_notice_done(jsonb_build_object('id', r->1->>'id', 'status', 'failed', 'detail', '{}'::jsonb));
    t_name := t_name || text 'F done: sent stays sent; a failed one goes back to the queue (retried by the cron)';
    select string_agg(notify_status, ',' order by notify_status) into s from public.vsat_stage_notices where application_id in (s20, s16);
    t_det := t_det || s; t_pass := t_pass || (s = 'pending,sent');
    r := public.vsat_stage_notices_claim(jsonb_build_object('application_ids', jsonb_build_array(s20)));
    t_name := t_name || text 'F a sent email is never handed out again';
    t_det := t_det || r::text; t_pass := t_pass || (r = '[]'::jsonb);

    t_name := t_name || text 'F the "PI cleared → student" step exists, off and in test mode';
    select format('%s/%s/%s', enabled::text, test_mode::text, email_enabled::text) into s from public.vsat_comm_steps where step_key = 'pi_cleared';
    t_det := t_det || coalesce(s, 'missing'); t_pass := t_pass || (s = 'false/true/true');

    -- ════ G. the profile's Final Verdict ════
    insert into public.counselling_assignments (application_id, attempt_no, counsellor_id, slot_datetime) values (s16, 1, cou, now() + interval '3 days');
    r := pg_temp.call_as(cou, format('select public.vsat_profile_start(%L)', s16));
    select string_agg(e->>0 || '=' || (e->>1), ',') into s from jsonb_array_elements(r->'fields') e where e->>0 = 'Final Verdict';
    t_name := t_name || text 'G the counsellor''s profile reads the Interview Evaluation verdict as "Final Verdict"';
    t_det := t_det || coalesce(s, left(r::text, 200)); t_pass := t_pass || (s = 'Final Verdict=selected');

    -- ════ H. access ════
    r := pg_temp.call_as(null, pg_temp.rpc('vsat_interview_analysis', jsonb_build_object('exam_date_id', d)), 'anon');
    r2 := pg_temp.call_as(nobody, pg_temp.rpc('vsat_interview_analysis', jsonb_build_object('exam_date_id', d)));
    s := concat_ws(' | ', r->>'sqlstate', r2->>'message');
    r := pg_temp.call_as(int1, pg_temp.rpc('vsat_interview_analysis', jsonb_build_object('exam_date_id', d)));
    r2 := pg_temp.call_as(cou, pg_temp.rpc('vsat_interview_set_verdicts', jsonb_build_object('exam_date_id', d, 'select_min', 1, 'maybe_min', 0)));
    s := concat_ws(' | ', s, r->>'message', r2->>'message');
    t_name := t_name || text 'H analysis: signed out / no role / interviewer refused; set: counsellor refused';
    t_det := t_det || s; t_pass := t_pass || (s = '42501 | FORBIDDEN | FORBIDDEN | FORBIDDEN');

    t_name := t_name || text 'H functions: security definer + empty search_path; RPCs for signed-in users only; helpers and the outbox server-only';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and (
       (p.proname in ('vsat_interview_analysis', 'vsat_interview_set_verdicts')
          and (not p.prosecdef or p.proconfig is distinct from array['search_path=""'] or has_function_privilege('anon', p.oid, 'execute')
               or not has_function_privilege('authenticated', p.oid, 'execute')))
       or (p.proname in ('vsat_stage_notices_claim', 'vsat_stage_notice_done', 'vsat__on_stage_notice')
          and (not p.prosecdef or p.proconfig is distinct from array['search_path=""'] or has_function_privilege('anon', p.oid, 'execute')
               or has_function_privilege('authenticated', p.oid, 'execute')))
       or (p.proname = 'vsat__interview_verdict'
          and (p.proconfig is distinct from array['search_path=""'] or has_function_privilege('authenticated', p.oid, 'execute'))));
    t_det := t_det || coalesce(s, 'ok'); t_pass := t_pass || (s is null);
    t_name := t_name || text 'H the outbox table: RLS on, browsers cannot read it';
    select format('rls=%s anon=%s auth=%s', c.relrowsecurity::text, has_table_privilege('anon', c.oid, 'select')::text, has_table_privilege('authenticated', c.oid, 'select')::text)
      into s from pg_class c where c.oid = 'public.vsat_stage_notices'::regclass;
    t_det := t_det || s; t_pass := t_pass || (s = 'rls=true anon=false auth=false');

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_vsat_interview_evaluation_tests();
