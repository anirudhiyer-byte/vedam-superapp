-- VSAT pipeline · stage engine tests for migration 0080 (STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the
-- Supabase MCP. The last statement returns one row per test: test | pass | detail.
-- Also run vsat_pipeline_scoring.test.sql (0079): it must still pass.
--
-- Nothing is left behind: all test data is created inside a block that is rolled back with a
-- private error code at the end. Fake data only (@example.invalid, ZZTEST names).
-- Logged-in calls are simulated the way PostgREST does it (SET ROLE + request.jwt.claims).

-- ── helpers (session-temporary) ────────────────────────────────────────────────
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

-- an applicant with a lead row and an application (exam date optional)
create or replace function pg_temp.mk_app(p_id text, p_campus text, p_date uuid)
returns text language plpgsql as $$
declare u uuid := pg_temp.mk_user(lower(p_id) || '@example.invalid');
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, lead_stage) values (u, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', 'applicant_paid');
  insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email, registered_mobile,
                                          campus_applied, exam_date_id, class10_year, class12_year, marks_physics_12, marks_chemistry_12, marks_maths_12, vps_score)
  values (p_id, u, p_id, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', '9000000000', p_campus, p_date, 2024, 2026, 60, 60, 60, 8.43);
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

create or replace function pg_temp.mv(p_app text, p_to text, p_status text default null, p_reason text default null, p_expected text default null)
returns text language sql as $$
  select format('select public.vsat_move_stage(%L::jsonb)',
    jsonb_strip_nulls(jsonb_build_object('application_id', p_app, 'to_stage', p_to, 'to_status', p_status, 'reason', p_reason, 'expected_stage', p_expected))::text)
$$;

-- ── the tests ──────────────────────────────────────────────────────────────────
create or replace function pg_temp.run_vsat_engine_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; adm_all uuid; adm_pune uuid; int1 uuid; int2 uuid; cou1 uuid; usr uuid;
  d uuid; a1 text; a2 text; a3 text; r jsonb; s text; n int; st text; stt text;
begin
  begin -- everything below is rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('zztest-eng-admin@example.invalid');
    insert into public.user_roles (user_id, role) values (adm, 'admin');
    adm_all  := pg_temp.mk_user('zztest-eng-adm-all@example.invalid');
    adm_pune := pg_temp.mk_user('zztest-eng-adm-pune@example.invalid');
    int1 := pg_temp.mk_user('zztest-eng-int1@example.invalid');
    int2 := pg_temp.mk_user('zztest-eng-int2@example.invalid');
    cou1 := pg_temp.mk_user('zztest-eng-cou1@example.invalid');
    usr  := pg_temp.mk_user('zztest-eng-user@example.invalid');
    insert into public.vsat_team (user_id, role, campus) values
      (adm_all, 'admissions', null), (adm_pune, 'admissions', 'pune'),
      (int1, 'interviewer', null), (int2, 'interviewer', null), (cou1, 'counsellor', null);
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at)
    values ('ZZTEST batch', 'zz-test', current_date, now(), now() + interval '2 hours') returning id into d;

    a1 := pg_temp.mk_app('ZZT-ENG-1', 'Ajeenkya DY Patil University — Pune', d);
    a2 := pg_temp.mk_app('ZZT-ENG-2', 'Gurugram (Sushant University)', d);
    a3 := pg_temp.mk_app('ZZT-ENG-3', 'No preference', null);

    -- ════ A. automatic rows from the exam flow ════
    select vp.stage, vp.status into st, stt from public.vsat_pipeline vp where vp.application_id = a1;
    t_name := t_name || text 'A exam date set → pipeline row "booked" (source system)';
    t_det := t_det || format('%s/%s; history %s', st, stt, (select string_agg(h.source || ':' || h.to_stage, ',') from public.vsat_stage_history h where h.application_id = a1));
    t_pass := t_pass || (st = 'booked' and stt = 'active'
                         and exists (select 1 from public.vsat_stage_history h where h.application_id = a1 and h.source = 'system' and h.to_stage = 'booked'));
    t_name := t_name || text 'A no exam date → not in the pipeline';
    t_det := t_det || text '';
    t_pass := t_pass || not exists (select 1 from public.vsat_pipeline vp where vp.application_id = a3);
    update public.application_manager set exam_given = true where application_id in (a1, a2);
    t_name := t_name || text 'A exam_given → both move to "exam_taken" automatically';
    t_det := t_det || (select string_agg(vp.application_id || ':' || vp.stage, ',') from public.vsat_pipeline vp where vp.application_id in (a1, a2));
    t_pass := t_pass || ((select count(*) from public.vsat_pipeline vp where vp.application_id in (a1, a2) and vp.stage = 'exam_taken') = 2);
    t_name := t_name || text 'A backfill: every application with an exam date has a pipeline row';
    select count(*) into n from public.application_manager am where am.exam_date_id is not null
       and not exists (select 1 from public.vsat_pipeline vp where vp.application_id = am.application_id);
    t_det := t_det || (n || ' missing'); t_pass := t_pass || (n = 0);

    -- ════ B. who may call ════
    foreach s in array array[
        pg_temp.mv(a1, 'vsat_cleared'), 'select public.vsat_pipeline_list(''{}''::jsonb)',
        format('select public.vsat_stage_history_for(%L)', a1),
        format('select public.vsat_move_bulk(%L::jsonb)', jsonb_build_object('application_ids', jsonb_build_array(a1), 'to_stage', 'vsat_cleared')::text),
        format('select public.vsat_set_override(%L::jsonb)', jsonb_build_object('application_id', a1, 'field', 'vps', 'value', 9, 'reason', 'zz test')::text)] loop
      r := pg_temp.call_as(null, s, true);
      t_name := t_name || ('B anon refused: ' || substring(s from 'public\.(vsat_[a-z_]+)')); t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
      r := pg_temp.call_as(usr, s);
      t_name := t_name || ('B signed-in non-staff refused: ' || substring(s from 'public\.(vsat_[a-z_]+)')); t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    end loop;
    r := pg_temp.call_as(usr, pg_temp.mv('ZZT-DOES-NOT-EXIST', 'vsat_cleared'));
    t_name := t_name || text 'B non-staff gets FORBIDDEN (not "not found") for an unknown id';
    t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');

    -- ════ C. admissions moves, reasons, sync to the old fields ════
    r := pg_temp.call_as(adm_all, pg_temp.mv(a1, 'vsat_cleared'));
    t_name := t_name || text 'C admissions: exam_taken → vsat_cleared (next stage, no reason needed)';
    t_det := t_det || r::text; t_pass := t_pass || (r->>'stage' = 'vsat_cleared' and (r->>'changed')::boolean);
    t_name := t_name || text 'C old fields synced: application_stage_1 and lead_stage = vsat_cleared';
    select am.application_stage_1::text || '/' || lm.lead_stage::text || '/' || coalesce(lm.previous_lead_stage, '-') into s
      from public.application_manager am join public.lead_manager lm on lm.lead_id = am.lead_id where am.application_id = a1;
    t_det := t_det || s; t_pass := t_pass || (s = 'vsat_cleared/vsat_cleared/applicant_paid');
    t_name := t_name || text 'C history row has who and source manual';
    t_det := t_det || text '';
    t_pass := t_pass || exists (select 1 from public.vsat_stage_history h where h.application_id = a1 and h.to_stage = 'vsat_cleared'
                                   and h.from_stage = 'exam_taken' and h.source = 'manual' and h.actor_id = adm_all);

    r := pg_temp.call_as(adm_all, pg_temp.mv(a1, 'exam_taken'));
    t_name := t_name || text 'C moving back without a reason is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'REASON_REQUIRED');
    r := pg_temp.call_as(adm_all, pg_temp.mv(a2, 'interviewed', null, null));
    t_name := t_name || text 'C skipping stages without a reason is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'REASON_REQUIRED');
    r := pg_temp.call_as(adm_all, pg_temp.mv(a2, 'exam_taken', 'not_selected'));
    t_name := t_name || text 'C not_selected without a reason is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'REASON_REQUIRED');
    r := pg_temp.call_as(adm_all, pg_temp.mv(a2, 'exam_taken', 'not_selected', 'VPS below batch cut-off'));
    t_name := t_name || text 'C not_selected with a reason → old field vsat_not_cleared';
    t_det := t_det || (r::text || ' ' || (select application_stage_1::text from public.application_manager where application_id = a2));
    t_pass := t_pass || (r->>'status' = 'not_selected' and (select application_stage_1::text from public.application_manager where application_id = a2) = 'vsat_not_cleared');
    r := pg_temp.call_as(adm_all, pg_temp.mv(a2, 'vsat_cleared'));
    t_name := t_name || text 'C reopening a not_selected student needs a reason'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'REASON_REQUIRED');
    r := pg_temp.call_as(adm_all, pg_temp.mv(a1, 'interview_scheduled', null, null, 'exam_taken'));
    t_name := t_name || text 'C stale panel (expected_stage differs) is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'STAGE_CHANGED');
    r := pg_temp.call_as(adm_all, pg_temp.mv(a1, 'nonsense'));
    t_name := t_name || text 'C unknown stage refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_STAGE');
    r := pg_temp.call_as(adm_all, format('select public.vsat_move_stage(%L::jsonb)', jsonb_build_object('application_id', a1, 'to_stage', 'eligible', 'role', 'admin')::text));
    t_name := t_name || text 'C unknown request key refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' like 'UNKNOWN_KEY%');
    r := pg_temp.call_as(adm_all, format('select public.vsat_move_stage(%L::jsonb)', jsonb_build_object('application_id', a1, 'to_stage', 5)::text));
    t_name := t_name || text 'C non-text value refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' like 'BAD_VALUE%');

    -- ════ D. campus scope ════
    r := pg_temp.call_as(adm_pune, pg_temp.mv(a2, 'vsat_cleared', null, 'zz reopen'));
    t_name := t_name || text 'D Pune admissions cannot move a Gurugram student'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(adm_pune, 'select public.vsat_pipeline_list(''{"q":"ZZTEST ZZT-ENG"}''::jsonb)');
    t_name := t_name || text 'D Pune admissions list shows Pune student only';
    t_det := t_det || left(r::text, 300);
    t_pass := t_pass || ((r->>'total')::int = 1 and r->'rows'->0->>'application_id' = a1);

    -- ════ E. scheduling needs an assignment; interviewer rights ════
    r := pg_temp.call_as(adm_all, pg_temp.mv(a1, 'interview_scheduled'));
    t_name := t_name || text 'E interview_scheduled without an interviewer is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'NEEDS_INTERVIEWER');
    insert into public.interview_assignments (application_id, attempt_no, interviewer_id, slot_datetime) values (a1, 1, int1, now() + interval '1 day');
    r := pg_temp.call_as(adm_all, pg_temp.mv(a1, 'interview_scheduled'));
    t_name := t_name || text 'E with an interviewer assigned → scheduled; old field interview_selected';
    t_det := t_det || r::text; t_pass := t_pass || (r->>'stage' = 'interview_scheduled'
                         and (select application_stage_1::text from public.application_manager where application_id = a1) = 'interview_selected');
    r := pg_temp.call_as(int2, pg_temp.mv(a1, 'interviewed'));
    t_name := t_name || text 'E another interviewer cannot move the student'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(int2, 'select public.vsat_pipeline_list(''{}''::jsonb)');
    t_name := t_name || text 'E another interviewer sees nobody'; t_det := t_det || left(r::text, 200); t_pass := t_pass || ((r->>'total')::int = 0);
    r := pg_temp.call_as(int2, format('select public.vsat_stage_history_for(%L)', a1));
    t_name := t_name || text 'E another interviewer cannot read the history'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(int1, 'select public.vsat_pipeline_list(''{}''::jsonb)');
    t_name := t_name || text 'E assigned interviewer sees only their student, without email/mobile';
    t_det := t_det || left(r::text, 300);
    t_pass := t_pass || ((r->>'total')::int = 1 and r->'rows'->0->>'application_id' = a1 and r->'rows'->0->'email' = 'null'::jsonb and r->'rows'->0->'mobile' = 'null'::jsonb);
    r := pg_temp.call_as(int1, pg_temp.mv(a1, 'pi_cleared', null, 'zz trying'));
    t_name := t_name || text 'E interviewer cannot clear PI (only interviewed / absent)'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(int1, pg_temp.mv(a1, 'interviewed'));
    t_name := t_name || text 'E assigned interviewer: interview_scheduled → interviewed'; t_det := t_det || r::text; t_pass := t_pass || (r->>'stage' = 'interviewed');
    r := pg_temp.call_as(int1, format('select public.vsat_move_bulk(%L::jsonb)', jsonb_build_object('application_ids', jsonb_build_array(a1), 'to_stage', 'pi_cleared')::text));
    t_name := t_name || text 'E interviewers cannot bulk-move'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');

    -- ════ F. bulk ════
    r := pg_temp.call_as(adm_all, format('select public.vsat_move_bulk(%L::jsonb)',
           jsonb_build_object('application_ids', jsonb_build_array(a1, a2, 'ZZT-MISSING'), 'to_stage', 'pi_cleared')::text));
    t_name := t_name || text 'F bulk: 1 moved, 2 skipped with reasons (needs reason, not in pipeline)';
    t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'moved')::int = 1 and jsonb_array_length(r->'skipped') = 2
                         and r->'skipped' @> jsonb_build_array(jsonb_build_object('application_id', a2, 'code', 'REASON_REQUIRED'),
                                                               jsonb_build_object('application_id', 'ZZT-MISSING', 'code', 'NOT_IN_PIPELINE')));
    r := pg_temp.call_as(adm_all, format('select public.vsat_move_bulk(%L::jsonb)',
           jsonb_build_object('application_ids', (select jsonb_agg('X' || g) from generate_series(1, 501) g), 'to_stage', 'pi_cleared')::text));
    t_name := t_name || text 'F bulk over 500 refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' like 'BAD_VALUE%');

    -- ════ G. counsellor ════
    r := pg_temp.call_as(adm_all, pg_temp.mv(a1, 'counselling_scheduled'));
    t_name := t_name || text 'G counselling_scheduled without a counsellor is refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'NEEDS_COUNSELLOR');
    insert into public.counselling_assignments (application_id, attempt_no, counsellor_id, slot_datetime) values (a1, 1, cou1, now() + interval '2 days');
    r := pg_temp.call_as(adm_all, pg_temp.mv(a1, 'counselling_scheduled'));
    t_name := t_name || text 'G with a counsellor → counselling_scheduled'; t_det := t_det || r::text; t_pass := t_pass || (r->>'stage' = 'counselling_scheduled');
    r := pg_temp.call_as(cou1, pg_temp.mv(a1, 'counselled'));
    t_name := t_name || text 'G assigned counsellor → counselled; old field counselling_done';
    t_det := t_det || r::text; t_pass := t_pass || (r->>'stage' = 'counselled'
                         and (select application_stage_1::text from public.application_manager where application_id = a1) = 'counselling_done');
    r := pg_temp.call_as(cou1, pg_temp.mv(a1, 'offer_sent'));
    t_name := t_name || text 'G counsellor cannot send the offer stage'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');

    -- ════ H. overrides ════
    r := pg_temp.call_as(adm_all, format('select public.vsat_set_override(%L::jsonb)', jsonb_build_object('application_id', a1, 'field', 'vps', 'value', 7.4, 'reason', 'zz test')::text));
    t_name := t_name || text 'H admissions cannot override (admins only)'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(adm, format('select public.vsat_set_override(%L::jsonb)', jsonb_build_object('application_id', a1, 'field', 'vps', 'value', 7.4)::text));
    t_name := t_name || text 'H override without a reason refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'REASON_REQUIRED');
    r := pg_temp.call_as(adm, format('select public.vsat_set_override(%L::jsonb)', jsonb_build_object('application_id', a1, 'field', 'vps', 'value', 11, 'reason', 'zz test')::text));
    t_name := t_name || text 'H VPS override above 10 refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' like 'BAD_VALUE%');
    r := pg_temp.call_as(adm, format('select public.vsat_set_override(%L::jsonb)', jsonb_build_object('application_id', a1, 'field', 'vps', 'value', 7.4, 'reason', 'Female inclusion as per sheet')::text));
    t_name := t_name || text 'H admin VPS override: value 7.4, calculated 8.43 kept';
    t_det := t_det || r::text; t_pass := t_pass || ((r->'vps'->>'value')::numeric = 7.4 and (r->'vps'->>'calculated')::numeric = 8.43);
    r := pg_temp.call_as(adm, format('select public.vsat_set_override(%L::jsonb)', jsonb_build_object('application_id', a1, 'field', 'eligible', 'value', false, 'reason', 'zz test')::text));
    t_name := t_name || text 'H eligibility override: calculated true, value false';
    t_det := t_det || r::text; t_pass := t_pass || ((r->'eligible'->>'calculated')::boolean and not (r->'eligible'->>'value')::boolean);
    r := pg_temp.call_as(adm, format('select public.vsat_set_override(%L::jsonb)', jsonb_build_object('application_id', a1, 'field', 'vps', 'value', 7.7, 'reason', 'zz replace')::text));
    t_name := t_name || text 'H a new override replaces the old one (one active, old kept as cleared)';
    t_det := t_det || r::text;
    t_pass := t_pass || ((r->'vps'->>'value')::numeric = 7.7
                         and (select count(*) from public.vsat_overrides o where o.application_id = a1 and o.field = 'vps') = 2
                         and (select count(*) from public.vsat_overrides o where o.application_id = a1 and o.field = 'vps' and o.cleared_at is null) = 1);
    r := pg_temp.call_as(adm, format('select public.vsat_clear_override(%L::jsonb)', jsonb_build_object('application_id', a1, 'field', 'vps', 'reason', 'zz undo')::text));
    t_name := t_name || text 'H clearing the override → back to calculated 8.43';
    t_det := t_det || r::text; t_pass := t_pass || ((r->'vps'->>'value')::numeric = 8.43 and r->'vps'->'override' = 'null'::jsonb);

    -- ════ I. list and history for admins ════
    r := pg_temp.call_as(adm, 'select public.vsat_pipeline_list(''{"q":"ZZT-ENG", "stage":"counselled"}''::jsonb)');
    t_name := t_name || text 'I admin list: stage filter shows only that stage; counts cover all stages';
    t_det := t_det || left(r::text, 400);
    t_pass := t_pass || ((r->>'total')::int = 1 and r->'rows'->0->>'stage' = 'counselled'
                         and (r->'counts'->>'counselled')::int = 1 and (r->'counts'->>'exam_taken')::int = 1
                         and r->'rows'->0->>'email' is not null and r->'rows'->0->>'batch' = 'ZZTEST batch');
    r := pg_temp.call_as(adm, 'select public.vsat_pipeline_list(''{"q":"x"}''::jsonb)');
    t_name := t_name || text 'I one-letter search refused'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' like 'BAD_VALUE%');
    r := pg_temp.call_as(adm, 'select public.vsat_pipeline_list(''{"q":"%_"}''::jsonb)');
    t_name := t_name || text 'I search treats % and _ as text, not wildcards'; t_det := t_det || left(r::text, 200); t_pass := t_pass || ((r->>'total')::int = 0);
    r := pg_temp.call_as(adm, format('select public.vsat_stage_history_for(%L)', a1));
    t_name := t_name || text 'I history: newest first, system + manual entries, names shown';
    t_det := t_det || left(r::text, 400);
    t_pass := t_pass || (r->0->>'to_stage' = 'counselled' and r->-1->>'source' = 'system'
                         and exists (select 1 from jsonb_array_elements(r) e where e->>'by' = 'ZZTEST zztest-eng-adm-all'));

    -- ════ J. grants and settings ════
    t_name := t_name || text 'J RPCs: authenticated yes, anon no, security definer, empty search_path';
    select string_agg(p.proname || ':' || has_function_privilege('authenticated', p.oid, 'execute') || '/' || has_function_privilege('anon', p.oid, 'execute'), ' ') into s
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat_move_stage', 'vsat_move_bulk', 'vsat_pipeline_list', 'vsat_stage_history_for', 'vsat_set_override', 'vsat_clear_override');
    t_det := t_det || s;
    t_pass := t_pass || (select count(*) = 6 and bool_and(has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
                                                       and p.prosecdef and p.proconfig = array['search_path=""'])
                           from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                          where ns.nspname = 'public' and p.proname in ('vsat_move_stage', 'vsat_move_bulk', 'vsat_pipeline_list', 'vsat_stage_history_for', 'vsat_set_override', 'vsat_clear_override'));
    t_name := t_name || text 'J private helpers and tables are not reachable from a browser';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname like 'vsat\_\_%' and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'));
    t_det := t_det || coalesce(s, 'none');
    t_pass := t_pass || (s is null
                         and not has_table_privilege('authenticated', 'public.vsat_pipeline', 'select')
                         and not has_table_privilege('authenticated', 'public.vsat_stage_history', 'select')
                         and not has_table_privilege('anon', 'public.vsat_overrides', 'select'));

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_vsat_engine_tests();
