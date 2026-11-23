-- 0152 · Route PI / counselling no-shows into the new not-appeared stages.
--
-- Builds on 0151. A no-show (manual by interviewer/counsellor/manager, or auto from the
-- Google-Meet attendance check) now moves the candidate to pi_not_appeared / counselling_not_appeared
-- instead of leaving them at (scheduled_stage, 'absent'). Correcting a no-show back to "done"
-- moves them back to the scheduled stage (active), so the existing undo path keeps working.
--
-- VSAT exam no-show (vsat_not_appeared) is admin-set from the grid — there is no automatic
-- exam-attendance signal to hook, so no writer changes here for it.
--
-- Only the no-show / correction branches and the stage guard change in each function; every
-- other line is reproduced verbatim from the live definitions.
-- Rollback: supabase/rollback/0152_vsat_not_appeared_writers_down.sql

-- 1) interviewer / manager manual attendance
create or replace function public.vsat_set_interview_attendance(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare app text; v text; reason text; vp public.vsat_pipeline; v_campus text; mgr boolean;
        cur public.interview_assignments; nxt public.interview_assignments;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['application_id', 'attendance', 'reason']);
  app := public.vsat__txt(p, 'application_id', 64, true);
  select * into vp from public.vsat_pipeline where application_id = app;
  if not found then
    if public.vsat__can_manage(null) then raise exception 'NOT_IN_PIPELINE' using errcode = 'P0002'; end if;
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select public.vsat__campus_key(am.campus_applied) into v_campus from public.application_manager am where am.application_id = app;
  mgr := public.vsat__can_manage(v_campus);
  if not mgr and not public.vsat__is_assigned('interviewer', app, vp.attempt_no) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  v := public.vsat__txt(p, 'attendance', 20, true);
  if v not in ('done', 'no_show') then raise exception 'BAD_VALUE: attendance' using errcode = '22023'; end if;
  reason := public.vsat__txt(p, 'reason', 450, false);

  select * into cur from public.interview_assignments a where a.application_id = app and a.attempt_no = vp.attempt_no for update;
  if not found or cur.cancelled_at is not null or cur.slot_datetime is null then raise exception 'NO_INTERVIEW' using errcode = 'P0002'; end if;
  if cur.submitted_at is not null or vp.stage not in ('interview_scheduled', 'pi_not_appeared') then raise exception 'WRONG_STAGE' using errcode = '22023'; end if;
  if cur.slot_datetime > now() then raise exception 'TOO_EARLY' using errcode = '22023'; end if;
  if cur.attendance::text = v then return public.vsat_student(app); end if;
  if cur.attendance <> 'scheduled' then
    if not mgr then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
    if char_length(coalesce(reason, '')) < 3 then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
  end if;

  update public.interview_assignments a
     set attendance = v::public.vm_attendance, attendance_source = 'manual', attendance_set_by = auth.uid(),
         attendance_checked_at = coalesce(a.attendance_checked_at, now())
   where a.id = cur.id
  returning * into nxt;
  perform public.vsat__iv_event(nxt, 'attendance', cur,
    jsonb_build_object('attendance', v, 'from', cur.attendance, 'source', 'manual', 'reason', reason), 'manual', auth.uid());
  if v = 'no_show' and vp.status = 'active' then
    perform public.vsat__move_checked(app, 'pi_not_appeared', 'absent', coalesce(reason, 'Did not join the interview'), vp.stage, 'manual');
  elsif v = 'done' and vp.status = 'absent' then
    perform public.vsat__move_checked(app, 'interview_scheduled', 'active', reason, vp.stage, 'manual');
  end if;
  return public.vsat_student(app);
end $function$;

-- 2) counsellor / manager manual attendance
create or replace function public.vsat_set_counselling_attendance(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare app text; v text; reason text; vp public.vsat_pipeline; v_campus text; mgr boolean;
        cur public.counselling_assignments; nxt public.counselling_assignments;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['application_id', 'attendance', 'reason']);
  app := public.vsat__txt(p, 'application_id', 64, true);
  select * into vp from public.vsat_pipeline where application_id = app;
  if not found then
    if public.vsat__can_manage(null) then raise exception 'NOT_IN_PIPELINE' using errcode = 'P0002'; end if;
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select public.vsat__campus_key(am.campus_applied) into v_campus from public.application_manager am where am.application_id = app;
  mgr := public.vsat__can_manage(v_campus);
  if not mgr and not public.vsat__is_assigned('counsellor', app, vp.attempt_no) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  v := public.vsat__txt(p, 'attendance', 20, true);
  if v not in ('done', 'no_show') then raise exception 'BAD_VALUE: attendance' using errcode = '22023'; end if;
  reason := public.vsat__txt(p, 'reason', 450, false);

  select * into cur from public.counselling_assignments a where a.application_id = app and a.attempt_no = vp.attempt_no for update;
  if not found or cur.cancelled_at is not null or cur.slot_datetime is null then raise exception 'NO_COUNSELLING' using errcode = 'P0002'; end if;
  if cur.submitted_at is not null or vp.stage not in ('counselling_scheduled', 'counselling_not_appeared') then raise exception 'WRONG_STAGE' using errcode = '22023'; end if;
  if cur.slot_datetime > now() then raise exception 'TOO_EARLY' using errcode = '22023'; end if;
  if cur.attendance::text = v then return public.vsat_student(app); end if;
  if cur.attendance <> 'scheduled' then
    if not mgr then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
    if char_length(coalesce(reason, '')) < 3 then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
  end if;

  update public.counselling_assignments a
     set attendance = v::public.vm_attendance, attendance_source = 'manual', attendance_set_by = auth.uid(),
         attendance_checked_at = coalesce(a.attendance_checked_at, now())
   where a.id = cur.id
  returning * into nxt;
  perform public.vsat__cs_event(nxt, 'attendance', cur,
    jsonb_build_object('attendance', v, 'from', cur.attendance, 'source', 'manual', 'reason', reason), 'manual', auth.uid());
  if v = 'no_show' and vp.status = 'active' then
    perform public.vsat__move_checked(app, 'counselling_not_appeared', 'absent', coalesce(reason, 'Did not join the counselling session'), vp.stage, 'manual');
  elsif v = 'done' and vp.status = 'absent' then
    perform public.vsat__move_checked(app, 'counselling_scheduled', 'active', reason, vp.stage, 'manual');
  end if;
  return public.vsat_student(app);
end $function$;

-- 3) interview auto-attendance (Google Meet check)
create or replace function public.vsat_interview_attendance_apply(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare v_id uuid; ver int; res text; det jsonb; d jsonb; cur public.interview_assignments; nxt public.interview_assignments; vp public.vsat_pipeline;
begin
  perform public.vsat__check_keys(p, array['id', 'version', 'result', 'detail']);
  begin v_id := (public.vsat__txt(p, 'id', 40, true))::uuid;
  exception when invalid_text_representation then raise exception 'BAD_VALUE: id' using errcode = '22023'; end;
  ver := public.vsat__num(p, 'version', 0, 1000000000, true)::int;
  res := public.vsat__txt(p, 'result', 20, true);
  if res not in ('done', 'no_show', 'needs_marking', 'retry') then raise exception 'BAD_VALUE: result' using errcode = '22023'; end if;
  d := case when jsonb_typeof(p->'detail') = 'object' then p->'detail' else '{}'::jsonb end;
  det := jsonb_build_object('result', res, 'checked_at', now(),
           'people', case when jsonb_typeof(d->'people') = 'number' then d->'people' end,
           'overlap_min', case when jsonb_typeof(d->'overlap_min') = 'number' then d->'overlap_min' end,
           'records', case when jsonb_typeof(d->'records') = 'number' then d->'records' end,
           'reason', case when d->>'reason' in ('nobody_joined', 'one_joined', 'too_short', 'no_record', 'check_failed') then d->'reason' end);

  select * into cur from public.interview_assignments a where a.id = v_id for update;
  if not found or cur.version <> ver or cur.cancelled_at is not null or cur.attendance <> 'scheduled'
     or cur.attendance_source is not null or cur.attendance_checked_at is not null or cur.submitted_at is not null then
    return jsonb_build_object('applied', false);
  end if;
  if res = 'retry' then
    update public.interview_assignments a set attendance_check_attempts = a.attendance_check_attempts + 1 where a.id = v_id;
    return jsonb_build_object('applied', true);
  end if;

  if res = 'needs_marking' then
    update public.interview_assignments a
       set attendance_detail = det, attendance_checked_at = now(), attendance_check_attempts = a.attendance_check_attempts + 1
     where a.id = v_id
    returning * into nxt;
  else
    update public.interview_assignments a
       set attendance = res::public.vm_attendance, attendance_source = 'auto',
           attendance_detail = det, attendance_checked_at = now(), attendance_check_attempts = a.attendance_check_attempts + 1
     where a.id = v_id
    returning * into nxt;
  end if;
  perform public.vsat__iv_event(nxt, 'attendance', cur, det || jsonb_build_object('source', 'auto'), 'auto', null);
  if res = 'no_show' then
    select * into vp from public.vsat_pipeline where application_id = cur.application_id;
    if found and vp.attempt_no = cur.attempt_no and vp.stage = 'interview_scheduled' and vp.status = 'active' then
      perform public.vsat__move(cur.application_id, 'pi_not_appeared', 'absent',
        'Did not join the Google Meet (checked automatically)', 'auto', null, 'interview_scheduled');
    end if;
  end if;
  return jsonb_build_object('applied', true);
end $function$;

-- 4) counselling auto-attendance (Google Meet check)
create or replace function public.vsat_counselling_attendance_apply(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare v_id uuid; ver int; res text; det jsonb; d jsonb; cur public.counselling_assignments; nxt public.counselling_assignments; vp public.vsat_pipeline;
begin
  perform public.vsat__check_keys(p, array['id', 'version', 'result', 'detail']);
  begin v_id := (public.vsat__txt(p, 'id', 40, true))::uuid;
  exception when invalid_text_representation then raise exception 'BAD_VALUE: id' using errcode = '22023'; end;
  ver := public.vsat__num(p, 'version', 0, 1000000000, true)::int;
  res := public.vsat__txt(p, 'result', 20, true);
  if res not in ('done', 'no_show', 'needs_marking', 'retry') then raise exception 'BAD_VALUE: result' using errcode = '22023'; end if;
  d := case when jsonb_typeof(p->'detail') = 'object' then p->'detail' else '{}'::jsonb end;
  det := jsonb_build_object('result', res, 'checked_at', now(),
           'people', case when jsonb_typeof(d->'people') = 'number' then d->'people' end,
           'overlap_min', case when jsonb_typeof(d->'overlap_min') = 'number' then d->'overlap_min' end,
           'records', case when jsonb_typeof(d->'records') = 'number' then d->'records' end,
           'reason', case when d->>'reason' in ('nobody_joined', 'one_joined', 'too_short', 'no_record', 'check_failed') then d->'reason' end);

  select * into cur from public.counselling_assignments a where a.id = v_id for update;
  if not found or cur.version <> ver or cur.cancelled_at is not null or cur.attendance <> 'scheduled'
     or cur.attendance_source is not null or cur.attendance_checked_at is not null or cur.submitted_at is not null then
    return jsonb_build_object('applied', false);
  end if;
  if res = 'retry' then
    update public.counselling_assignments a set attendance_check_attempts = a.attendance_check_attempts + 1 where a.id = v_id;
    return jsonb_build_object('applied', true);
  end if;

  if res = 'needs_marking' then
    update public.counselling_assignments a
       set attendance_detail = det, attendance_checked_at = now(), attendance_check_attempts = a.attendance_check_attempts + 1
     where a.id = v_id
    returning * into nxt;
  else
    update public.counselling_assignments a
       set attendance = res::public.vm_attendance, attendance_source = 'auto',
           attendance_detail = det, attendance_checked_at = now(), attendance_check_attempts = a.attendance_check_attempts + 1
     where a.id = v_id
    returning * into nxt;
  end if;
  perform public.vsat__cs_event(nxt, 'attendance', cur, det || jsonb_build_object('source', 'auto'), 'auto', null);
  if res = 'no_show' then
    select * into vp from public.vsat_pipeline where application_id = cur.application_id;
    if found and vp.attempt_no = cur.attempt_no and vp.stage = 'counselling_scheduled' and vp.status = 'active' then
      perform public.vsat__move(cur.application_id, 'counselling_not_appeared', 'absent',
        'Did not join the Google Meet (checked automatically)', 'auto', null, 'counselling_scheduled');
    end if;
  end if;
  return jsonb_build_object('applied', true);
end $function$;