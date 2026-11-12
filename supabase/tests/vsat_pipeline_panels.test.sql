-- VSAT pipeline · panel RPC tests for migration 0081 (STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the
-- Supabase MCP. The last statement returns one row per test: test | pass | detail.
-- Also run vsat_pipeline_scoring.test.sql (0079) and vsat_pipeline_stage_engine.test.sql (0080).
--
-- Nothing is left behind: all test data is created inside a block that is rolled back with a
-- private error code at the end. Fake data only (@example.invalid, ZZTEST names).

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

-- applicant at "vsat_cleared" with exam result and marks (VSAT 80% → 40/50)
create or replace function pg_temp.mk_app(p_id text, p_campus text, p_date uuid)
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
    2024, 90, 85, 2026, 80, 70, 70, 70, 70, false, null, null, 80, 40, 50, 8.43);
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

create or replace function pg_temp.run_vsat_panels_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; adm_all uuid; int1 uuid; int2 uuid; cou1 uuid; usr uuid; d uuid; a1 text; a2 text; a3 text;
  r jsonb; s text; slot text := to_char(now() + interval '3 days', 'YYYY-MM-DD"T"HH24:00:00"Z"');
  form jsonb;
begin
  begin -- rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('zztest-pnl-admin@example.invalid');
    insert into public.user_roles (user_id, role) values (adm, 'admin');
    adm_all := pg_temp.mk_user('zztest-pnl-adm@example.invalid');
    int1 := pg_temp.mk_user('zztest-pnl-int1@example.invalid');
    int2 := pg_temp.mk_user('zztest-pnl-int2@example.invalid');
    cou1 := pg_temp.mk_user('zztest-pnl-cou1@example.invalid');
    usr  := pg_temp.mk_user('zztest-pnl-user@example.invalid');
    insert into public.vsat_team (user_id, role) values (adm_all, 'admissions'), (int1, 'interviewer'), (int2, 'interviewer'), (cou1, 'counsellor');
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at)
    values ('ZZTEST panel batch', 'zz-pnl', current_date, now(), now() + interval '2 hours') returning id into d;
    a1 := pg_temp.mk_app('ZZT-PNL-1', 'Ajeenkya DY Patil University — Pune', d);
    a2 := pg_temp.mk_app('ZZT-PNL-2', 'Sushant University — Gurugram', d);
    a3 := pg_temp.mk_app('ZZT-PNL-3', 'Sushant University — Gurugram', d);

    -- ════ A. lookups ════
    r := pg_temp.call_as(adm_all, 'select public.vsat_team_list()');
    t_name := t_name || text 'A team list for admissions has the interviewers and counsellor';
    t_det := t_det || left(r::text, 300);
    t_pass := t_pass || (r @> jsonb_build_array(jsonb_build_object('user_id', int1, 'roles', '["interviewer"]'::jsonb))
                         and r @> jsonb_build_array(jsonb_build_object('user_id', cou1, 'roles', '["counsellor"]'::jsonb)));
    r := pg_temp.call_as(int1, 'select public.vsat_team_list()');
    t_name := t_name || text 'A interviewers cannot read the team list'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(int1, 'select public.vsat_batches()');
    t_name := t_name || text 'A any VSAT role can read batches; anchors fall back to Exam Center';
    t_det := t_det || left(r::text, 200);
    t_pass := t_pass || exists (select 1 from jsonb_array_elements(r) e where e->>'label' = 'ZZTEST panel batch' and e->'vps_anchors' is not null);
    r := pg_temp.call_as(usr, 'select public.vsat_batches()');
    t_name := t_name || text 'A non-staff cannot read batches'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');

    -- ════ B. assign interview ════
    r := pg_temp.call_as(int1, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', a1, 'interviewer_id', int1, 'slot_datetime', slot)));
    t_name := t_name || text 'B interviewers cannot assign interviews'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(adm_all, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', a1, 'interviewer_id', cou1, 'slot_datetime', slot)));
    t_name := t_name || text 'B assigning a non-interviewer is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'NOT_AN_INTERVIEWER');
    r := pg_temp.call_as(adm_all, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', a1, 'interviewer_id', int1, 'slot_datetime', 'tomorrow')));
    t_name := t_name || text 'B bad slot refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: slot_datetime');
    r := pg_temp.call_as(adm_all, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', a1, 'interviewer_id', int1, 'slot_datetime', slot, 'meet_link', 'javascript:alert(1)')));
    t_name := t_name || text 'B non-https meeting link refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: meet_link');
    r := pg_temp.call_as(adm_all, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', a1, 'interviewer_id', int1, 'slot_datetime', slot, 'meet_link', 'https://meet.google.com/zzt-abcd-efg')));
    t_name := t_name || text 'B admissions assigns interviewer + slot → interview_scheduled';
    t_det := t_det || left(r::text, 200);
    t_pass := t_pass || (r->'pipeline'->>'stage' = 'interview_scheduled' and r->'interview'->>'interviewer_id' = int1::text);
    r := pg_temp.call_as(adm_all, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', a2, 'interviewer_id', int1, 'slot_datetime', slot)));
    t_name := t_name || text 'B same interviewer, same slot for another student → SLOT_TAKEN'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'SLOT_TAKEN');
    r := pg_temp.call_as(adm_all, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', a2, 'interviewer_id', int2, 'slot_datetime', slot)));
    t_name := t_name || text 'B another interviewer at that slot is fine'; t_det := t_det || left(r::text, 120); t_pass := t_pass || (r->'pipeline'->>'stage' = 'interview_scheduled');
    r := pg_temp.call_as(adm_all, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', a1, 'interviewer_id', int1, 'slot_datetime', slot, 'role', 'admin')));
    t_name := t_name || text 'B unknown key refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' like 'UNKNOWN_KEY%');

    -- ════ C. student page ════
    r := pg_temp.call_as(int1, format('select public.vsat_student(%L)', a1));
    t_name := t_name || text 'C assigned interviewer sees the student, without email / mobile / date of birth';
    t_det := t_det || left((r->'profile')::text, 300);
    t_pass := t_pass || (r->'profile'->>'application_id' = a1 and r->'profile'->'email' = 'null'::jsonb
                         and r->'profile'->'mobile' = 'null'::jsonb and not (r->>'can_manage')::boolean);
    r := pg_temp.call_as(int2, format('select public.vsat_student(%L)', a1));
    t_name := t_name || text 'C another interviewer cannot open the student'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(adm_all, format('select public.vsat_student(%L)', a1));
    t_name := t_name || text 'C admissions sees contact details, history and scholarship inputs';
    t_det := t_det || left(r::text, 200);
    t_pass := t_pass || (r->'profile'->>'email' is not null and jsonb_array_length(r->'history') >= 3
                         and (r->'scholarship_inputs'->>'vsat_pct')::numeric = 80);

    -- ════ D. interview form ════
    form := jsonb_build_object('application_id', a1, 'communication', 4, 'logic', 4, 'passion', 3, 'achievements', 3, 'why_program', 4,
              'cheating_seen', false, 'interviewer_verdict', 'selected', 'financial_capability', 'medium', 'jee_pct', 91.5,
              'remarks', jsonb_build_object('communication', 'clear and confident'));
    r := pg_temp.call_as(int2, pg_temp.rpc('vsat_submit_interview', form));
    t_name := t_name || text 'D another interviewer cannot submit the form'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(int1, pg_temp.rpc('vsat_submit_interview', form || '{"logic": 6}'));
    t_name := t_name || text 'D a part of 6 is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: logic');
    r := pg_temp.call_as(int1, pg_temp.rpc('vsat_submit_interview', form || '{"logic": 3.5}'));
    t_name := t_name || text 'D a part of 3.5 is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: logic');
    r := pg_temp.call_as(int1, pg_temp.rpc('vsat_submit_interview', form - 'cheating_seen'));
    t_name := t_name || text 'D cheating_seen is required'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: cheating_seen');
    r := pg_temp.call_as(int1, pg_temp.rpc('vsat_submit_interview', form || '{"financial_capability": "rich"}'));
    t_name := t_name || text 'D unknown financial capability refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: financial_capability');
    r := pg_temp.call_as(int1, pg_temp.rpc('vsat_submit_interview', form || '{"remarks": {"hack": "x"}}'));
    t_name := t_name || text 'D unknown remark key refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' like 'UNKNOWN_KEY%');
    r := pg_temp.call_as(int1, pg_temp.rpc('vsat_submit_interview', form));
    t_name := t_name || text 'D both verdicts selected → score 3.65, auto-moved to pi_cleared';
    t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'score')::numeric = 3.65 and r->>'calc_verdict' = 'selected' and r->>'stage' = 'pi_cleared');
    t_name := t_name || text 'D form saved: weights date, remarks, JEE, attendance done; history shows auto move';
    select format('%s|%s|%s|%s', ia.weights_from, ia.remarks->>'communication', ia.jee_pct, ia.attendance) into s
      from public.interview_assignments ia where ia.application_id = a1;
    t_det := t_det || s;
    t_pass := t_pass || (s = '2026-04-01|clear and confident|91.5|done'
                         and exists (select 1 from public.vsat_stage_history h where h.application_id = a1 and h.source = 'auto' and h.to_stage = 'pi_cleared'));
    r := pg_temp.call_as(int1, pg_temp.rpc('vsat_submit_interview', form));
    t_name := t_name || text 'D the form cannot be submitted twice (stage moved on)'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'WRONG_STAGE');
    r := pg_temp.call_as(int2, pg_temp.rpc('vsat_submit_interview', jsonb_build_object('application_id', a2, 'communication', 5, 'logic', 5, 'passion', 5,
           'achievements', 5, 'why_program', 5, 'cheating_seen', false, 'interviewer_verdict', 'maybe')));
    t_name := t_name || text 'D calculated selected but interviewer maybe → stays interviewed for admissions';
    t_det := t_det || r::text; t_pass := t_pass || (r->>'stage' = 'interviewed' and r->>'status' = 'active');
    r := pg_temp.call_as(adm_all, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', a3, 'interviewer_id', int2, 'slot_datetime', to_char(now() + interval '4 days', 'YYYY-MM-DD"T"HH24:00:00"Z"'))));
    r := pg_temp.call_as(int2, pg_temp.rpc('vsat_submit_interview', jsonb_build_object('application_id', a3, 'communication', 5, 'logic', 5, 'passion', 5,
           'achievements', 5, 'why_program', 5, 'cheating_seen', true, 'interviewer_verdict', 'selected')));
    t_name := t_name || text 'D cheating seen → not selected, whatever the scores';
    t_det := t_det || r::text; t_pass := t_pass || (r->>'stage' = 'interviewed' and r->>'status' = 'not_selected');

    -- ════ E. counselling ════
    r := pg_temp.call_as(adm_all, pg_temp.rpc('vsat_assign_counsellor', jsonb_build_object('application_id', a2, 'counsellor_id', cou1, 'slot_datetime', slot)));
    t_name := t_name || text 'E counsellor cannot be assigned before PI is cleared'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'WRONG_STAGE');
    r := pg_temp.call_as(adm_all, pg_temp.rpc('vsat_assign_counsellor', jsonb_build_object('application_id', a1, 'counsellor_id', int1, 'slot_datetime', slot)));
    t_name := t_name || text 'E assigning a non-counsellor is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'NOT_A_COUNSELLOR');
    r := pg_temp.call_as(adm_all, pg_temp.rpc('vsat_assign_counsellor', jsonb_build_object('application_id', a1, 'counsellor_id', cou1, 'slot_datetime', slot)));
    t_name := t_name || text 'E admissions assigns counsellor → counselling_scheduled'; t_det := t_det || left(r::text, 120);
    t_pass := t_pass || (r->'pipeline'->>'stage' = 'counselling_scheduled');
    r := pg_temp.call_as(cou1, format('select public.vsat_scholarship_preview(%L)', a1));
    -- inputs: VSAT 80, 10th 90 (maths 85), 12th 80 (maths 70), interview 3.65, passion 3, JEE 91.5 from the form (no JEE Maths)
    -- jee_and_12th: 80*.15 + 90*.05 + 85*.05 + 70*.10 + 80*.10 + 3.65*20*.15 + 91.5*.20 + 0*.15 + 3*20*.05 = 68 → Pune cat 7 (65–70), steps 15/20/25
    t_name := t_name || text 'E scholarship preview: case jee_and_12th, score 68, Pune category 7 (steps 15/20/25), JEE Maths flagged missing';
    t_det := t_det || left(r::text, 300);
    t_pass := t_pass || (r->>'case' = 'jee_and_12th' and (r->>'score')::numeric = 68 and (r->>'category')::int = 7 and r->'award_steps' = '[15, 20, 25]'::jsonb
                         and r->'missing' ? 'jee_maths_pct' and (r->>'jee_floor')::numeric = 30);
    r := pg_temp.call_as(int1, format('select public.vsat_scholarship_preview(%L)', a2));
    t_name := t_name || text 'E interviewer of another student cannot preview'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(cou1, pg_temp.rpc('vsat_submit_counselling', jsonb_build_object('application_id', a1, 'chosen_step', 37)));
    t_name := t_name || text 'E a step outside the category steps is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: chosen_step');
    r := pg_temp.call_as(cou1, pg_temp.rpc('vsat_submit_counselling', jsonb_build_object('application_id', a1, 'chosen_step', 20, 'actual_pct', 50)));
    t_name := t_name || text 'E an actual % different from the calculated one needs a reason'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'REASON_REQUIRED');
    -- 0082: the +10% rating comes from the interview's achievements score (3 for a1), not the request.
    -- The bonus itself is tested in vsat_achievements_bonus.test.sql.
    r := pg_temp.call_as(cou1, pg_temp.rpc('vsat_submit_counselling', jsonb_build_object('application_id', a1, 'chosen_step', 20)));
    t_name := t_name || text 'E step 20, interview achievements 3 → 20% (no bonus), JEE floor off → counselled';
    t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'calculated_pct')::numeric = 20 and (r->>'actual_pct')::numeric = 20 and not (r->>'bonus_applied')::boolean
                         and not (r->>'jee_floor_applied')::boolean and r->>'stage' = 'counselled');
    t_name := t_name || text 'E saved on counselling + application; old field counselling_done';
    select format('%s|%s|%s|%s|%s', ca.calc_category, ca.chosen_step, ca.scholarship_pct, am.scholarship_percentage, am.application_stage_1)
      into s from public.counselling_assignments ca join public.application_manager am using (application_id) where ca.application_id = a1;
    t_det := t_det || s; t_pass := t_pass || (s = '7|20|20|20|counselling_done');

    -- ════ F. list summary + access ════
    r := pg_temp.call_as(adm, 'select public.vsat_pipeline_list(''{"q":"ZZT-PNL","stage":"counselled"}''::jsonb)');
    t_name := t_name || text 'F list rows carry the interview and counselling summary';
    t_det := t_det || left(r::text, 300);
    t_pass := t_pass || ((r->'rows'->0->'interview'->>'score')::numeric = 3.65 and (r->'rows'->0->'counselling'->>'pct')::numeric = 20);  -- 20 since 0082 (see E)
    t_name := t_name || text 'F new RPCs: authenticated only, security definer, empty search_path; helpers private';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat_team_list','vsat_batches','vsat_student','vsat_assign_interview','vsat_submit_interview',
                                                   'vsat_assign_counsellor','vsat_scholarship_preview','vsat_submit_counselling','vsat_pipeline_list')
       and not (has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
                and p.prosecdef and p.proconfig = array['search_path=""']);
    t_det := t_det || coalesce(s, 'all ok');
    t_pass := t_pass || (s is null and not exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                          where ns.nspname = 'public' and p.proname in ('vsat__num','vsat__txt','vsat__bool','vsat__any_role','vsat__scholarship_inputs')
                            and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))));
    r := pg_temp.call_as(null, format('select public.vsat_student(%L)', a1), true);
    t_name := t_name || text 'F anon cannot open a student'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_vsat_panels_tests();
