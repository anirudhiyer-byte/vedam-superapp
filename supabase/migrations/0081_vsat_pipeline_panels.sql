-- 0081 · VSAT pipeline, step 4 — database side of the panels (staging first).
--
-- Adds what the Applications / Exam / Interview / Counselling panels and the student page need.
-- Builds on 0079 (formulas, roles) and 0080 (stage engine). Spec: "VSAT Pipeline in Vedam One — Build Spec".
--
--   interview_assignments   + the Google Form answers (remarks per part, cheating seen, coding talent,
--                             certificate asked, drop year, previous JEE, JEE / JEE Maths / expected JEE %,
--                             other exams, class 10/11/12 %, financial capability + reason, interviewer's
--                             verdict, "why should Vedam accept you"), calculated verdict, weights used
--   counselling_assignments + scholarship calculation (score, case, category, steps, chosen step, JEE floor,
--                             special rating, bonus, calculated %) and the counsellor's actual % + reason
--
--   RPCs (signed-in staff only, checks inside):
--     vsat_team_list()                 team members for the assign dropdowns (admin / admissions)
--     vsat_batches()                   exam batches for filters (any VSAT role)
--     vsat_student(application_id)     everything about one student (whoever may see them)
--     vsat_assign_interview(p)         admin / admissions: interviewer + slot → interview_scheduled
--     vsat_submit_interview(p)         assigned interviewer (or admin / admissions): the interview form →
--                                      interviewed; auto-moves to pi_cleared when the calculated AND the
--                                      interviewer's verdict are both "selected"; cheating seen → not selected
--     vsat_assign_counsellor(p)        admin / admissions: counsellor + slot → counselling_scheduled
--     vsat_scholarship_preview(id)     the scholarship calculation from the student's data
--     vsat_submit_counselling(p)       assigned counsellor (or admin / admissions): chosen step, special
--                                      rating, actual % (reason required when it differs) → counselled
--   vsat_pipeline_list is replaced to add an interview / counselling summary per row (same checks).
--
-- Rollback: supabase/rollback/0081_vsat_pipeline_panels_down.sql
-- Tests:    supabase/tests/vsat_pipeline_panels.test.sql

-- ── columns ───────────────────────────────────────────────────────────────────────────
alter table public.interview_assignments
  add column if not exists remarks              jsonb,
  add column if not exists cheating_seen        boolean,
  add column if not exists coding_talent        boolean,
  add column if not exists cert_asked           boolean,
  add column if not exists drop_year            boolean,
  add column if not exists previous_jee         text,
  add column if not exists jee_pct              numeric,
  add column if not exists jee_maths_pct        numeric,
  add column if not exists expected_jee_pct     numeric,
  add column if not exists other_exams          text,
  add column if not exists class10_pct          numeric,
  add column if not exists class11_pct          numeric,
  add column if not exists class12_pct          numeric,
  add column if not exists financial_capability text check (financial_capability in ('low', 'medium', 'high')),
  add column if not exists financial_reason     text,
  add column if not exists interviewer_verdict  text check (interviewer_verdict in ('selected', 'maybe', 'not_selected')),
  add column if not exists calc_verdict         text check (calc_verdict in ('selected', 'maybe', 'not_selected')),
  add column if not exists why_accept           text,
  add column if not exists weights_from         date,
  add column if not exists submitted_at         timestamptz,
  add column if not exists submitted_by         uuid;

alter table public.counselling_assignments
  add column if not exists calc_score        numeric,
  add column if not exists calc_case         text,
  add column if not exists calc_category     int,
  add column if not exists award_steps       jsonb,
  add column if not exists chosen_step       numeric,
  add column if not exists jee_floor         numeric,
  add column if not exists special_rating    int check (special_rating between 1 and 5),
  add column if not exists bonus_applied     boolean,
  add column if not exists calculated_pct    numeric,
  add column if not exists actual_pct        numeric check (actual_pct between 0 and 100),
  add column if not exists actual_reason     text,
  add column if not exists counsellor_remarks text,
  add column if not exists calc_inputs       jsonb,
  add column if not exists submitted_at      timestamptz,
  add column if not exists submitted_by      uuid;

-- ── small private readers for request values (raise 22023 BAD_VALUE: key) ──────────────
create or replace function public.vsat__num(p jsonb, k text, lo numeric, hi numeric, required boolean)
returns numeric language plpgsql immutable set search_path to '' as $$
declare v numeric;
begin
  if not (p ? k) or jsonb_typeof(p->k) = 'null' then
    if required then raise exception 'BAD_VALUE: %', k using errcode = '22023'; end if;
    return null;
  end if;
  if jsonb_typeof(p->k) <> 'number' then raise exception 'BAD_VALUE: %', k using errcode = '22023'; end if;
  v := (p->>k)::numeric;
  if v < lo or v > hi then raise exception 'BAD_VALUE: %', k using errcode = '22023'; end if;
  return v;
end $$;

create or replace function public.vsat__txt(p jsonb, k text, maxlen int, required boolean)
returns text language plpgsql immutable set search_path to '' as $$
declare v text;
begin
  if not (p ? k) or jsonb_typeof(p->k) = 'null' then
    if required then raise exception 'BAD_VALUE: %', k using errcode = '22023'; end if;
    return null;
  end if;
  if jsonb_typeof(p->k) <> 'string' then raise exception 'BAD_VALUE: %', k using errcode = '22023'; end if;
  v := nullif(btrim(p->>k), '');
  if v is null and required then raise exception 'BAD_VALUE: %', k using errcode = '22023'; end if;
  if char_length(v) > maxlen then raise exception 'BAD_VALUE: %', k using errcode = '22023'; end if;
  return v;
end $$;

create or replace function public.vsat__bool(p jsonb, k text, required boolean)
returns boolean language plpgsql immutable set search_path to '' as $$
begin
  if not (p ? k) or jsonb_typeof(p->k) = 'null' then
    if required then raise exception 'BAD_VALUE: %', k using errcode = '22023'; end if;
    return null;
  end if;
  if jsonb_typeof(p->k) <> 'boolean' then raise exception 'BAD_VALUE: %', k using errcode = '22023'; end if;
  return (p->>k)::boolean;
end $$;

create or replace function public.vsat__any_role()
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(public.is_admin(), false)
      or exists (select 1 from public.vsat_team t where t.user_id = auth.uid() and t.active)
$$;

-- ── lookups ───────────────────────────────────────────────────────────────────────────
create or replace function public.vsat_team_list()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
begin
  if auth.uid() is null or not public.vsat__can_manage(null) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'name', x.name, 'email', x.email, 'roles', x.roles, 'campus', x.campus) order by x.name)
      from (select t.user_id, coalesce(p.full_name, p.email) name, p.email, jsonb_agg(t.role order by t.role) roles, min(t.campus) campus
              from public.vsat_team t left join public.profiles p on p.id = t.user_id
             where t.active group by t.user_id, p.full_name, p.email) x), '[]'::jsonb);
end $$;

create or replace function public.vsat_batches()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
begin
  if auth.uid() is null or not public.vsat__any_role() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label, 'exam_date', d.exam_date,
             'vps_anchors', coalesce(d.vps_anchors, s.vps_anchors), 'cleared_vps_cutoff', coalesce(d.cleared_vps_cutoff, s.pass_vps_cutoff))
             order by d.exam_date desc)
      from public.vsat_exam_dates d cross join (select * from public.vsat_exam_settings limit 1) s), '[]'::jsonb);
end $$;

-- ── scholarship inputs from the student's own data (private) ──────────────────────────
-- vsat % = marks / max × 100; JEE from the interview form when given, else the application.
create or replace function public.vsat__scholarship_inputs(p_app text)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare am public.application_manager; ia public.interview_assignments; vp public.vsat_pipeline;
begin
  select * into am from public.application_manager where application_id = p_app;
  select * into vp from public.vsat_pipeline where application_id = p_app;
  select * into ia from public.interview_assignments a where a.application_id = p_app and a.attempt_no = coalesce(vp.attempt_no, 1)
   order by a.created_at desc limit 1;
  return jsonb_build_object(
    'vsat_pct',          case when am.exam_max_marks > 0 then round(am.exam_obtained_marks / am.exam_max_marks * 100, 2) end,
    'class10_pct',       am.class10_percentage,
    'class12_pct',       am.class12_percentage,
    'interview_score',   ia.weighted_avg,
    'cs_passion',        ia.rubric_passion,
    'jee_pct',           coalesce(ia.jee_pct, case when am.jee_registered then am.entrance_percentile end),
    'jee_maths_pct',     coalesce(ia.jee_maths_pct, case when am.jee_registered then am.jee_main_maths_percentile end),
    'class10_maths_pct', am.class10_maths_percentage,
    'class12_maths_pct', am.class12_maths_percentage);
end $$;

-- ── one student ───────────────────────────────────────────────────────────────────────
create or replace function public.vsat_student(p_application_id text)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare am public.application_manager; vp public.vsat_pipeline; mgr boolean; d jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  if not public.vsat__can_view(p_application_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into am from public.application_manager where application_id = p_application_id;
  select * into vp from public.vsat_pipeline where application_id = p_application_id;
  mgr := public.vsat__can_manage(public.vsat__campus_key(am.campus_applied));
  select to_jsonb(x) into d from (select dd.id, dd.label, dd.exam_date, dd.vps_anchors, dd.cleared_vps_cutoff from public.vsat_exam_dates dd where dd.id = am.exam_date_id) x;
  return jsonb_build_object(
    'can_manage', mgr,
    'pipeline', jsonb_build_object('stage', vp.stage, 'status', vp.status, 'attempt_no', vp.attempt_no, 'stage_changed_at', vp.stage_changed_at),
    'profile', jsonb_build_object(
      'application_id', am.application_id, 'application_no', am.application_no, 'name', am.registered_name,
      'email', case when mgr then am.registered_email end, 'mobile', case when mgr then am.registered_mobile end,
      'gender', am.gender, 'date_of_birth', case when mgr then am.date_of_birth end, 'city', am.city, 'state', am.state,
      'campus', public.vsat__campus_key(am.campus_applied), 'campus_applied', am.campus_applied,
      'father_occupation', am.father_occupation, 'mother_occupation', am.mother_occupation),
    'academics', jsonb_build_object(
      'class10_year', am.class10_year, 'class10_pct', am.class10_percentage, 'class10_maths_pct', am.class10_maths_percentage,
      'class12_year', am.class12_year, 'class12_pct', am.class12_percentage, 'class12_maths_pct', am.class12_maths_percentage,
      'physics', am.marks_physics_12, 'chemistry', am.marks_chemistry_12, 'maths', am.marks_maths_12,
      'studied_cs', am.studied_cs, 'cs_experience', am.cs_experience,
      'jee_registered', am.jee_registered, 'jee_appeared_when', am.jee_appeared_when, 'jee_pct', am.entrance_percentile,
      'jee_maths_pct', am.jee_main_maths_percentile),
    'exam', jsonb_build_object(
      'batch', d, 'exam_given', am.exam_given, 'percentile', am.exam_percentile, 'marks', am.exam_obtained_marks,
      'max_marks', am.exam_max_marks, 'sections', am.exam_sections),
    'effective', public.vsat__effective(p_application_id),
    'interview', (select to_jsonb(a) - 'id' || jsonb_build_object('interviewer', coalesce(p.full_name, p.email))
                    from public.interview_assignments a left join public.profiles p on p.id = a.interviewer_id
                   where a.application_id = p_application_id and a.attempt_no = vp.attempt_no order by a.created_at desc limit 1),
    'counselling', (select to_jsonb(c) - 'id' || jsonb_build_object('counsellor', coalesce(p.full_name, p.email))
                      from public.counselling_assignments c left join public.profiles p on p.id = c.counsellor_id
                     where c.application_id = p_application_id and c.attempt_no = vp.attempt_no order by c.created_at desc limit 1),
    'scholarship_inputs', public.vsat__scholarship_inputs(p_application_id),
    'offer', jsonb_build_object('released_at', am.offer_released_at, 'expires_at', am.offer_expires_at,
                                'scholarship_pct', am.scholarship_percentage, 'category', am.scholarship_category_1),
    'overrides', coalesce((select jsonb_agg(jsonb_build_object('field', o.field, 'value', o.value, 'calculated', o.calculated, 'reason', o.reason,
                              'set_at', o.set_at, 'by', coalesce(pr.full_name, pr.email), 'cleared_at', o.cleared_at, 'clear_reason', o.clear_reason)
                              order by o.set_at desc)
                            from public.vsat_overrides o left join public.profiles pr on pr.id = o.set_by
                           where o.application_id = p_application_id), '[]'::jsonb),
    'history', public.vsat_stage_history_for(p_application_id));
end $$;

-- ── interview ─────────────────────────────────────────────────────────────────────────
-- p: {application_id, interviewer_id, slot_datetime, meet_link?}
create or replace function public.vsat_assign_interview(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare app text; iid uuid; slot timestamptz; link text; vp public.vsat_pipeline; v_campus text; n int;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['application_id', 'interviewer_id', 'slot_datetime', 'meet_link']);
  app := public.vsat__txt(p, 'application_id', 64, true);
  select * into vp from public.vsat_pipeline where application_id = app;
  if not found then
    if public.vsat__can_manage(null) then raise exception 'NOT_IN_PIPELINE' using errcode = 'P0002'; end if;
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select public.vsat__campus_key(am.campus_applied) into v_campus from public.application_manager am where am.application_id = app;
  if not public.vsat__can_manage(v_campus) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  begin iid := (public.vsat__txt(p, 'interviewer_id', 40, true))::uuid; exception when invalid_text_representation then raise exception 'BAD_VALUE: interviewer_id' using errcode = '22023'; end;
  -- strict ISO 8601 with a timezone (Postgres would also accept words like 'tomorrow')
  if public.vsat__txt(p, 'slot_datetime', 40, true) !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$' then raise exception 'BAD_VALUE: slot_datetime' using errcode = '22023'; end if;
  begin slot := (public.vsat__txt(p, 'slot_datetime', 40, true))::timestamptz; exception when others then raise exception 'BAD_VALUE: slot_datetime' using errcode = '22023'; end;
  link := public.vsat__txt(p, 'meet_link', 300, false);
  if link is not null and link !~ '^https://[a-z0-9.-]+/' then raise exception 'BAD_VALUE: meet_link' using errcode = '22023'; end if;
  if not exists (select 1 from public.vsat_team t where t.user_id = iid and t.role = 'interviewer' and t.active) then
    raise exception 'NOT_AN_INTERVIEWER' using errcode = '22023';
  end if;
  if vp.stage not in ('vsat_cleared', 'interview_scheduled') or vp.status = 'not_selected' then
    raise exception 'WRONG_STAGE' using errcode = '22023';
  end if;
  if exists (select 1 from public.interview_assignments a where a.interviewer_id = iid and a.slot_datetime = slot
              and not (a.application_id = app and a.attempt_no = vp.attempt_no)) then
    raise exception 'SLOT_TAKEN' using errcode = '23505';
  end if;

  update public.interview_assignments a
     set interviewer_id = iid, slot_datetime = slot, meet_link = coalesce(link, a.meet_link), attendance = 'scheduled',
         reschedule_count = coalesce(a.reschedule_count, 0) + 1
   where a.application_id = app and a.attempt_no = vp.attempt_no;
  get diagnostics n = row_count;
  if n = 0 then
    insert into public.interview_assignments (application_id, attempt_no, interviewer_id, slot_datetime, meet_link, attendance, reschedule_count)
    values (app, vp.attempt_no, iid, slot, link, 'scheduled', 0);
  end if;
  if vp.stage <> 'interview_scheduled' or vp.status <> 'active' then
    perform public.vsat__move_checked(app, 'interview_scheduled', 'active',
      case when vp.status <> 'active' then 'interview assigned' end, null, 'manual');
  end if;
  return public.vsat_student(app);
end $$;

-- the interview form. p: {application_id, communication, logic, passion, achievements, why_program (1–5),
--   remarks?{communication,logic,passion,achievements,why_program}, cheating_seen, interviewer_verdict,
--   coding_talent?, cert_asked?, drop_year?, previous_jee?, jee_pct?, jee_maths_pct?, expected_jee_pct?,
--   other_exams?, class10_pct?, class11_pct?, class12_pct?, financial_capability?, financial_reason?, why_accept?}
create or replace function public.vsat_submit_interview(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  app text; vp public.vsat_pipeline; ia public.interview_assignments; v_campus text; mgr boolean;
  c numeric; l numeric; pa numeric; ac numeric; w numeric; rem jsonb := '{}'::jsonb; k text; calc jsonb; cheat boolean; verdict text;
  fin text;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['application_id', 'communication', 'logic', 'passion', 'achievements', 'why_program', 'remarks',
    'cheating_seen', 'interviewer_verdict', 'coding_talent', 'cert_asked', 'drop_year', 'previous_jee', 'jee_pct', 'jee_maths_pct',
    'expected_jee_pct', 'other_exams', 'class10_pct', 'class11_pct', 'class12_pct', 'financial_capability', 'financial_reason', 'why_accept']);
  app := public.vsat__txt(p, 'application_id', 64, true);
  select * into vp from public.vsat_pipeline where application_id = app;
  if not found then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select public.vsat__campus_key(am.campus_applied) into v_campus from public.application_manager am where am.application_id = app;
  mgr := public.vsat__can_manage(v_campus);
  if not mgr and not public.vsat__is_assigned('interviewer', app, vp.attempt_no) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if vp.stage <> 'interview_scheduled' then raise exception 'WRONG_STAGE' using errcode = '22023'; end if;
  select * into ia from public.interview_assignments a where a.application_id = app and a.attempt_no = vp.attempt_no order by a.created_at desc limit 1;
  if not found then raise exception 'NEEDS_INTERVIEWER' using errcode = '22023'; end if;

  -- the five parts: whole numbers 1–5
  foreach k in array array['communication', 'logic', 'passion', 'achievements', 'why_program'] loop
    if public.vsat__num(p, k, 1, 5, true) not in (1, 2, 3, 4, 5) then raise exception 'BAD_VALUE: %', k using errcode = '22023'; end if;
  end loop;
  c := (p->>'communication')::numeric; l := (p->>'logic')::numeric; pa := (p->>'passion')::numeric;
  ac := (p->>'achievements')::numeric; w := (p->>'why_program')::numeric;
  if p ? 'remarks' and jsonb_typeof(p->'remarks') <> 'null' then
    if jsonb_typeof(p->'remarks') <> 'object' then raise exception 'BAD_VALUE: remarks' using errcode = '22023'; end if;
    perform public.vsat__check_keys(p->'remarks', array['communication', 'logic', 'passion', 'achievements', 'why_program']);
    foreach k in array array['communication', 'logic', 'passion', 'achievements', 'why_program'] loop
      if public.vsat__txt(p->'remarks', k, 1000, false) is not null then rem := rem || jsonb_build_object(k, public.vsat__txt(p->'remarks', k, 1000, false)); end if;
    end loop;
  end if;
  cheat := public.vsat__bool(p, 'cheating_seen', true);
  verdict := public.vsat__txt(p, 'interviewer_verdict', 20, true);
  if verdict not in ('selected', 'maybe', 'not_selected') then raise exception 'BAD_VALUE: interviewer_verdict' using errcode = '22023'; end if;
  fin := public.vsat__txt(p, 'financial_capability', 10, false);
  if fin is not null and fin not in ('low', 'medium', 'high') then raise exception 'BAD_VALUE: financial_capability' using errcode = '22023'; end if;

  calc := public.vsat_calc_interview(c, l, pa, ac, w, coalesce(ia.slot_datetime, now())::date);

  update public.interview_assignments a set
    rubric_behavioural = c, rubric_math = l, rubric_passion = pa, rubric_achievements = ac, rubric_why_program = w,
    weighted_avg = (calc->>'score')::numeric, weights_from = (calc->>'weights_from')::date, calc_verdict = calc->>'suggested_verdict',
    interviewer_verdict = verdict, result = case when cheat then 'not_selected' else calc->>'suggested_verdict' end,
    remarks = nullif(rem, '{}'::jsonb), cheating_seen = cheat,
    coding_talent = public.vsat__bool(p, 'coding_talent', false), cert_asked = public.vsat__bool(p, 'cert_asked', false),
    drop_year = public.vsat__bool(p, 'drop_year', false), previous_jee = public.vsat__txt(p, 'previous_jee', 200, false),
    jee_pct = public.vsat__num(p, 'jee_pct', 0, 100, false), jee_maths_pct = public.vsat__num(p, 'jee_maths_pct', 0, 100, false),
    expected_jee_pct = public.vsat__num(p, 'expected_jee_pct', 0, 100, false), other_exams = public.vsat__txt(p, 'other_exams', 300, false),
    class10_pct = public.vsat__num(p, 'class10_pct', 0, 100, false), class11_pct = public.vsat__num(p, 'class11_pct', 0, 100, false),
    class12_pct = public.vsat__num(p, 'class12_pct', 0, 100, false), financial_capability = fin,
    financial_reason = public.vsat__txt(p, 'financial_reason', 500, false), why_accept = public.vsat__txt(p, 'why_accept', 1500, false),
    attendance = 'done', submitted_at = now(), submitted_by = auth.uid()
   where a.id = ia.id;

  if vp.attempt_no = 2 then
    update public.application_manager set interview_weighted_avg_2 = (calc->>'score')::numeric,
           interview_result_2 = case when cheat then 'not_selected' else calc->>'suggested_verdict' end where application_id = app;
  else
    update public.application_manager set interview_weighted_avg_1 = (calc->>'score')::numeric,
           interview_result_1 = case when cheat then 'not_selected' else calc->>'suggested_verdict' end where application_id = app;
  end if;

  perform public.vsat__move(app, 'interviewed', 'active', null, 'manual', auth.uid(), null);
  if cheat then
    perform public.vsat__move(app, 'interviewed', 'not_selected', 'cheating seen in interview', 'auto', auth.uid(), null);
  elsif calc->>'suggested_verdict' = 'selected' and verdict = 'selected' then
    perform public.vsat__move(app, 'pi_cleared', 'active', 'calculated and interviewer verdicts both selected', 'auto', auth.uid(), null);
  end if;
  return jsonb_build_object('score', calc->'score', 'ranking', calc->'ranking', 'calc_verdict', calc->'suggested_verdict',
                            'interviewer_verdict', verdict, 'stage', (select vp2.stage from public.vsat_pipeline vp2 where vp2.application_id = app),
                            'status', (select vp2.status from public.vsat_pipeline vp2 where vp2.application_id = app));
end $$;

-- ── counselling ───────────────────────────────────────────────────────────────────────
-- p: {application_id, counsellor_id, slot_datetime, meeting_link?}
create or replace function public.vsat_assign_counsellor(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare app text; cid uuid; slot timestamptz; link text; vp public.vsat_pipeline; v_campus text; n int;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['application_id', 'counsellor_id', 'slot_datetime', 'meeting_link']);
  app := public.vsat__txt(p, 'application_id', 64, true);
  select * into vp from public.vsat_pipeline where application_id = app;
  if not found then
    if public.vsat__can_manage(null) then raise exception 'NOT_IN_PIPELINE' using errcode = 'P0002'; end if;
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select public.vsat__campus_key(am.campus_applied) into v_campus from public.application_manager am where am.application_id = app;
  if not public.vsat__can_manage(v_campus) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  begin cid := (public.vsat__txt(p, 'counsellor_id', 40, true))::uuid; exception when invalid_text_representation then raise exception 'BAD_VALUE: counsellor_id' using errcode = '22023'; end;
  -- strict ISO 8601 with a timezone (Postgres would also accept words like 'tomorrow')
  if public.vsat__txt(p, 'slot_datetime', 40, true) !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$' then raise exception 'BAD_VALUE: slot_datetime' using errcode = '22023'; end if;
  begin slot := (public.vsat__txt(p, 'slot_datetime', 40, true))::timestamptz; exception when others then raise exception 'BAD_VALUE: slot_datetime' using errcode = '22023'; end;
  link := public.vsat__txt(p, 'meeting_link', 300, false);
  if link is not null and link !~ '^https://[a-z0-9.-]+/' then raise exception 'BAD_VALUE: meeting_link' using errcode = '22023'; end if;
  if not exists (select 1 from public.vsat_team t where t.user_id = cid and t.role = 'counsellor' and t.active) then
    raise exception 'NOT_A_COUNSELLOR' using errcode = '22023';
  end if;
  if vp.stage not in ('pi_cleared', 'counselling_scheduled') or vp.status = 'not_selected' then
    raise exception 'WRONG_STAGE' using errcode = '22023';
  end if;
  if exists (select 1 from public.counselling_assignments a where a.counsellor_id = cid and a.slot_datetime = slot
              and not (a.application_id = app and a.attempt_no = vp.attempt_no)) then
    raise exception 'SLOT_TAKEN' using errcode = '23505';
  end if;

  update public.counselling_assignments a
     set counsellor_id = cid, slot_datetime = slot, zoom_link = coalesce(link, a.zoom_link), attendance = 'scheduled',
         reschedule_count = coalesce(a.reschedule_count, 0) + 1
   where a.application_id = app and a.attempt_no = vp.attempt_no;
  get diagnostics n = row_count;
  if n = 0 then
    insert into public.counselling_assignments (application_id, attempt_no, counsellor_id, slot_datetime, zoom_link, attendance, reschedule_count)
    values (app, vp.attempt_no, cid, slot, link, 'scheduled', 0);
  end if;
  if vp.stage <> 'counselling_scheduled' or vp.status <> 'active' then
    perform public.vsat__move_checked(app, 'counselling_scheduled', 'active',
      case when vp.status <> 'active' then 'counselling assigned' end, null, 'manual');
  end if;
  return public.vsat_student(app);
end $$;

create or replace function public.vsat_scholarship_preview(p_application_id text)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare inp jsonb; v_campus text; d uuid; sc jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  if not public.vsat__can_view(p_application_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select public.vsat__campus_key(am.campus_applied), am.exam_date_id into v_campus, d from public.application_manager am where am.application_id = p_application_id;
  if v_campus is null then raise exception 'CAMPUS_MISSING' using errcode = '22023'; end if;
  inp := public.vsat__scholarship_inputs(p_application_id);
  sc := public.vsat_calc_scholarship(inp, v_campus, d);
  return sc || jsonb_build_object('inputs', inp, 'campus', v_campus,
           'jee_floor_enabled', (select c.jee_floor_enabled from public.vsat_campus_settings c where c.campus = v_campus),
           'programme_fee', (select c.programme_fee from public.vsat_campus_settings c where c.campus = v_campus));
end $$;

-- p: {application_id, chosen_step, special_rating?, actual_pct?, actual_reason?, remarks?}
create or replace function public.vsat_submit_counselling(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  app text; vp public.vsat_pipeline; ca public.counselling_assignments; v_campus text; mgr boolean;
  pre jsonb; step numeric; rating int; fin jsonb; actual numeric; reason text;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['application_id', 'chosen_step', 'special_rating', 'actual_pct', 'actual_reason', 'remarks']);
  app := public.vsat__txt(p, 'application_id', 64, true);
  select * into vp from public.vsat_pipeline where application_id = app;
  if not found then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select public.vsat__campus_key(am.campus_applied) into v_campus from public.application_manager am where am.application_id = app;
  mgr := public.vsat__can_manage(v_campus);
  if not mgr and not public.vsat__is_assigned('counsellor', app, vp.attempt_no) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if vp.stage <> 'counselling_scheduled' then raise exception 'WRONG_STAGE' using errcode = '22023'; end if;
  select * into ca from public.counselling_assignments c where c.application_id = app and c.attempt_no = vp.attempt_no order by c.created_at desc limit 1;
  if not found then raise exception 'NEEDS_COUNSELLOR' using errcode = '22023'; end if;

  pre := public.vsat_scholarship_preview(app);
  step := public.vsat__num(p, 'chosen_step', 0, 100, true);
  if not (pre->'award_steps' @> to_jsonb(step)) and not exists (select 1 from jsonb_array_elements(pre->'award_steps') e where (e::text)::numeric = step) then
    raise exception 'BAD_VALUE: chosen_step' using errcode = '22023';
  end if;
  rating := public.vsat__num(p, 'special_rating', 1, 5, false)::int;
  fin := public.vsat_calc_final_scholarship(step, (pre->>'jee_floor')::numeric, rating, v_campus);
  actual := coalesce(public.vsat__num(p, 'actual_pct', 0, 100, false), (fin->>'pct')::numeric);
  reason := public.vsat__txt(p, 'actual_reason', 500, false);
  if actual <> (fin->>'pct')::numeric and char_length(coalesce(reason, '')) < 3 then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;

  update public.counselling_assignments c set
    calc_score = (pre->>'score')::numeric, calc_case = pre->>'case', calc_category = (pre->>'category')::int, award_steps = pre->'award_steps',
    calc_inputs = pre->'inputs', chosen_step = step, jee_floor = (pre->>'jee_floor')::numeric, special_rating = rating,
    bonus_applied = (fin->>'bonus_applied')::boolean, calculated_pct = (fin->>'pct')::numeric, actual_pct = actual,
    actual_reason = case when actual <> (fin->>'pct')::numeric then reason end, counsellor_remarks = public.vsat__txt(p, 'remarks', 2000, false),
    scholarship_pct = actual, scholarship_category = (pre->>'category')::int,
    pay_timeline_days = (select s.offer_days from public.vsat_campus_settings s where s.campus = v_campus),
    attendance = 'done', submitted_at = now(), submitted_by = auth.uid()
   where c.id = ca.id;

  if vp.attempt_no = 2 then
    update public.application_manager set counselling_status_2 = 'done', scholarship_pct_2 = actual, scholarship_category_2 = (pre->>'category')::int,
           scholarship_percentage = actual where application_id = app;
  else
    update public.application_manager set counselling_status_1 = 'done', scholarship_pct_1 = actual, scholarship_category_1 = (pre->>'category')::int,
           scholarship_percentage = actual where application_id = app;
  end if;

  perform public.vsat__move(app, 'counselled', 'active', case when actual <> (fin->>'pct')::numeric then reason end, 'manual', auth.uid(), null);
  return jsonb_build_object('calculated_pct', fin->'pct', 'actual_pct', actual, 'category', pre->'category', 'bonus_applied', fin->'bonus_applied',
                            'jee_floor_applied', fin->'jee_floor_applied', 'stage', 'counselled');
end $$;

-- ── panel list: same as 0080 plus an interview / counselling summary per row ──────────
create or replace function public.vsat_pipeline_list(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  uid uuid := auth.uid(); f_admin boolean; f_adm boolean; f_adm_all boolean; adm_campuses text[]; f_int boolean; f_cou boolean;
  f_contact boolean; v_stage text; v_status text; v_date uuid; v_campus text; v_q text; v_limit int; v_offset int;
  total int; rows jsonb; counts jsonb; k text; v_like text;
begin
  if uid is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(coalesce(p, '{}'::jsonb), array['stage', 'status', 'exam_date_id', 'campus', 'q', 'limit', 'offset']);
  foreach k in array array['stage', 'status', 'exam_date_id', 'campus', 'q'] loop
    if p ? k and jsonb_typeof(p->k) not in ('string', 'null') then raise exception 'BAD_VALUE: %', k using errcode = '22023'; end if;
  end loop;
  foreach k in array array['limit', 'offset'] loop
    if p ? k and jsonb_typeof(p->k) not in ('number', 'null') then raise exception 'BAD_VALUE: %', k using errcode = '22023'; end if;
  end loop;

  f_admin := coalesce(public.is_admin(), false);
  select bool_or(true), bool_or(t.campus is null), array_agg(t.campus) filter (where t.campus is not null)
    into f_adm, f_adm_all, adm_campuses
    from public.vsat_team t where t.user_id = uid and t.role = 'admissions' and t.active;
  f_adm := coalesce(f_adm, false); f_adm_all := coalesce(f_adm_all, false);
  f_int := exists (select 1 from public.vsat_team t where t.user_id = uid and t.role = 'interviewer' and t.active);
  f_cou := exists (select 1 from public.vsat_team t where t.user_id = uid and t.role = 'counsellor' and t.active);
  if not (f_admin or f_adm or f_int or f_cou) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  f_contact := f_admin or f_adm;

  v_stage := nullif(p->>'stage', '');  v_status := nullif(p->>'status', '');  v_campus := nullif(p->>'campus', '');
  if v_stage is not null and public.vsat__stage_order(v_stage) is null then raise exception 'BAD_STAGE' using errcode = '22023'; end if;
  if v_status is not null and v_status not in ('active', 'not_selected', 'absent', 'on_hold') then raise exception 'BAD_STATUS' using errcode = '22023'; end if;
  if v_campus is not null and v_campus not in ('pune', 'gurugram') then raise exception 'BAD_VALUE: campus' using errcode = '22023'; end if;
  begin v_date := nullif(p->>'exam_date_id', '')::uuid; exception when others then raise exception 'BAD_VALUE: exam_date_id' using errcode = '22023'; end;
  v_q := nullif(btrim(coalesce(p->>'q', '')), '');
  if v_q is not null and (char_length(v_q) < 2 or char_length(v_q) > 100) then raise exception 'BAD_VALUE: q' using errcode = '22023'; end if;
  v_like := replace(replace(replace(coalesce(v_q, ''), '\', '\\'), '%', '\%'), '_', '\_');
  v_limit  := least(greatest(coalesce((p->>'limit')::numeric, 50), 1), 200)::int;
  v_offset := greatest(coalesce((p->>'offset')::numeric, 0), 0)::int;

  with vis as (
    select vp.application_id, vp.attempt_no, vp.stage, vp.status, vp.stage_changed_at,
           public.vsat__campus_key(am.campus_applied) campus
      from public.vsat_pipeline vp join public.application_manager am on am.application_id = vp.application_id
     where (f_admin
            or (f_adm and (f_adm_all or public.vsat__campus_key(am.campus_applied) is null
                           or public.vsat__campus_key(am.campus_applied) = any(adm_campuses)))
            or (f_int and exists (select 1 from public.interview_assignments a where a.application_id = vp.application_id
                                     and a.attempt_no = vp.attempt_no and a.interviewer_id = uid))
            or (f_cou and exists (select 1 from public.counselling_assignments a where a.application_id = vp.application_id
                                     and a.attempt_no = vp.attempt_no and a.counsellor_id = uid)))
       and (v_status is null or vp.status = v_status)
       and (v_date is null or am.exam_date_id = v_date)
       and (v_campus is null or public.vsat__campus_key(am.campus_applied) = v_campus)
       and (v_q is null or am.registered_name ilike '%' || v_like || '%'
                        or (f_contact and (am.registered_email ilike '%' || v_like || '%' or am.registered_mobile like '%' || v_like || '%'))
                        or am.application_no = v_q or am.application_id = v_q)
  ), filt as (
    select * from vis where v_stage is null or vis.stage = v_stage
  ), page as (
    select * from filt order by filt.stage_changed_at desc, filt.application_id limit v_limit offset v_offset
  )
  select (select coalesce(jsonb_object_agg(s.stage, s.n), '{}'::jsonb) from (select vis.stage, count(*) n from vis group by vis.stage) s),
         (select count(*) from filt),
         (select coalesce(jsonb_agg(jsonb_build_object(
             'application_id', pg.application_id, 'application_no', am.application_no, 'name', am.registered_name,
             'email', case when f_contact then am.registered_email end,
             'mobile', case when f_contact then am.registered_mobile end,
             'campus', pg.campus, 'exam_date_id', am.exam_date_id, 'batch', d.label, 'attempt_no', pg.attempt_no,
             'stage', pg.stage, 'status', pg.status, 'stage_changed_at', pg.stage_changed_at,
             'exam_percentile', am.exam_percentile, 'effective', public.vsat__effective(pg.application_id),
             'interview', (select jsonb_build_object('interviewer', coalesce(ip.full_name, ip.email), 'interviewer_id', ia.interviewer_id,
                                 'slot', ia.slot_datetime, 'meet_link', ia.meet_link, 'attendance', ia.attendance, 'score', ia.weighted_avg,
                                 'calc_verdict', coalesce(ia.calc_verdict, ia.result), 'interviewer_verdict', ia.interviewer_verdict,
                                 'cheating_seen', ia.cheating_seen, 'submitted', ia.submitted_at is not null or ia.weighted_avg is not null)
                             from public.interview_assignments ia left join public.profiles ip on ip.id = ia.interviewer_id
                            where ia.application_id = pg.application_id and ia.attempt_no = pg.attempt_no order by ia.created_at desc limit 1),
             'counselling', (select jsonb_build_object('counsellor', coalesce(cp.full_name, cp.email), 'counsellor_id', ca.counsellor_id,
                                   'slot', ca.slot_datetime, 'meeting_link', ca.zoom_link, 'attendance', ca.attendance,
                                   'category', ca.scholarship_category, 'pct', ca.scholarship_pct)
                               from public.counselling_assignments ca left join public.profiles cp on cp.id = ca.counsellor_id
                              where ca.application_id = pg.application_id and ca.attempt_no = pg.attempt_no order by ca.created_at desc limit 1))
             order by pg.stage_changed_at desc, pg.application_id), '[]'::jsonb)
            from page pg join public.application_manager am on am.application_id = pg.application_id
            left join public.vsat_exam_dates d on d.id = am.exam_date_id)
    into counts, total, rows;

  return jsonb_build_object('total', total, 'counts', counts, 'rows', rows, 'limit', v_limit, 'offset', v_offset);
end $$;

-- ── grants ────────────────────────────────────────────────────────────────────────────
revoke all on function public.vsat__num(jsonb, text, numeric, numeric, boolean) from public, anon, authenticated;
revoke all on function public.vsat__txt(jsonb, text, int, boolean) from public, anon, authenticated;
revoke all on function public.vsat__bool(jsonb, text, boolean) from public, anon, authenticated;
revoke all on function public.vsat__any_role() from public, anon, authenticated;
revoke all on function public.vsat__scholarship_inputs(text) from public, anon, authenticated;

revoke all on function public.vsat_team_list() from public, anon;
revoke all on function public.vsat_batches() from public, anon;
revoke all on function public.vsat_student(text) from public, anon;
revoke all on function public.vsat_assign_interview(jsonb) from public, anon;
revoke all on function public.vsat_submit_interview(jsonb) from public, anon;
revoke all on function public.vsat_assign_counsellor(jsonb) from public, anon;
revoke all on function public.vsat_scholarship_preview(text) from public, anon;
revoke all on function public.vsat_submit_counselling(jsonb) from public, anon;
revoke all on function public.vsat_pipeline_list(jsonb) from public, anon;
grant execute on function public.vsat_team_list() to authenticated;
grant execute on function public.vsat_batches() to authenticated;
grant execute on function public.vsat_student(text) to authenticated;
grant execute on function public.vsat_assign_interview(jsonb) to authenticated;
grant execute on function public.vsat_submit_interview(jsonb) to authenticated;
grant execute on function public.vsat_assign_counsellor(jsonb) to authenticated;
grant execute on function public.vsat_scholarship_preview(text) to authenticated;
grant execute on function public.vsat_submit_counselling(jsonb) to authenticated;
grant execute on function public.vsat_pipeline_list(jsonb) to authenticated;
