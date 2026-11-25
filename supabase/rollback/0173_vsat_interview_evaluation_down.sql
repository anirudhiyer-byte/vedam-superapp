-- Rollback of 0173_vsat_interview_evaluation: removes the PI-cleared email (trigger, functions, outbox, step), the two
-- Interview Evaluation RPCs and the verdict helper; puts back vsat_profile_start (0085), vsat__grid / vsat__grid_catalog (0172),
-- vsat__grid_virt_expr (0135) and vsat_submit_interview (0166) exactly (create or replace keeps their grants); then drops the
-- new columns. The verdicts and the saved scores are lost (they exist only since 0173).

drop trigger if exists vsat_stage_notice on public.vsat_pipeline;
drop function if exists public.vsat__on_stage_notice();
drop function if exists public.vsat_stage_notices_claim(jsonb);
drop function if exists public.vsat_stage_notice_done(jsonb);
drop table if exists public.vsat_stage_notices;
delete from public.vsat_comm_steps where step_key = 'pi_cleared';
alter table public.vsat_comm_steps drop constraint if exists vsat_comm_steps_step_key_check;
alter table public.vsat_comm_steps add constraint vsat_comm_steps_step_key_check check (step_key in (
  'first_half', 'application_started', 'payment_reminder_24h', 'payment_confirmed',
  'interview_invite', 'interview_rescheduled', 'interview_cancelled',
  'interviewer_invite', 'interviewer_rescheduled', 'interviewer_cancelled',
  'offer_released',
  'counselling_invite', 'counselling_rescheduled', 'counselling_cancelled',
  'counsellor_invite', 'counsellor_rescheduled', 'counsellor_cancelled',
  'offer_reminder', 'offer_lapsed'));

drop function if exists public.vsat_interview_set_verdicts(jsonb);
drop function if exists public.vsat_interview_analysis(jsonb);

create or replace function public.vsat_profile_start(p_application_id text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  vp public.vsat_pipeline; am public.application_manager; ia public.interview_assignments; ca public.counselling_assignments;
  v_campus text; run uuid; f jsonb; iv_name text; vsat_pct numeric;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  if p_application_id is null or char_length(p_application_id) > 64 then raise exception 'BAD_VALUE: application_id' using errcode = '22023'; end if;
  select * into vp from public.vsat_pipeline where application_id = p_application_id;
  if not found then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into am from public.application_manager where application_id = p_application_id;
  v_campus := public.vsat__campus_key(am.campus_applied);
  if not public.vsat__can_manage(v_campus) and not public.vsat__is_assigned('counsellor', p_application_id, vp.attempt_no) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into ca from public.counselling_assignments c
   where c.application_id = p_application_id and c.attempt_no = vp.attempt_no order by c.created_at desc limit 1;
  if not found then raise exception 'NEEDS_COUNSELLOR' using errcode = '22023'; end if;

  -- limits: 30 runs per user per hour; one run per student at a time (2 minutes)
  if (select count(*) from public.vsat_profile_runs r where r.user_id = auth.uid() and r.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'RATE_LIMITED' using errcode = '54000';
  end if;
  if exists (select 1 from public.vsat_profile_runs r where r.application_id = p_application_id and r.status = 'started'
               and r.created_at > now() - interval '2 minutes') then
    raise exception 'IN_PROGRESS' using errcode = '55006';
  end if;

  select * into ia from public.interview_assignments a
   where a.application_id = p_application_id and a.attempt_no = vp.attempt_no order by a.created_at desc limit 1;
  select coalesce(p.full_name, p.email) into iv_name from public.profiles p where p.id = ia.interviewer_id;
  vsat_pct := case when am.exam_max_marks > 0 then round(am.exam_obtained_marks / am.exam_max_marks * 100, 2) end;

  -- the sheet's fields (first + last name as one, country left out: not stored; labels as in the sheet, scales added
  -- where the sheet notes them); empty ones are skipped. No email, phone or address.
  select coalesce(jsonb_agg(jsonb_build_array(x.label, x.val) order by x.n), '[]'::jsonb) into f
    from (values
      (1,  'Name', am.registered_name),
      (2,  'Gender', am.gender),
      (3,  'DOB', am.date_of_birth::text),
      (4,  'Campus Preference', am.campus_applied),
      (5,  'State', am.state),
      (6,  'City', am.city),
      (7,  'Year Of Passing 10th Class', am.class10_year::text),
      (8,  'Class 10th Percentage', am.class10_percentage::text),
      (9,  'Math Score In Xth/SSC', am.class10_maths_percentage::text),
      (10, 'Year Of Passing 12th Class', am.class12_year::text),
      (11, 'Score / Slabs (12th)', am.class12_percentage::text),
      (12, 'Math Score In XIIth', am.class12_maths_percentage::text),
      (13, 'PCM marks in 12th (Physics / Chemistry / Maths)',
           case when coalesce(am.marks_physics_12, am.marks_chemistry_12, am.marks_maths_12) is not null
                then concat_ws(' / ', am.marks_physics_12, am.marks_chemistry_12, am.marks_maths_12) end),
      (14, 'Registered For JEE Mains', case am.jee_registered when true then 'Yes' when false then 'No' end),
      (15, 'When Did You Appear For JEE Mains', am.jee_appeared_when::text),
      (16, 'JEE Mains Percentile', coalesce(ia.jee_pct, case when am.jee_registered then am.entrance_percentile end)::text),
      (17, 'JEE Mains Maths Percentile', coalesce(ia.jee_maths_pct, case when am.jee_registered then am.jee_main_maths_percentile end)::text),
      (18, 'Studied Computer Science', case am.studied_cs when true then 'Yes' when false then 'No' end),
      (19, 'Computer Science Experience', am.cs_experience::text),
      (20, 'VPS (out of 10)', am.vps_score::text),
      (21, 'VSAT Obtained Score (correct answers out of 50)', am.exam_obtained_marks::text),
      (22, 'VSAT Percentage', vsat_pct::text),
      (23, 'VSAT section scores and time taken', case when am.exam_sections is not null and am.exam_sections::text not in ('null', '{}', '[]') then am.exam_sections::text end),
      (24, 'Interview Score (out of 5)', ia.weighted_avg::text),
      (25, 'Interviewer Name', iv_name),
      (26, 'Fathers Occupation', am.father_occupation),
      (27, 'Mothers Occupation', am.mother_occupation),
      (28, 'Communication & Behavioural Skills (out of 5)', ia.rubric_behavioural::text),
      (29, 'Behavioural & Communication — Remarks', ia.remarks->>'communication'),
      (30, 'Guesstimate & Logical Reasoning (out of 5)', ia.rubric_math::text),
      (31, 'Cheating seen while solving questions', case ia.cheating_seen when true then 'Yes' when false then 'No' end),
      (32, 'Passion & Motivation for Computer Science (out of 5)', ia.rubric_passion::text),
      (33, 'Passion & Motivation for CS — Remarks', ia.remarks->>'passion'),
      (34, 'Achievements & Extracurricular Activities (out of 5)', ia.rubric_achievements::text),
      (35, 'National-level certificate asked to be shared', case ia.cert_asked when true then 'Yes' when false then 'No' end),
      (36, 'Achievement & Extracurricular — Remarks', ia.remarks->>'achievements'),
      (37, 'Why This Program? (out of 5)', ia.rubric_why_program::text),
      (38, 'Why This Program — Remarks', ia.remarks->>'why_program'),
      (39, 'Guesstimate & Logical Reasoning — Remarks', ia.remarks->>'logic'),
      (40, 'Financial Capability (High: ₹15L+ a year; Medium: ₹6–15L; Low: under ₹6L)', initcap(ia.financial_capability)),
      (41, 'Why? (Financial explanation)', ia.financial_reason),
      (42, 'Why should Vedam accept your application and what could the batch learn from you?', ia.why_accept),
      (43, 'Scholarship Awarded (%)', coalesce(ca.actual_pct, ca.scholarship_pct)::text),
      (44, 'Final Verdict', coalesce(ia.interviewer_verdict, ia.result))
    ) x(n, label, val)
   where x.val is not null and btrim(x.val) <> '';

  insert into public.vsat_profile_runs (application_id, attempt_no, user_id) values (p_application_id, vp.attempt_no, auth.uid())
  returning id into run;
  return jsonb_build_object('run_id', run, 'fields', f);
end $$;

CREATE OR REPLACE FUNCTION public.vsat__grid_catalog()
 RETURNS TABLE(key text, grp text, typ text, sens text, virt boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with real_cols as (
    select a.attname::text as key, a.atttypid::regtype::text as pgtype, a.attnum
      from pg_catalog.pg_attribute a
     where a.attrelid = 'public.application_manager'::regclass and a.attnum > 0 and not a.attisdropped
  ), virt as (
    select * from (values
      ('stage',                      'Pipeline',    'stage',  10), ('status',               'Pipeline',    'status', 11),
      ('stage_changed_at',           'Pipeline',    'ts',     12), ('attempt_no',           'Pipeline',    'num',    13),
      ('campus',                     'Pipeline',    'text',   14), ('early_registration',   'Pipeline',    'bool',   15),
      ('vsat',                       'Exam',        'text',   16),
      ('vps_effective',              'Exam',        'num',    17), ('vps_override',         'Exam',        'num',    18),
      ('eligible_effective',         'Exam',        'bool',   19), ('eligible_override',    'Exam',        'bool',   20),
      ('vps_calculated',             'Exam',        'num',    36), ('exam_percentage',      'Exam',        'num',    37),
      ('exam_section_maths',         'Exam',        'num',    38), ('exam_section_lr',      'Exam',        'num',    39),
      ('exam_section_cs',            'Exam',        'num',    40), ('proctoring',           'Exam',        'text',   41),
      ('class12_result',             'Academics',   'text',   42), ('class10_eligible',     'Academics',   'bool',   43),
      ('class12_eligible',           'Academics',   'bool',   44),
      ('interviewer',                'Interview',   'text',   21), ('interview_slot',       'Interview',   'ts',     22),
      ('interview_attendance',       'Interview',   'text',   23), ('interview_score',      'Interview',   'num',    24),
      ('interview_calc_verdict',     'Interview',   'text',   25), ('interviewer_verdict',  'Interview',   'text',   26),
      ('cheating_seen',              'Interview',   'bool',   27), ('interview_meet',       'Interview',   'text',   28),
      ('counsellor',                 'Counselling', 'text',   30), ('counselling_slot',     'Counselling', 'ts',     31),
      ('counselling_attendance',     'Counselling', 'text',   32), ('counselling_category', 'Counselling', 'num',    33),
      ('counselling_pct',            'Counselling', 'num',    34), ('counselling_calculated_pct', 'Counselling', 'num', 35),
      ('counselling_meet',           'Counselling', 'text',   45),
      -- vsat_grid_meet_link: how many times each booking was rescheduled (asked by the owner, 24 Nov)
      ('interview_reschedules',      'Interview',   'num',    29), ('counselling_reschedules', 'Counselling', 'num', 46),
      -- vsat_exam_evaluation: the rest of the "14th July" and "Test Result" sheet columns (owner's review, 24 Nov).
      -- Not filterable (no vsat__grid_virt_expr); values from vsat__exam_sheet_cols
      ('first_name',                 'Personal',    'text',   47), ('last_name',            'Personal',    'text',   48),
      ('user_id',                    'Application', 'text',   49),
      ('exam_test_name',             'Exam',        'text',   50), ('exam_started_at',      'Exam',        'text',   51),
      ('exam_ended_at',              'Exam',        'text',   52), ('exam_time_taken',      'Exam',        'text',   53),
      ('exam_total_questions',       'Exam',        'num',    54), ('exam_attempted',       'Exam',        'num',    55),
      ('exam_correct',               'Exam',        'num',    56), ('exam_incorrect',       'Exam',        'num',    57),
      ('exam_unattempted',           'Exam',        'num',    58)
    ) v(key, grp, typ, ord)
  )
  select v.key, v.grp, v.typ, 'open'::text, true from virt v
  union all
  select c.key,
         case
           -- the old sheet's per-attempt copies (vsat_*_1/_2, vps_score_1/_2): kept for history, out of the Exam group
           when c.key ~ '^(vsat_(score_(lr|maths|cs)|total|percentile|result|attempt_date|appeared|slot_datetime|campaign_id)|vps_score)_[12]$' then 'Old sheet (per attempt)'
           when c.key like '%utm%'                                                        then 'Marketing'
           when c.key like 'payment%' or c.key in ('application_fee_amount', 'currency', 'order_id', 'transaction_id', 'cash_receipt_date')
                or c.key like 'discount%' or c.key like 'seat_booking%' or c.key like 'enrollment%'   then 'Payment'
           when c.key like 'offer%'                                                       then 'Offer'
           when c.key like 'counselling%' or c.key like 'scholarship%'                    then 'Counselling'
           when c.key like 'interview%'                                                   then 'Interview'
           when c.key like 'vsat%' or c.key like 'vps%' or c.key like 'wheebox%' or c.key like 'exam%' or c.key like 'mock%'
                or c.key like '%card_download_date'                                        then 'Exam'
           when c.key like '%verification%' or c.key like '%\_url' or c.key = 'selected_id_type' then 'Documents'
           when c.key like 'father%' or c.key like 'mother%' or c.key like 'guardian%' or c.key = 'family_income' then 'Parents'
           when c.key like 'coding%' or c.key = 'taken_coding_exam'                       then 'Coding exams'
           when c.key like 'olympiad%' or c.key = 'participated_olympiad'                 then 'Olympiads'
           when c.key like 'jee%' or c.key like 'entrance%'                               then 'JEE & entrance'
           when c.key like 'class1%' or c.key like 'marks\_%' or c.key in ('studied_pcm', 'studied_cs', 'cs_experience', 'pcm_eligible') then 'Academics'
           when c.key in ('registered_name', 'registered_email', 'registered_mobile', 'gender', 'date_of_birth', 'residing_city',
                          'country', 'state', 'city', 'campus_applied', 'program', 'partner_university', 'current_education_level',
                          'class_12_stream', 'preferred_engineering_specialization', 'hostel_selection', 'campus_tour_date', 'campus_tour_time') then 'Personal'
           else 'Application' end,
         case c.pgtype
           when 'numeric' then 'num' when 'integer' then 'num' when 'bigint' then 'num' when 'boolean' then 'bool'
           when 'date' then 'date' when 'timestamp with time zone' then 'ts' when 'jsonb' then 'json' when 'uuid' then 'uuid'
           else 'text' end,
         case
           when c.key = 'payment_status' then 'hidden'  -- 0139: legacy dead column; real value is payment_stage_1
           when c.pgtype in ('jsonb', 'uuid') or c.key in ('application_id')                      then 'hidden'
           when c.key like '%\_url'                                                               then 'doc'
           when c.key ~ '(mobile|phone|email|contact|whatsapp)' or c.key = 'wheebox_login_id'      then 'contact'
           when c.key ~ '(payment|amount|order_id|txn|transaction|income|coupon|receipt|discount|currency|seat_booking)' then 'finance'
           else 'open' end,
         false
    from real_cols c
   where c.key not in (select key from virt)
   order by 5 desc, 1
$function$;

CREATE OR REPLACE FUNCTION public.vsat__grid(p jsonb, p_max integer, p_facets boolean, p_manager_only boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid := auth.uid(); f_admin boolean; f_adm boolean; f_adm_all boolean; adm_campuses text[]; f_int boolean; f_cou boolean; mgr boolean;
  v_scope text[]; v_stages text[]; v_statuses text[]; v_dates uuid[]; v_campuses text[]; v_cols text[]; v_ids text[];
  v_form text[]; v_pay text[]; v_ivs text[]; v_css text[];
  f_ids text[]; has_filters boolean := false; fl jsonb; fcol text; fop text; ftyp text; fwhere text := ''; frag text; fsym text; farr text[]; fcat record; fsql text;
  fexpr text;
  v_limit int; v_offset int; k text; s text;
  s_col text; s_vals text[]; s_pat text[]; s_dig text[]; s_ids text[]; s_any boolean := false; s_cat record;
  need_eff boolean; need_sheet boolean; total int; rows jsonb; facets jsonb;
begin
  if uid is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(coalesce(p, '{}'::jsonb),
    array['scope', 'stages', 'statuses', 'exam_date_ids', 'campuses', 'form_stages', 'payment_stages', 'interviewer_ids', 'counsellor_ids', 'filters', 'search', 'columns', 'application_ids', 'limit', 'offset']);
  foreach k in array array['scope', 'stages', 'statuses', 'exam_date_ids', 'campuses', 'form_stages', 'payment_stages', 'interviewer_ids', 'counsellor_ids', 'filters', 'columns', 'application_ids'] loop
    if p ? k and jsonb_typeof(p->k) not in ('array', 'null') then raise exception 'BAD_VALUE: %', k using errcode = '22023'; end if;
  end loop;
  foreach k in array array['limit', 'offset'] loop
    if p ? k and jsonb_typeof(p->k) not in ('number', 'null') then raise exception 'BAD_VALUE: %', k using errcode = '22023'; end if;
  end loop;
  if p ? 'search' and jsonb_typeof(p->'search') not in ('object', 'null') then raise exception 'BAD_VALUE: search' using errcode = '22023'; end if;

  -- roles (same as vsat_pipeline_list)
  f_admin := coalesce(public.is_admin(), false);
  select bool_or(true), bool_or(t.campus is null), array_agg(t.campus) filter (where t.campus is not null)
    into f_adm, f_adm_all, adm_campuses
    from public.vsat_team t where t.user_id = uid and t.role = 'admissions' and t.active;
  f_adm := coalesce(f_adm, false); f_adm_all := coalesce(f_adm_all, false);
  f_int := exists (select 1 from public.vsat_team t where t.user_id = uid and t.role = 'interviewer' and t.active);
  f_cou := exists (select 1 from public.vsat_team t where t.user_id = uid and t.role = 'counsellor' and t.active);
  if not (f_admin or f_adm or f_int or f_cou) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  mgr := f_admin or f_adm;
  if p_manager_only and not mgr then raise exception 'FORBIDDEN' using errcode = '42501'; end if;

  -- dropdown filters
  select array_agg(x) into v_scope from jsonb_array_elements_text(coalesce(p->'scope', '[]'::jsonb)) x;
  select array_agg(x) into v_stages from jsonb_array_elements_text(coalesce(p->'stages', '[]'::jsonb)) x;
  select array_agg(x) into v_statuses from jsonb_array_elements_text(coalesce(p->'statuses', '[]'::jsonb)) x;
  select array_agg(x) into v_campuses from jsonb_array_elements_text(coalesce(p->'campuses', '[]'::jsonb)) x;
  if v_scope is not null then foreach s in array v_scope loop
    if public.vsat__stage_order(s) is null then raise exception 'BAD_STAGE' using errcode = '22023'; end if; end loop; end if;
  if v_stages is not null then foreach s in array v_stages loop
    if public.vsat__stage_order(s) is null then raise exception 'BAD_STAGE' using errcode = '22023'; end if; end loop; end if;
  if v_statuses is not null then foreach s in array v_statuses loop
    if s not in ('active', 'not_selected', 'absent', 'on_hold') then raise exception 'BAD_STATUS' using errcode = '22023'; end if; end loop; end if;
  if v_campuses is not null then foreach s in array v_campuses loop
    if s not in ('pune', 'gurugram') then raise exception 'BAD_VALUE: campuses' using errcode = '22023'; end if; end loop; end if;
  begin
    select array_agg(x::uuid) into v_dates from jsonb_array_elements_text(coalesce(p->'exam_date_ids', '[]'::jsonb)) x;
  exception when others then raise exception 'BAD_VALUE: exam_date_ids' using errcode = '22023'; end;
  if coalesce(array_length(v_scope, 1), 0) > 20 or coalesce(array_length(v_stages, 1), 0) > 20 or coalesce(array_length(v_dates, 1), 0) > 50 then
    raise exception 'BAD_VALUE: filters' using errcode = '22023';
  end if;

  -- form-stage / payment-stage dropdowns (enum columns on application_manager; values checked against the label set)
  select array_agg(x) into v_form from jsonb_array_elements_text(coalesce(p->'form_stages', '[]'::jsonb)) x;
  if v_form is not null then
    if coalesce(array_length(v_form, 1), 0) > 20 then raise exception 'BAD_VALUE: form_stages' using errcode = '22023'; end if;
    foreach s in array v_form loop
      if not (s = any(enum_range(null::public.vm_form_stage)::text[])) then raise exception 'BAD_VALUE: form_stages' using errcode = '22023'; end if;
    end loop;
  end if;
  select array_agg(x) into v_pay from jsonb_array_elements_text(coalesce(p->'payment_stages', '[]'::jsonb)) x;
  if v_pay is not null then
    if not mgr then raise exception 'FORBIDDEN_COLUMN: payment_stage_1' using errcode = '42501'; end if;
    if coalesce(array_length(v_pay, 1), 0) > 20 then raise exception 'BAD_VALUE: payment_stages' using errcode = '22023'; end if;
    foreach s in array v_pay loop
      if not (s = any(enum_range(null::public.vm_payment_stage)::text[])) then raise exception 'BAD_VALUE: payment_stages' using errcode = '22023'; end if;
    end loop;
  end if;

  -- interviewer dropdown (0140): interviewer user ids, or 'none' = no interviewer yet
  select array_agg(x) into v_ivs from jsonb_array_elements_text(coalesce(p->'interviewer_ids', '[]'::jsonb)) x;
  if v_ivs is not null then
    if array_length(v_ivs, 1) > 50 then raise exception 'BAD_VALUE: interviewer_ids' using errcode = '22023'; end if;
    foreach s in array v_ivs loop
      if s <> 'none' and s !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'BAD_VALUE: interviewer_ids' using errcode = '22023';
      end if;
    end loop;
  end if;

  -- counsellor dropdown (0158): counsellor user ids, or 'none' = no counsellor yet
  select array_agg(x) into v_css from jsonb_array_elements_text(coalesce(p->'counsellor_ids', '[]'::jsonb)) x;
  if v_css is not null then
    if array_length(v_css, 1) > 50 then raise exception 'BAD_VALUE: counsellor_ids' using errcode = '22023'; end if;
    foreach s in array v_css loop
      if s <> 'none' and s !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'BAD_VALUE: counsellor_ids' using errcode = '22023';
      end if;
    end loop;
  end if;

  -- advanced filter builder: AND-ed clauses on real columns and on the whitelisted virtual ones (0135: VPS, eligibility,
  -- exam %, sections, proctoring — their SQL comes from vsat__grid_virt_expr, never from the request) → a set of
  -- application_ids that narrows everything
  if p ? 'filters' and jsonb_typeof(p->'filters') = 'array' then
    if jsonb_array_length(p->'filters') > 20 then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
    for fl in select value from jsonb_array_elements(p->'filters') loop
      if jsonb_typeof(fl) <> 'object' then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
      perform public.vsat__check_keys(fl, array['column', 'op', 'v']);
      fcol := nullif(btrim(coalesce(fl->>'column', '')), '');
      fop  := nullif(btrim(coalesce(fl->>'op', '')), '');
      if fcol is null or fop is null then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
      select * into fcat from public.vsat__grid_catalog() c where c.key = fcol;
      if not found then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
      if fcat.virt then
        -- stage / status / VSAT / campus … keep their dropdowns: only virtual columns with a fixed expression are filterable
        fexpr := public.vsat__grid_virt_expr(fcol);
        if fexpr is null then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
        fexpr := '(' || fexpr || ')';
      else
        fexpr := format('am.%I', fcol);
      end if;
      if not public.vsat__grid_may_see(fcat.sens, mgr) then raise exception 'FORBIDDEN_COLUMN: %', fcol using errcode = '42501'; end if;
      ftyp := fcat.typ;
      -- null / boolean predicates take no value
      if fop = 'isnull' then frag := format('%s is null', fexpr);
      elsif fop = 'notnull' then frag := format('%s is not null', fexpr);
      elsif ftyp = 'bool' and fop = 'true' then frag := format('%s::boolean is true', fexpr);
      elsif ftyp = 'bool' and fop = 'false' then frag := format('%s::boolean is false', fexpr);
      elsif fop = 'in' then
        if ftyp not in ('num', 'text') then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
        if jsonb_typeof(fl->'v') <> 'array' then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
        select array_agg(x) into farr from jsonb_array_elements_text(fl->'v') x where btrim(x) <> '';
        if farr is null or array_length(farr, 1) > 200 then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
        foreach s in array farr loop if char_length(s) > 100 then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if; end loop;
        frag := case ftyp when 'num' then format('(%s)::numeric = any(%L::numeric[])', fexpr, farr::text)
                          else format('%s::text = any(%L::text[])', fexpr, farr::text) end;
      elsif fop = 'between' then
        if ftyp not in ('num', 'date', 'ts') then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
        if jsonb_typeof(fl->'v') <> 'array' or jsonb_array_length(fl->'v') <> 2
           or btrim(coalesce(fl->'v'->>0, '')) = '' or btrim(coalesce(fl->'v'->>1, '')) = ''
           or char_length(fl->'v'->>0) > 100 or char_length(fl->'v'->>1) > 100 then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
        frag := case ftyp when 'num' then format('(%s)::numeric between %L::numeric and %L::numeric', fexpr, fl->'v'->>0, fl->'v'->>1)
                          else format('%s::date between %L::date and %L::date', fexpr, fl->'v'->>0, fl->'v'->>1) end;
      else
        -- single-value operators
        s := fl->>'v';
        if s is null or char_length(s) = 0 or char_length(s) > 100 then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
        fsym := case fop when 'eq' then '=' when 'ne' then '<>' when 'lt' then '<' when 'lte' then '<=' when 'gt' then '>' when 'gte' then '>='
                         when 'before' then '<' when 'after' then '>' else null end;
        if ftyp = 'num' and fop in ('eq', 'ne', 'lt', 'lte', 'gt', 'gte') then
          frag := format('(%s)::numeric %s %L::numeric', fexpr, fsym, s);
        elsif ftyp in ('date', 'ts') and fop in ('eq', 'before', 'after') then
          frag := format('%s::date %s %L::date', fexpr, case fop when 'eq' then '=' else fsym end, s);
        elsif ftyp = 'text' and fop = 'eq' then frag := format('%s::text = %L', fexpr, s);
        elsif ftyp = 'text' and fop = 'ne' then frag := format('%s::text is distinct from %L', fexpr, s);
        elsif ftyp = 'text' and fop = 'contains' then
          frag := format('lower(%s::text) like %L', fexpr, '%' || replace(replace(replace(lower(s), '\', '\\'), '%', '\%'), '_', '\_') || '%');
        else raise exception 'BAD_VALUE: filters' using errcode = '22023'; end if;
      end if;
      fwhere := fwhere || case when fwhere = '' then '' else ' and ' end || '(' || frag || ')';
    end loop;
    has_filters := true;
    fsql := 'select coalesce(array_agg(am.application_id), ''{}'') from public.application_manager am where ' || coalesce(nullif(fwhere, ''), 'true');
    begin
      execute fsql into f_ids;
    exception when others then raise exception 'BAD_VALUE: filters' using errcode = '22023'; end;
    f_ids := coalesce(f_ids, '{}'::text[]);
  end if;

  -- explicit rows (the selection) — ids only, capped
  select array_agg(x) into v_ids from jsonb_array_elements_text(coalesce(p->'application_ids', '[]'::jsonb)) x where char_length(x) between 1 and 64;
  if coalesce(array_length(v_ids, 1), 0) > 5000 then raise exception 'BAD_VALUE: application_ids' using errcode = '22023'; end if;

  -- requested columns: each must exist in the catalogue and be allowed for this role
  select array_agg(distinct x) into v_cols from jsonb_array_elements_text(coalesce(p->'columns', '[]'::jsonb)) x;
  if coalesce(array_length(v_cols, 1), 0) > 150 then raise exception 'BAD_VALUE: columns' using errcode = '22023'; end if;
  if v_cols is not null then foreach s in array v_cols loop
    select * into s_cat from public.vsat__grid_catalog() c where c.key = s;
    if not found then raise exception 'BAD_VALUE: columns' using errcode = '22023'; end if;
    if not public.vsat__grid_may_see(s_cat.sens, mgr) then raise exception 'FORBIDDEN_COLUMN: %', s using errcode = '42501'; end if;
  end loop; end if;
  need_eff := coalesce(v_cols && array['vps_effective', 'vps_override', 'vps_calculated', 'eligible_effective', 'eligible_override',
                                        'class12_result', 'class10_eligible', 'class12_eligible'], false);
  -- vsat_exam_evaluation: the sheet columns are looked up only when one of them is asked for
  need_sheet := coalesce(v_cols && array['first_name', 'last_name', 'user_id', 'exam_test_name', 'exam_started_at', 'exam_ended_at',
                                          'exam_time_taken', 'exam_total_questions', 'exam_attempted', 'exam_correct', 'exam_incorrect',
                                          'exam_unattempted'], false);

  -- multi-value search on one column ('_any' = name / app no, + email / mobile for managers)
  if p->'search' is not null and jsonb_typeof(p->'search') = 'object' then
    perform public.vsat__check_keys(p->'search', array['column', 'values']);
    s_col := nullif(btrim(coalesce(p->'search'->>'column', '')), '');
    if s_col is null then raise exception 'BAD_VALUE: column' using errcode = '22023'; end if;
    if jsonb_typeof(p->'search'->'values') <> 'array' then raise exception 'BAD_VALUE: values' using errcode = '22023'; end if;
    select array_agg(distinct btrim(x)) into s_vals from jsonb_array_elements_text(p->'search'->'values') x where btrim(x) <> '';
    if s_vals is null or array_length(s_vals, 1) > 200 then raise exception 'BAD_VALUE: values' using errcode = '22023'; end if;
    foreach s in array s_vals loop
      if char_length(s) < 2 or char_length(s) > 100 then raise exception 'BAD_VALUE: values' using errcode = '22023'; end if;
    end loop;
    select array_agg('%' || replace(replace(replace(lower(x), '\', '\\'), '%', '\%'), '_', '\_') || '%') into s_pat from unnest(s_vals) x;
    -- digits only, with a leading +91 / 0 dropped so "+91 98765 00002" finds "9876500002"; short digit runs are not phone searches
    select array_agg('%' || d || '%') into s_dig
      from (select case when length(d0) = 12 and d0 like '91%' then substr(d0, 3) when length(d0) = 11 and d0 like '0%' then substr(d0, 2) else d0 end d
              from (select regexp_replace(x, '\D', '', 'g') d0 from unnest(s_vals) x) y) z
     where length(d) >= 4;
    if s_col = '_any' then
      s_any := true;
    else
      select * into s_cat from public.vsat__grid_catalog() c where c.key = s_col and not c.virt and c.typ in ('text', 'num', 'date', 'ts');
      if not found then raise exception 'BAD_VALUE: column' using errcode = '22023'; end if;
      if not public.vsat__grid_may_see(s_cat.sens, mgr) then raise exception 'FORBIDDEN_COLUMN: %', s_col using errcode = '42501'; end if;
      -- the only dynamic SQL: the column name comes from the catalogue above and is quoted with %I; values are bound
      if s_col ~ '(mobile|phone|contact)' then
        execute format('select coalesce(array_agg(am.application_id), ''{}'') from public.application_manager am where regexp_replace(coalesce(am.%I::text, ''''), ''\D'', '''', ''g'') like any($1)', s_col)
          using coalesce(s_dig, '{}'::text[]) into s_ids;
      else
        execute format('select coalesce(array_agg(am.application_id), ''{}'') from public.application_manager am where lower(am.%I::text) like any($1)', s_col)
          using s_pat into s_ids;
      end if;
    end if;
  end if;

  v_limit  := least(greatest(coalesce((p->>'limit')::numeric, 50), 1), p_max)::int;
  v_offset := greatest(coalesce((p->>'offset')::numeric, 0), 0)::int;

  with vis as materialized (
    select vp.application_id, vp.attempt_no, vp.stage, vp.status, vp.stage_changed_at, am.exam_date_id,
           public.vsat__campus_key(am.campus_applied) campus, am.form_stage_1::text form_stage, am.payment_stage_1::text pay_stage,
           coalesce((select a.interviewer_id::text from public.interview_assignments a
                      where a.application_id = vp.application_id and a.attempt_no = vp.attempt_no
                      order by a.created_at desc limit 1), 'none') iv_id,
           coalesce((select c.counsellor_id::text from public.counselling_assignments c
                      where c.application_id = vp.application_id and c.attempt_no = vp.attempt_no
                      order by c.created_at desc limit 1), 'none') cs_id
      from public.vsat_pipeline vp join public.application_manager am on am.application_id = vp.application_id
     where (f_admin
            or (f_adm and (f_adm_all or public.vsat__campus_key(am.campus_applied) is null
                           or public.vsat__campus_key(am.campus_applied) = any(adm_campuses)))
            or (f_int and exists (select 1 from public.interview_assignments a where a.application_id = vp.application_id
                                     and a.attempt_no = vp.attempt_no and a.interviewer_id = uid))
            or (f_cou and exists (select 1 from public.counselling_assignments a where a.application_id = vp.application_id
                                     and a.attempt_no = vp.attempt_no and a.counsellor_id = uid)))
       and (v_scope is null or vp.stage = any(v_scope))
       and (v_ids is null or vp.application_id = any(v_ids))
       and (not has_filters or vp.application_id = any(f_ids))
       and (s_ids is null or vp.application_id = any(s_ids))
       and (not s_any or lower(coalesce(am.registered_name, '')) like any(s_pat) or am.application_no = any(s_vals) or am.application_id = any(s_vals)
            or (mgr and (lower(coalesce(am.registered_email, '')) like any(s_pat)
                         -- "all fields" only treats a value as a phone search when it carries at least 6 digits ("%…%" is 2 extra)
                         or regexp_replace(coalesce(am.registered_mobile, ''), '\D', '', 'g') like any(coalesce((select array_agg(d) from unnest(s_dig) d where length(d) >= 8), '{}'::text[])))))
  ), base as materialized (
    select * from vis
     where (v_stages is null or vis.stage = any(v_stages))
       and (v_statuses is null or vis.status = any(v_statuses))
       and (v_dates is null or vis.exam_date_id = any(v_dates))
       and (v_campuses is null or vis.campus = any(v_campuses))
       and (v_form is null or vis.form_stage = any(v_form))
       and (v_pay is null or vis.pay_stage = any(v_pay))
       and (v_ivs is null or vis.iv_id = any(v_ivs)) and (v_css is null or vis.cs_id = any(v_css))
  ), page as (
    select * from base order by base.stage_changed_at desc, base.application_id limit v_limit offset v_offset
  ), pagej as materialized (
    -- one row per page row, computed ONCE (materialized): the effective VPS / eligibility call, the latest
    -- interview and counselling rows and the student's own columns as json
    select pg.application_id, pg.stage, pg.status, pg.attempt_no, pg.stage_changed_at, pg.campus, d.label vsat,
           case when need_eff then public.vsat__effective(pg.application_id) end eff,
           exists (select 1 from public.vsat_registrations vr where vr.user_id = am.lead_id and vr.registered) early_reg,
           to_jsonb(am) am_j,
           public.vsat__exam_pct(am.exam_obtained_marks, am.exam_max_marks) ex_pct, am.exam_sections ex_sec, pr.verdict proct,
           ia.who ia_who, ia.slot_datetime ia_slot, ia.attendance ia_att, ia.weighted_avg ia_score, coalesce(ia.calc_verdict, ia.result) ia_calc,
           ia.interviewer_verdict ia_verdict, ia.cheating_seen ia_cheat,
           case when ia.cancelled_at is not null then 'cancelled' when ia.meet_mode = 'manual' then 'own_link'
                when ia.meet_sync = 'ok' then 'ready' when ia.meet_sync in ('pending', 'syncing') then 'creating'
                when ia.meet_sync = 'failed' then 'failed' end ia_meet,
           ca.who ca_who, ca.slot_datetime ca_slot, ca.attendance ca_att, ca.scholarship_category ca_cat, ca.scholarship_pct ca_pct, ca.calculated_pct ca_calc,
           case when ca.cancelled_at is not null then 'cancelled' when ca.meet_mode = 'manual' then 'own_link'
                when ca.meet_sync = 'ok' then 'ready' when ca.meet_sync in ('pending', 'syncing') then 'creating'
                when ca.meet_sync = 'failed' then 'failed' end ca_meet,
           -- vsat_grid_meet_link: the meeting link, for the Join button next to the Meet column. Only for managers and the row's own
           -- interviewer / counsellor (a counsellor never gets the interview link, an interviewer never the counselling
           -- one), never for a cancelled meeting, https links only
           case when ia.cancelled_at is null and (mgr or ia.interviewer_id = uid) and ia.meet_link ~* '^https://' then ia.meet_link end ia_link,
           case when ca.cancelled_at is null and (mgr or ca.counsellor_id = uid) and ca.zoom_link ~* '^https://' then ca.zoom_link end ca_link,
           -- vsat_grid_meet_link: how many times the booking was moved (kept by the booking functions since 0081)
           ia.reschedule_count ia_resch, ca.reschedule_count ca_resch,
           -- vsat_exam_evaluation: first / last name, user id and the Wheebox test-result fields (one lookup per page row)
           case when need_sheet then public.vsat__exam_sheet_cols(pg.application_id, am.registered_name, am.lead_id) end sheet
      from page pg
      join public.application_manager am on am.application_id = pg.application_id
      left join public.vsat_exam_dates d on d.id = am.exam_date_id
      left join public.vsat_proctoring pr on pr.application_id = pg.application_id and pr.attempt_no = pg.attempt_no
      left join lateral (select ia.slot_datetime, ia.attendance, ia.weighted_avg, ia.calc_verdict, ia.result, ia.interviewer_verdict, ia.cheating_seen,
                                ia.cancelled_at, ia.meet_mode, ia.meet_sync, ia.interviewer_id, ia.meet_link, ia.reschedule_count, coalesce(ip.full_name, ip.email) who
                           from public.interview_assignments ia left join public.profiles ip on ip.id = ia.interviewer_id
                          where ia.application_id = pg.application_id and ia.attempt_no = pg.attempt_no order by ia.created_at desc limit 1) ia on true
      left join lateral (select ca.slot_datetime, ca.attendance, ca.scholarship_category, ca.scholarship_pct, ca.calculated_pct,
                                ca.cancelled_at, ca.meet_mode, ca.meet_sync, ca.counsellor_id, ca.zoom_link, ca.reschedule_count, coalesce(cp.full_name, cp.email) who
                           from public.counselling_assignments ca left join public.profiles cp on cp.id = ca.counsellor_id
                          where ca.application_id = pg.application_id and ca.attempt_no = pg.attempt_no order by ca.created_at desc limit 1) ca on true
  ), pagev as materialized (
    -- every column a row can offer, under its catalogue key; the requested ones are picked from this below
    select pj.application_id, pj.stage, pj.status, pj.attempt_no, pj.stage_changed_at,
           pj.am_j || jsonb_build_object(
             'stage', pj.stage, 'status', pj.status, 'stage_changed_at', pj.stage_changed_at, 'attempt_no', pj.attempt_no,
             'campus', pj.campus, 'early_registration', pj.early_reg, 'vsat', pj.vsat,
             'vps_effective', pj.eff -> 'vps' -> 'value', 'vps_override', pj.eff -> 'vps' -> 'override',
             'eligible_effective', pj.eff -> 'eligible' -> 'value', 'eligible_override', pj.eff -> 'eligible' -> 'override',
             'vps_calculated', pj.eff -> 'vps' -> 'calculated',
             'class12_result', pj.eff -> 'eligible' -> 'detail' -> 'class12',
             'class10_eligible', pj.eff -> 'eligible' -> 'detail' -> 'class10_ok', 'class12_eligible', pj.eff -> 'eligible' -> 'detail' -> 'class12_ok',
             'exam_percentage', pj.ex_pct, 'proctoring', pj.proct,
             'exam_section_maths', public.vsat__section_marks(pj.ex_sec, 'maths'), 'exam_section_lr', public.vsat__section_marks(pj.ex_sec, 'lr'),
             'exam_section_cs', public.vsat__section_marks(pj.ex_sec, 'cs'),
             'interviewer', pj.ia_who, 'interview_slot', pj.ia_slot, 'interview_attendance', pj.ia_att, 'interview_score', pj.ia_score,
             'interview_calc_verdict', pj.ia_calc, 'interviewer_verdict', pj.ia_verdict, 'cheating_seen', pj.ia_cheat, 'interview_meet', pj.ia_meet,
             'counsellor', pj.ca_who, 'counselling_slot', pj.ca_slot, 'counselling_attendance', pj.ca_att,
             'counselling_category', pj.ca_cat, 'counselling_pct', pj.ca_pct, 'counselling_calculated_pct', pj.ca_calc,
             'counselling_meet', pj.ca_meet,
             'interview_meet_link', pj.ia_link, 'counselling_meet_link', pj.ca_link,
             'interview_reschedules', pj.ia_resch, 'counselling_reschedules', pj.ca_resch)
           || coalesce(pj.sheet, '{}'::jsonb) v
      from pagej pj
  )
  select (select count(*) from base),
         case when p_facets then jsonb_build_object(
           'stage',  (select coalesce(jsonb_object_agg(x.stage, x.n), '{}'::jsonb) from (
                        select vis.stage, count(*) n from vis
                         where (v_statuses is null or vis.status = any(v_statuses)) and (v_dates is null or vis.exam_date_id = any(v_dates))
                           and (v_campuses is null or vis.campus = any(v_campuses))
                           and (v_form is null or vis.form_stage = any(v_form)) and (v_pay is null or vis.pay_stage = any(v_pay)) and (v_ivs is null or vis.iv_id = any(v_ivs)) and (v_css is null or vis.cs_id = any(v_css)) group by vis.stage) x),
           'status', (select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb) from (
                        select vis.status, count(*) n from vis
                         where (v_stages is null or vis.stage = any(v_stages)) and (v_dates is null or vis.exam_date_id = any(v_dates))
                           and (v_campuses is null or vis.campus = any(v_campuses))
                           and (v_form is null or vis.form_stage = any(v_form)) and (v_pay is null or vis.pay_stage = any(v_pay)) and (v_ivs is null or vis.iv_id = any(v_ivs)) and (v_css is null or vis.cs_id = any(v_css)) group by vis.status) x),
           'vsat',   (select coalesce(jsonb_object_agg(coalesce(x.exam_date_id::text, 'none'), x.n), '{}'::jsonb) from (
                        select vis.exam_date_id, count(*) n from vis
                         where (v_stages is null or vis.stage = any(v_stages)) and (v_statuses is null or vis.status = any(v_statuses))
                           and (v_campuses is null or vis.campus = any(v_campuses))
                           and (v_form is null or vis.form_stage = any(v_form)) and (v_pay is null or vis.pay_stage = any(v_pay)) and (v_ivs is null or vis.iv_id = any(v_ivs)) and (v_css is null or vis.cs_id = any(v_css)) group by vis.exam_date_id) x),
           'campus', (select coalesce(jsonb_object_agg(coalesce(x.campus, 'none'), x.n), '{}'::jsonb) from (
                        select vis.campus, count(*) n from vis
                         where (v_stages is null or vis.stage = any(v_stages)) and (v_statuses is null or vis.status = any(v_statuses))
                           and (v_dates is null or vis.exam_date_id = any(v_dates))
                           and (v_form is null or vis.form_stage = any(v_form)) and (v_pay is null or vis.pay_stage = any(v_pay)) and (v_ivs is null or vis.iv_id = any(v_ivs)) and (v_css is null or vis.cs_id = any(v_css)) group by vis.campus) x),
           'form_stage', (select coalesce(jsonb_object_agg(coalesce(x.form_stage, 'none'), x.n), '{}'::jsonb) from (
                        select vis.form_stage, count(*) n from vis
                         where (v_stages is null or vis.stage = any(v_stages)) and (v_statuses is null or vis.status = any(v_statuses))
                           and (v_dates is null or vis.exam_date_id = any(v_dates)) and (v_campuses is null or vis.campus = any(v_campuses))
                           and (v_pay is null or vis.pay_stage = any(v_pay)) and (v_ivs is null or vis.iv_id = any(v_ivs)) and (v_css is null or vis.cs_id = any(v_css)) group by vis.form_stage) x),
           'payment_stage', case when mgr then (select coalesce(jsonb_object_agg(coalesce(x.pay_stage, 'none'), x.n), '{}'::jsonb) from (
                        select vis.pay_stage, count(*) n from vis
                         where (v_stages is null or vis.stage = any(v_stages)) and (v_statuses is null or vis.status = any(v_statuses))
                           and (v_dates is null or vis.exam_date_id = any(v_dates)) and (v_campuses is null or vis.campus = any(v_campuses))
                           and (v_form is null or vis.form_stage = any(v_form)) and (v_ivs is null or vis.iv_id = any(v_ivs)) and (v_css is null or vis.cs_id = any(v_css)) group by vis.pay_stage) x) else '{}'::jsonb end,
           'interviewer', (select coalesce(jsonb_object_agg(x.iv_id, x.n), '{}'::jsonb) from (
                        select vis.iv_id, count(*) n from vis
                         where (v_stages is null or vis.stage = any(v_stages)) and (v_statuses is null or vis.status = any(v_statuses))
                           and (v_dates is null or vis.exam_date_id = any(v_dates)) and (v_campuses is null or vis.campus = any(v_campuses))
                           and (v_form is null or vis.form_stage = any(v_form)) and (v_pay is null or vis.pay_stage = any(v_pay))
                           and (v_css is null or vis.cs_id = any(v_css)) group by vis.iv_id) x),
           'interviewer_name', (select coalesce(jsonb_object_agg(v.iv_id, coalesce(ip.full_name, ip.email)), '{}'::jsonb)
                                  from (select distinct vis.iv_id from vis where vis.iv_id <> 'none') v
                                  join public.profiles ip on ip.id = v.iv_id::uuid),
           'counsellor', (select coalesce(jsonb_object_agg(x.cs_id, x.n), '{}'::jsonb) from (
                        select vis.cs_id, count(*) n from vis
                         where (v_stages is null or vis.stage = any(v_stages)) and (v_statuses is null or vis.status = any(v_statuses))
                           and (v_dates is null or vis.exam_date_id = any(v_dates)) and (v_campuses is null or vis.campus = any(v_campuses))
                           and (v_form is null or vis.form_stage = any(v_form)) and (v_pay is null or vis.pay_stage = any(v_pay))
                           and (v_ivs is null or vis.iv_id = any(v_ivs)) group by vis.cs_id) x),
           'counsellor_name', (select coalesce(jsonb_object_agg(v.cs_id, coalesce(cp.full_name, cp.email)), '{}'::jsonb)
                                  from (select distinct vis.cs_id from vis where vis.cs_id <> 'none') v
                                  join public.profiles cp on cp.id = v.cs_id::uuid)) end,
         (select coalesce(jsonb_agg(
                   jsonb_build_object('application_id', pv.application_id, 'stage', pv.stage, 'status', pv.status, 'attempt_no', pv.attempt_no)
                   || coalesce((select jsonb_object_agg(c, pv.v -> c) from unnest(v_cols) c), '{}'::jsonb)
                   -- vsat_grid_meet_link: a link only travels with its Meet column (it is not in the catalogue: it can't be asked for,
                   -- filtered or exported on its own); no link → no key
                   || jsonb_strip_nulls(jsonb_build_object(
                        'interview_meet_link', case when 'interview_meet' = any(v_cols) then pv.v -> 'interview_meet_link' end,
                        'counselling_meet_link', case when 'counselling_meet' = any(v_cols) then pv.v -> 'counselling_meet_link' end))
                   order by pv.stage_changed_at desc, pv.application_id), '[]'::jsonb)
            from pagev pv)
    into total, facets, rows;

  return jsonb_build_object('total', total, 'facets', facets, 'rows', rows, 'limit', v_limit, 'offset', v_offset, 'can_manage', mgr);
end $function$;
revoke all on function public.vsat__grid(jsonb, integer, boolean, boolean) from public, anon, authenticated;

create or replace function public.vsat__grid_virt_expr(p_key text)
returns text language sql immutable set search_path to '' as $function$
  with a(el, vps) as (select
    'public.vsat__elig(am.class10_year, am.class12_year, am.marks_physics_12, am.marks_chemistry_12, am.marks_maths_12, am.class12_percentage)'::text,
    'public.vsat__vps_calculated(am.vps_score, am.exam_percentile, am.exam_date_id)'::text)
  select case p_key
    when 'vps_calculated'     then a.vps
    when 'vps_effective'      then 'coalesce((public.vsat__override_of(am.application_id, ''vps'') #>> ''{}'')::numeric, ' || a.vps || ')'
    when 'eligible_effective' then 'coalesce((public.vsat__override_of(am.application_id, ''eligible'') #>> ''{}'')::boolean, (' || a.el || ' ->> ''eligible'')::boolean)'
    when 'class12_result'     then '(' || a.el || ' ->> ''class12'')'
    when 'class10_eligible'   then '(' || a.el || ' ->> ''class10_ok'')::boolean'
    when 'class12_eligible'   then '(' || a.el || ' ->> ''class12_ok'')::boolean'
    when 'exam_percentage'    then 'public.vsat__exam_pct(am.exam_obtained_marks, am.exam_max_marks)'
    when 'exam_section_maths' then 'public.vsat__section_marks(am.exam_sections, ''maths'')'
    when 'exam_section_lr'    then 'public.vsat__section_marks(am.exam_sections, ''lr'')'
    when 'exam_section_cs'    then 'public.vsat__section_marks(am.exam_sections, ''cs'')'
    when 'proctoring'         then 'public.vsat__proctoring_of(am.application_id)'
  end
  from a
$function$;
revoke all on function public.vsat__grid_virt_expr(text) from public, anon, authenticated;

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
  if vp.stage not in ('vsat_cleared', 'interview_scheduled', 'interviewed', 'pi_not_appeared') then raise exception 'WRONG_STAGE' using errcode = '22023'; end if;
  select * into ia from public.interview_assignments a where a.application_id = app and a.attempt_no = vp.attempt_no order by a.created_at desc limit 1;
  if not found then raise exception 'NEEDS_INTERVIEWER' using errcode = '22023'; end if;
  -- vsat_manual_stages: the stage no longer moves on after the form, so "submit once" is checked here
  if ia.submitted_at is not null then raise exception 'ALREADY_INTERVIEWED' using errcode = '22023'; end if;

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
  -- vsat_manual_stages: the interviewer gives no verdict (decided later in Interview Evaluation); an old client may still send one
  verdict := public.vsat__txt(p, 'interviewer_verdict', 20, false);
  if verdict is not null and verdict not in ('selected', 'maybe', 'not_selected') then raise exception 'BAD_VALUE: interviewer_verdict' using errcode = '22023'; end if;
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

  -- vsat_manual_stages: submitting only saves the form; the stage is changed by hand
  return jsonb_build_object('score', calc->'score', 'ranking', calc->'ranking', 'calc_verdict', calc->'suggested_verdict',
                            'interviewer_verdict', verdict, 'stage', (select vp2.stage from public.vsat_pipeline vp2 where vp2.application_id = app),
                            'status', (select vp2.status from public.vsat_pipeline vp2 where vp2.application_id = app));
end $$;

drop function if exists public.vsat__interview_verdict(numeric, boolean, numeric, numeric);
alter table public.vsat_exam_dates drop constraint if exists vsat_exam_dates_interview_cut_check;
alter table public.vsat_exam_dates drop column if exists interview_select_min, drop column if exists interview_maybe_min,
  drop column if exists interview_verdicts_at, drop column if exists interview_verdicts_by;
alter table public.interview_assignments drop constraint if exists interview_assignments_verdict_check;
alter table public.interview_assignments drop column if exists verdict;
