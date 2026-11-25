-- 0186 · VSAT counselling: offline sessions and "Offline Form Filled" (owner's decisions, 25 Nov 2026) — staging first.
--
-- Sir (transcript): invites go to online students only; offline students come to the campus and the counsellors fill the
-- counselling details there. 0184 refused any booking for an offline student, so their counselling could never be saved
-- (the form needs a booked counsellor). Decided: record it, no invite.
--
--   counselling_assignments        + offline_form_filled (the sheet's "Offline Form Filled"); meet_mode may be 'offline'
--   vsat__cs_schedule              (0184 body) an offline student's session is recorded: counsellor, offline date and time,
--                                  meet_mode 'offline', no Zoom link, no calendar event (an old one is removed)
--   vsat_counselling_notices_claim (0145 body) no email for an offline session (skipped, why 'offline')
--   vsat_submit_counselling        (0184 body) + offline_form_filled (yes / no)
--   vsat__grid_catalog / vsat__grid (0184 bodies) the Offline Form Filled column; the Meet column says 'offline'
--   vsat_my_counselling            (0168 body) + offline, so the student's card shows the campus session without a Join button
--
-- Rollback: supabase/rollback/0186_vsat_counselling_offline_down.sql
-- Staging record: 0185_vsat_counselling_offline (applied before a teammate's 0185 took that number; renumbered 0186).
-- Tests:    supabase/tests/vsat_counselling_offline.test.sql

alter table public.counselling_assignments add column if not exists offline_form_filled boolean;
alter table public.counselling_assignments drop constraint counselling_assignments_meet_mode_check;
alter table public.counselling_assignments add constraint counselling_assignments_meet_mode_check
  check (meet_mode = any (array['auto'::text, 'manual'::text, 'zoom'::text, 'offline'::text]));

create or replace function public.vsat__cs_schedule(p_app text, p_iid uuid, p_slot timestamptz, p_dur int, p_link text, p_auto boolean,
                                                    p_source text, p_bulk boolean)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare vp public.vsat_pipeline; cur public.counselling_assignments; nxt public.counselling_assignments; has_row boolean; live boolean;
        v_mode text; v_link text; v_kind text; v_con text; v_cmode text;
begin
  vp := public.vsat__iv_managed(p_app);
  if not exists (select 1 from public.vsat_team t where t.user_id = p_iid and t.role = 'counsellor' and t.active) then
    raise exception 'NOT_A_COUNSELLOR' using errcode = '22023';
  end if;
  if vp.stage not in ('pi_cleared', 'counselling_scheduled') or vp.status = 'not_selected' then
    raise exception 'WRONG_STAGE' using errcode = '22023';
  end if;
  select * into cur from public.counselling_assignments a where a.application_id = p_app and a.attempt_no = vp.attempt_no for update;
  has_row := found;
  live := has_row and cur.cancelled_at is null and cur.slot_datetime is not null and cur.counsellor_id is not null;
  if has_row and cur.submitted_at is not null then raise exception 'ALREADY_COUNSELLED' using errcode = '22023'; end if;
  if p_bulk and live then raise exception 'ALREADY_SCHEDULED' using errcode = '22023'; end if;
  if p_slot < now() then raise exception 'SLOT_IN_PAST' using errcode = '22023'; end if;

  -- vsat_meet_only: Google Meet only (owner's review, 24 Nov 2026). A pasted link is refused; an old booking with a
  -- pasted link moves to Google Meet the next time it is changed (its link is then replaced by the Google one).
  if p_link is not null or p_auto is false then raise exception 'BAD_VALUE: meet_link' using errcode = '22023'; end if;
  -- vsat_counselling_phase4 (owner's review): counselling invites go to online students only, and on the counsellor's
  -- own Zoom link instead of Google Meet. Offline students are counselled on campus (no invite)
  select am.counselling_mode into v_cmode from public.application_manager am where am.application_id = p_app;
  if v_cmode is null then raise exception 'MODE_NOT_CHOSEN' using errcode = '22023'; end if;
  -- vsat_counselling_offline (owner's decision, 25 Nov): an offline student's session is recorded (counsellor, offline date
  -- and time) with no invite: no Zoom, no calendar event, no email (vsat_counselling_notices_claim skips it)
  if v_cmode = 'offline' then
    v_mode := 'offline';
    v_link := null;
  else
    select z.zoom_link into v_link from public.vsat_counsellor_zoom z where z.counsellor_id = p_iid;
    if v_link is null then raise exception 'NO_ZOOM_LINK' using errcode = '22023'; end if;
    v_mode := 'zoom';
  end if;

  -- one booking at a time per counsellor, so two admins can't give the same person overlapping slots
  perform pg_advisory_xact_lock(hashtextextended('vsat_counsellor:' || p_iid::text, 0));
  if public.vsat__cs_busy_until(p_iid, p_slot, p_dur, p_app, vp.attempt_no) is not null then
    raise exception 'SLOT_TAKEN' using errcode = '23505';
  end if;

  if live and cur.counsellor_id = p_iid and cur.slot_datetime = p_slot and cur.duration_min = p_dur
     and cur.meet_mode = v_mode and cur.zoom_link is not distinct from (case when v_mode in ('manual', 'zoom') then v_link else cur.zoom_link end) then
    -- nothing changed: no new event, no email
    -- vsat_manual_stages: booking no longer moves the stage (stages are changed by hand)
    return jsonb_build_object('application_id', p_app, 'kind', null, 'slot', p_slot, 'changed', false);
  end if;

  v_kind := case when live then 'rescheduled' else 'scheduled' end;
  begin
    if has_row then
      update public.counselling_assignments a
         set counsellor_id = p_iid, slot_datetime = p_slot, duration_min = p_dur, meet_mode = v_mode,
             -- Google: keep the link of a live event (a move keeps it); it is replaced when the event changes
             zoom_link = case when v_mode = 'offline' then null when v_mode in ('manual', 'zoom') then v_link
                              when a.meet_mode = 'auto' and a.cancelled_at is null and a.calendar_event_id is not null then a.zoom_link end,
             attendance = 'scheduled', attendance_source = null, attendance_detail = null, attendance_checked_at = null,
             attendance_check_attempts = 0, attendance_set_by = null,
             reschedule_count = coalesce(a.reschedule_count, 0) + case when live then 1 else 0 end,
             version = a.version + 1, cancelled_at = null, cancelled_by = null, cancel_reason = null,
             -- Google work: make / move the event, or (own link) remove an old one
             meet_sync = case when v_mode in ('auto', 'zoom') or a.calendar_event_id is not null then 'pending' else 'none' end,
             meet_attempts = 0, meet_error = null, meet_claimed_at = null
       where a.id = cur.id
      returning * into nxt;
    else
      insert into public.counselling_assignments (application_id, attempt_no, counsellor_id, slot_datetime, duration_min, meet_mode, zoom_link,
                                                attendance, reschedule_count, version, meet_sync)
      values (p_app, vp.attempt_no, p_iid, p_slot, p_dur, v_mode, v_link, 'scheduled', 0, 1,
              case when v_mode in ('auto', 'zoom') then 'pending' else 'none' end)
      returning * into nxt;
    end if;
  exception when unique_violation then
    raise exception 'SLOT_TAKEN' using errcode = '23505';
  end;

  perform public.vsat__cs_event(nxt, v_kind, cur, null, p_source, auth.uid());
  -- vsat_manual_stages: booking no longer moves the stage (stages are changed by hand)
  return jsonb_build_object('application_id', p_app, 'kind', v_kind, 'slot', nxt.slot_datetime, 'changed', true);
end $$;

create or replace function public.vsat_counselling_notices_claim(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare lim int; v_wait boolean; ids text[]; claimed uuid[];
begin
  p := coalesce(p, '{}'::jsonb);
  perform public.vsat__check_keys(p, array['limit', 'wait_for_meet', 'application_ids']);
  lim := coalesce(public.vsat__num(p, 'limit', 1, 100, false), 20)::int;
  v_wait := coalesce(public.vsat__bool(p, 'wait_for_meet', false), true);
  if p ? 'application_ids' then
    if jsonb_typeof(p->'application_ids') <> 'array' then raise exception 'BAD_VALUE: application_ids' using errcode = '22023'; end if;
    select array_agg(x) into ids from jsonb_array_elements_text(p->'application_ids') x;
    if coalesce(array_length(ids, 1), 0) > 200 then raise exception 'BAD_VALUE: application_ids' using errcode = '22023'; end if;
  end if;

  update public.vsat_counselling_events ev
     set notify_status = 'skipped', notify_detail = jsonb_build_object('why', 'superseded'), notified_at = now(), notify_claimed_at = null
   where ev.notify_status in ('pending', 'failed')
     and exists (select 1 from public.vsat_counselling_events n
                  where n.assignment_id = ev.assignment_id and n.kind in ('scheduled', 'rescheduled', 'cancelled') and n.version > ev.version);
  update public.vsat_counselling_events ev
     set notify_status = 'skipped', notify_detail = jsonb_build_object('why', 'time_passed'), notified_at = now(), notify_claimed_at = null
   where ev.notify_status = 'pending'
     and ((ev.kind <> 'cancelled' and ev.slot_start + make_interval(mins => ev.duration_min) < now())
       or (ev.kind = 'cancelled' and ev.prev_slot_start + make_interval(mins => coalesce(ev.prev_duration_min, 30)) < now()));

  -- vsat_counselling_offline: an offline session is recorded only, so no email goes to the student or the counsellor
  update public.vsat_counselling_events ev
     set notify_status = 'skipped', notify_detail = jsonb_build_object('why', 'offline'), notified_at = now(), notify_claimed_at = null
   where ev.notify_status in ('pending', 'failed') and ev.meet_mode = 'offline';

  with cand as (
    select ev.id
      from public.vsat_counselling_events ev
     where (ev.notify_status = 'pending' or (ev.notify_status = 'sending' and ev.notify_claimed_at < now() - interval '10 minutes'))
       and ev.notify_attempts < 5
       and (ids is null or ev.application_id = any(ids))
       and not (v_wait and ev.kind <> 'cancelled' and ev.created_at > now() - interval '20 minutes'
                and exists (select 1 from public.counselling_assignments a
                             where a.id = ev.assignment_id and a.version = ev.version and a.meet_mode = 'auto' and a.meet_sync in ('pending', 'syncing')))
     order by ev.created_at
     limit lim
       for update of ev skip locked
  ), upd as (
    update public.vsat_counselling_events ev
       set notify_status = 'sending', notify_claimed_at = now(), notify_attempts = ev.notify_attempts + 1
      from cand
     where ev.id = cand.id
    returning ev.id
  )
  select array_agg(upd.id) into claimed from upd;

  if claimed is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', ev.id, 'kind', ev.kind, 'version', ev.version, 'attempts', ev.notify_attempts,
             'sent_to', coalesce(ev.notify_detail->'sent_to', '[]'::jsonb),
             'slot_start', ev.slot_start, 'duration_min', ev.duration_min,
             'prev_slot_start', ev.prev_slot_start, 'prev_duration_min', ev.prev_duration_min,
             'counsellor', case when ev.counsellor_id is not null then
                              jsonb_build_object('id', ev.counsellor_id, 'name', coalesce(ip.full_name, ip.email), 'email', ip.email) end,
             'baseline', (select jsonb_build_object('kind', b.kind, 'slot_start', b.slot_start, 'duration_min', b.duration_min,
                                   'counsellor', case when b.counsellor_id is not null then
                                                    jsonb_build_object('id', b.counsellor_id, 'name', coalesce(bp.full_name, bp.email), 'email', bp.email) end)
                            from public.vsat_counselling_events b left join public.profiles bp on bp.id = b.counsellor_id
                           where b.assignment_id = ev.assignment_id and b.notify_status = 'sent' and b.version < ev.version
                           order by b.version desc limit 1),
             'student', jsonb_build_object('name', am.registered_name, 'email', am.registered_email,
                                           'application_no', coalesce(am.application_no::text, am.application_id), 'lead_id', am.lead_id),
             'meet_link', case when a.version = ev.version then a.zoom_link end,
             'meet_mode', ev.meet_mode) order by ev.created_at)
      from public.vsat_counselling_events ev
      join public.counselling_assignments a on a.id = ev.assignment_id
      join public.application_manager am on am.application_id = ev.application_id
      left join public.profiles ip on ip.id = ev.counsellor_id
     where ev.id = any(claimed)), '[]'::jsonb);
end $$;

create or replace function public.vsat_submit_counselling(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  app text; vp public.vsat_pipeline; ca public.counselling_assignments; v_campus text; mgr boolean;
  pre jsonb; step numeric; rating int; fin jsonb; actual numeric;
  v_fb text; v_par text; v_conn boolean; v_heard text; v_adj numeric; v_areason text; v_off boolean;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['application_id', 'remarks', 'feedback', 'parent_present', 'connected_students',
                                           'heard_from', 'adjust_pct', 'adjust_reason', 'offline_form_filled']);
  app := public.vsat__txt(p, 'application_id', 64, true);
  select * into vp from public.vsat_pipeline where application_id = app;
  if not found then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select public.vsat__campus_key(am.campus_applied) into v_campus from public.application_manager am where am.application_id = app;
  mgr := public.vsat__can_manage(v_campus);
  if not mgr and not public.vsat__is_assigned('counsellor', app, vp.attempt_no) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if vp.stage not in ('pi_cleared', 'counselling_scheduled', 'counselled', 'counselling_not_appeared') then raise exception 'WRONG_STAGE' using errcode = '22023'; end if;
  select * into ca from public.counselling_assignments c where c.application_id = app and c.attempt_no = vp.attempt_no order by c.created_at desc limit 1;
  if not found then raise exception 'NEEDS_COUNSELLOR' using errcode = '22023'; end if;
  -- vsat_manual_stages: the stage no longer moves on after the form, so "submit once" is checked here
  if ca.submitted_at is not null then raise exception 'ALREADY_COUNSELLED' using errcode = '22023'; end if;
  -- vsat_counselling_phase4: the "Selected for counselling" sheet's counsellor columns, and the counsellor's adjustment of
  -- the formula's % ("maybe 5 % extra or less"): a whole number from -5 to +5, with a reason when it is not 0
  v_fb := public.vsat__txt(p, 'feedback', 20, false);
  if v_fb is not null and v_fb not in ('likely', 'may_or_may_not', 'unlikely') then raise exception 'BAD_VALUE: feedback' using errcode = '22023'; end if;
  v_par := public.vsat__txt(p, 'parent_present', 20, false);
  if v_par is not null and v_par not in ('no', 'mother', 'father', 'both', 'guardian', 'sibling', 'other') then
    raise exception 'BAD_VALUE: parent_present' using errcode = '22023';
  end if;
  v_conn := public.vsat__bool(p, 'connected_students', false);
  v_off := public.vsat__bool(p, 'offline_form_filled', false);  -- vsat_counselling_offline: the sheet's "Offline Form Filled"
  v_heard := public.vsat__txt(p, 'heard_from', 300, false);
  v_adj := coalesce(public.vsat__num(p, 'adjust_pct', -5, 5, false), 0);
  if v_adj <> round(v_adj) then raise exception 'BAD_VALUE: adjust_pct' using errcode = '22023'; end if;
  v_areason := public.vsat__txt(p, 'adjust_reason', 500, false);
  if v_adj <> 0 and v_areason is null then raise exception 'BAD_VALUE: adjust_reason' using errcode = '22023'; end if;

  pre := public.vsat_scholarship_preview(app);
  step := (pre->>'auto_step')::numeric;  -- sheet column BK, never from the request
  if step is null then raise exception 'NO_BAND' using errcode = '22023'; end if;
  rating := (pre->>'special_rating')::int;  -- from the interview (achievements), never from the request
  fin := public.vsat_calc_final_scholarship(step, (pre->>'jee_floor')::numeric, rating, v_campus);
  -- formula only (Q8): no hand-typed %; vsat_counselling_phase4: plus the counsellor's -5..+5, kept within 0–100
  actual := least(100, greatest(0, (fin->>'pct')::numeric + v_adj));

  update public.counselling_assignments c set
    calc_score = (pre->>'score')::numeric, calc_case = pre->>'case', calc_category = (pre->>'category')::int, award_steps = pre->'award_steps',
    calc_inputs = pre->'inputs', chosen_step = step, jee_floor = (pre->>'jee_floor')::numeric, special_rating = rating,
    bonus_applied = (fin->>'bonus_applied')::boolean, calculated_pct = (fin->>'pct')::numeric, actual_pct = actual,
    actual_reason = case when v_adj <> 0 then v_areason end, counsellor_remarks = public.vsat__txt(p, 'remarks', 2000, false),
    adjust_pct = v_adj, counsellor_feedback = v_fb, parent_present = v_par, connected_students = v_conn, heard_from = v_heard, offline_form_filled = v_off,
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

  -- vsat_manual_stages: submitting only saves the counselling; the stage is changed by hand
  return jsonb_build_object('step', step, 'calculated_pct', fin->'pct', 'actual_pct', actual, 'adjust_pct', v_adj, 'category', pre->'category', 'bonus_applied', fin->'bonus_applied',
                            'special_rating', rating, 'jee_floor_applied', fin->'jee_floor_applied', 'stage', (select vp2.stage from public.vsat_pipeline vp2 where vp2.application_id = app));
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
      -- vsat_interview_evaluation: no verdict from the interviewer, so the interviewer's and the "lowest part" verdicts left the list
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
      ('exam_unattempted',           'Exam',        'num',    58),
      -- vsat_interview_evaluation: sir's interview form, one column per question in the sheet's order (owner's review, 24 Nov),
      -- the verdict from Interview Evaluation and the sheet's final score (weighted × 4). Verdict and final score are filterable
      ('interview_submitted_at',     'Interview',   'ts',     59), ('iv_communication',      'Interview',   'num',    60),
      ('iv_communication_remarks',   'Interview',   'text',   61), ('iv_logic',              'Interview',   'num',    62),
      ('iv_passion',                 'Interview',   'num',    63), ('iv_coding_talent',      'Interview',   'bool',   64),
      ('iv_passion_remarks',         'Interview',   'text',   65), ('iv_achievements',       'Interview',   'num',    66),
      ('iv_cert_asked',              'Interview',   'bool',   67), ('iv_why_program',        'Interview',   'num',    68),
      ('iv_why_program_remarks',     'Interview',   'text',   69), ('iv_drop_year',          'Interview',   'bool',   70),
      ('iv_previous_jee',            'Interview',   'text',   71), ('iv_jee_pct',            'Interview',   'num',    72),
      ('iv_jee_maths_pct',           'Interview',   'num',    73), ('iv_expected_jee_pct',   'Interview',   'num',    74),
      ('iv_other_exams',             'Interview',   'text',   75), ('iv_class12_pct',        'Interview',   'num',    76),
      ('iv_class11_pct',             'Interview',   'num',    77), ('iv_class10_pct',        'Interview',   'num',    78),
      ('iv_financial',               'Interview',   'text',   79), ('iv_financial_reason',   'Interview',   'text',   80),
      ('interview_verdict',          'Interview',   'text',   81), ('iv_why_accept',         'Interview',   'text',   82),
      ('iv_logic_remarks',           'Interview',   'text',   83), ('iv_achievements_remarks', 'Interview', 'text',   84),
      ('interview_final_score',      'Interview',   'num',    85),
      -- vsat_counselling_phase4: the "Selected for counselling" sheet (PI score × 20, CS / logical reasoning × 20, the
      -- counsellor's columns, fee, scholarship amount, 1st-year scholarship and actual fee). Counsellor feedback is filterable
      ('pi_score_x20',               'Interview',   'num',    86), ('iv_cs_x20',             'Interview',   'num',    87),
      ('iv_lr_x20',                  'Interview',   'num',    88), ('cs_score',              'Counselling', 'num',    89),
      ('cs_feedback',                'Counselling', 'text',   90), ('cs_parent_present',     'Counselling', 'text',   91),
      ('cs_connected_students',      'Counselling', 'bool',   92), ('cs_heard_from',         'Counselling', 'text',   93),
      ('cs_remarks',                 'Counselling', 'text',   94), ('cs_adjust_pct',         'Counselling', 'num',    95),
      ('cs_submitted_at',            'Counselling', 'ts',     96), ('campus_fee',            'Counselling', 'num',    97),
      ('cs_scholarship_amount',      'Counselling', 'num',    98), ('cs_first_year_scholarship', 'Counselling', 'num', 99),
      ('cs_actual_fee',              'Counselling', 'num',   100),
      -- vsat_counselling_offline: the sheet's "Offline Form Filled"
      ('cs_offline_form_filled',     'Counselling', 'bool',  101)
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
                when ca.meet_mode = 'zoom' then 'zoom'  -- vsat_counselling_phase4: the counsellor's Zoom link
                when ca.meet_mode = 'offline' then 'offline'  -- vsat_counselling_offline: recorded, no invite
                when ca.meet_sync = 'ok' then 'ready' when ca.meet_sync in ('pending', 'syncing') then 'creating'
                when ca.meet_sync = 'failed' then 'failed' end ca_meet,
           -- vsat_grid_meet_link: the meeting link, for the Join button next to the Meet column. Only for managers and the row's own
           -- interviewer / counsellor (a counsellor never gets the interview link, an interviewer never the counselling
           -- one), never for a cancelled meeting, https links only
           case when ia.cancelled_at is null and (mgr or ia.interviewer_id = uid) and ia.meet_link ~* '^https://' then ia.meet_link end ia_link,
           case when ca.cancelled_at is null and (mgr or ca.counsellor_id = uid) and ca.zoom_link ~* '^https://' then ca.zoom_link end ca_link,
           -- vsat_grid_meet_link: how many times the booking was moved (kept by the booking functions since 0081)
           ia.reschedule_count ia_resch, ca.reschedule_count ca_resch, ia.ivf ia_form,
           -- vsat_counselling_phase4: the counsellor's columns and the campus fee
           ca.csf ca_form, (select s.programme_fee from public.vsat_campus_settings s where s.campus = pg.campus) fee,
           -- vsat_exam_evaluation: first / last name, user id and the Wheebox test-result fields (one lookup per page row)
           case when need_sheet then public.vsat__exam_sheet_cols(pg.application_id, am.registered_name, am.lead_id) end sheet
      from page pg
      join public.application_manager am on am.application_id = pg.application_id
      left join public.vsat_exam_dates d on d.id = am.exam_date_id
      left join public.vsat_proctoring pr on pr.application_id = pg.application_id and pr.attempt_no = pg.attempt_no
      left join lateral (select ia.slot_datetime, ia.attendance, ia.weighted_avg, ia.calc_verdict, ia.result, ia.interviewer_verdict, ia.cheating_seen,
                                ia.cancelled_at, ia.meet_mode, ia.meet_sync, ia.interviewer_id, ia.meet_link, ia.reschedule_count, coalesce(ip.full_name, ip.email) who,
                                -- vsat_interview_evaluation: every answer of the interview form, the verdict and the final score
                                jsonb_build_object(
                                  'interview_submitted_at', ia.submitted_at,
                                  'iv_communication', ia.rubric_behavioural, 'iv_communication_remarks', ia.remarks->>'communication',
                                  'iv_logic', ia.rubric_math, 'iv_logic_remarks', ia.remarks->>'logic',
                                  'iv_passion', ia.rubric_passion, 'iv_coding_talent', ia.coding_talent, 'iv_passion_remarks', ia.remarks->>'passion',
                                  'iv_achievements', ia.rubric_achievements, 'iv_cert_asked', ia.cert_asked, 'iv_achievements_remarks', ia.remarks->>'achievements',
                                  'iv_why_program', ia.rubric_why_program, 'iv_why_program_remarks', ia.remarks->>'why_program',
                                  'iv_drop_year', ia.drop_year, 'iv_previous_jee', ia.previous_jee, 'iv_jee_pct', ia.jee_pct,
                                  'iv_jee_maths_pct', ia.jee_maths_pct, 'iv_expected_jee_pct', ia.expected_jee_pct, 'iv_other_exams', ia.other_exams,
                                  'iv_class12_pct', ia.class12_pct, 'iv_class11_pct', ia.class11_pct, 'iv_class10_pct', ia.class10_pct,
                                  'iv_financial', ia.financial_capability, 'iv_financial_reason', ia.financial_reason,
                                  'interview_verdict', ia.verdict, 'iv_why_accept', ia.why_accept,
                                  'interview_final_score', round(ia.weighted_avg * 4, 4),
                                  -- vsat_counselling_phase4: the counselling sheet's "× 20" columns
                                  'pi_score_x20', round(ia.weighted_avg * 20, 2), 'iv_cs_x20', ia.rubric_passion * 20,
                                  'iv_lr_x20', ia.rubric_math * 20) ivf
                           from public.interview_assignments ia left join public.profiles ip on ip.id = ia.interviewer_id
                          where ia.application_id = pg.application_id and ia.attempt_no = pg.attempt_no order by ia.created_at desc limit 1) ia on true
      left join lateral (select ca.slot_datetime, ca.attendance, ca.scholarship_category, ca.scholarship_pct, ca.calculated_pct,
                                ca.cancelled_at, ca.meet_mode, ca.meet_sync, ca.counsellor_id, ca.zoom_link, ca.reschedule_count, coalesce(cp.full_name, cp.email) who,
                                jsonb_build_object('cs_score', ca.calc_score, 'cs_feedback', ca.counsellor_feedback,
                                  'cs_parent_present', ca.parent_present, 'cs_connected_students', ca.connected_students,
                                  'cs_heard_from', ca.heard_from, 'cs_remarks', ca.counsellor_remarks, 'cs_adjust_pct', ca.adjust_pct,
                                  'cs_submitted_at', ca.submitted_at, 'cs_offline_form_filled', ca.offline_form_filled) csf
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
           || coalesce(pj.sheet, '{}'::jsonb) || coalesce(pj.ia_form, '{}'::jsonb) || coalesce(pj.ca_form, '{}'::jsonb)
           -- vsat_counselling_phase4: fee, scholarship amount (fee × awarded %), 1st-year scholarship (÷ 4), actual fee
           || jsonb_build_object('campus_fee', pj.fee,
                'cs_scholarship_amount', round(pj.fee * pj.ca_pct / 100),
                'cs_first_year_scholarship', round(pj.fee * pj.ca_pct / 100 / 4),
                'cs_actual_fee', pj.fee - round(pj.fee * pj.ca_pct / 100)) v
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

create or replace function public.vsat_my_counselling()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare uid uuid := auth.uid(); vp public.vsat_pipeline; r record; t_open timestamptz; t_end timestamptz; st text; v_step text;
begin
  if uid is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  select x.* into vp
    from public.application_manager am
    join public.vsat_pipeline x on x.application_id = am.application_id
   where am.lead_id = uid
   order by x.stage_changed_at desc
   limit 1;
  v_step := case when not found then 'interview'
                 when vp.stage = 'counselling_scheduled' then 'counselling'
                 -- vsat_student_sees_booking: stages are changed by hand (0166), so a sent booking shows at PI cleared too
                 when vp.stage = 'pi_cleared' and vp.status = 'active'
                      and exists (select 1 from public.counselling_assignments b
                                   where b.application_id = vp.application_id and b.attempt_no = vp.attempt_no
                                     and b.cancelled_at is null and b.slot_datetime is not null) then 'counselling'
                 when vp.stage = 'pi_cleared' and vp.status = 'active' then 'pi_cleared'
                 when vp.stage in ('interviewed', 'pi_cleared') then 'interviewed'
                 else 'interview' end;
  if v_step <> 'counselling' then return jsonb_build_object('state', 'none', 'now', now(), 'step', v_step); end if;

  select a.slot_datetime, a.duration_min, a.zoom_link, a.attendance, a.meet_mode into r
    from public.counselling_assignments a
   where a.application_id = vp.application_id and a.attempt_no = vp.attempt_no and a.cancelled_at is null and a.slot_datetime is not null
   order by a.slot_datetime desc
   limit 1;
  if not found then return jsonb_build_object('state', 'none', 'now', now(), 'step', v_step); end if;
  t_open := r.slot_datetime - interval '10 minutes';
  t_end  := r.slot_datetime + make_interval(mins => r.duration_min);
  st := case when vp.status = 'absent' or r.attendance = 'no_show' then 'missed'
             when now() < t_open then 'upcoming'
             when now() < t_end then 'open'
             else 'ended' end;
  return jsonb_build_object('state', st, 'now', now(), 'step', v_step, 'start', r.slot_datetime, 'end', t_end, 'opens_at', t_open,
                            'duration_min', r.duration_min, 'has_link', r.zoom_link is not null,
                            -- vsat_counselling_offline: an offline session at the campus (no link, no Join button)
                            'offline', r.meet_mode = 'offline',
                            'meet_link', case when st = 'open' then r.zoom_link end);
end $$;
