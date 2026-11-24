-- Rollback of 0166: puts back the ten functions exactly as they were (0081, 0083, 0140, 0145, 0152) and removes
-- vsat_set_attendance_bulk. Stages that were changed by hand while 0166 was live stay as they are (they are history).

drop function if exists public.vsat_set_attendance_bulk(jsonb);

create or replace function public.vsat__iv_schedule(p_app text, p_iid uuid, p_slot timestamptz, p_dur int, p_link text, p_auto boolean,
                                                    p_source text, p_bulk boolean)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare vp public.vsat_pipeline; cur public.interview_assignments; nxt public.interview_assignments; has_row boolean; live boolean;
        v_mode text; v_link text; v_kind text; v_con text;
begin
  vp := public.vsat__iv_managed(p_app);
  if not exists (select 1 from public.vsat_team t where t.user_id = p_iid and t.role = 'interviewer' and t.active) then
    raise exception 'NOT_AN_INTERVIEWER' using errcode = '22023';
  end if;
  if vp.stage not in ('vsat_cleared', 'interview_scheduled') or vp.status = 'not_selected' then
    raise exception 'WRONG_STAGE' using errcode = '22023';
  end if;
  select * into cur from public.interview_assignments a where a.application_id = p_app and a.attempt_no = vp.attempt_no for update;
  has_row := found;
  live := has_row and cur.cancelled_at is null and cur.slot_datetime is not null and cur.interviewer_id is not null;
  if has_row and cur.submitted_at is not null then raise exception 'ALREADY_INTERVIEWED' using errcode = '22023'; end if;
  if p_bulk and live then raise exception 'ALREADY_SCHEDULED' using errcode = '22023'; end if;
  if p_slot < now() then raise exception 'SLOT_IN_PAST' using errcode = '22023'; end if;

  -- Meet: own link → manual; auto_meet → Google; neither → keep a live interview's own link, else Google
  if p_link is not null and p_auto is true then raise exception 'BAD_VALUE: meet_link' using errcode = '22023'; end if;
  v_mode := case when p_link is not null then 'manual'
                 when p_auto is true then 'auto'
                 when live and cur.meet_mode = 'manual' and cur.meet_link is not null then 'manual'
                 when p_auto is false then 'manual'
                 else 'auto' end;
  v_link := case when v_mode = 'manual' then coalesce(p_link, case when live then cur.meet_link end) end;
  if v_mode = 'manual' and v_link is null then raise exception 'BAD_VALUE: meet_link' using errcode = '22023'; end if;

  -- one booking at a time per interviewer, so two admins can't give the same person overlapping slots
  perform pg_advisory_xact_lock(hashtextextended('vsat_interviewer:' || p_iid::text, 0));
  if public.vsat__iv_busy_until(p_iid, p_slot, p_dur, p_app, vp.attempt_no) is not null then
    raise exception 'SLOT_TAKEN' using errcode = '23505';
  end if;

  if live and cur.interviewer_id = p_iid and cur.slot_datetime = p_slot and cur.duration_min = p_dur
     and cur.meet_mode = v_mode and cur.meet_link is not distinct from (case when v_mode = 'manual' then v_link else cur.meet_link end) then
    -- nothing changed: no new event, no email
    if vp.stage <> 'interview_scheduled' or vp.status <> 'active' then
      perform public.vsat__move_checked(p_app, 'interview_scheduled', 'active',
        case when vp.status <> 'active' then 'interview assigned' end, null, p_source);
    end if;
    return jsonb_build_object('application_id', p_app, 'kind', null, 'slot', p_slot, 'changed', false);
  end if;

  v_kind := case when live then 'rescheduled' else 'scheduled' end;
  begin
    if has_row then
      update public.interview_assignments a
         set interviewer_id = p_iid, slot_datetime = p_slot, duration_min = p_dur, meet_mode = v_mode,
             -- Google: keep the link of a live event (a move keeps it); it is replaced when the event changes
             meet_link = case when v_mode = 'manual' then v_link
                              when a.meet_mode = 'auto' and a.cancelled_at is null and a.calendar_event_id is not null then a.meet_link end,
             attendance = 'scheduled', attendance_source = null, attendance_detail = null, attendance_checked_at = null,
             attendance_check_attempts = 0, attendance_set_by = null,
             reschedule_count = coalesce(a.reschedule_count, 0) + case when live then 1 else 0 end,
             version = a.version + 1, cancelled_at = null, cancelled_by = null, cancel_reason = null,
             -- Google work: make / move the event, or (own link) remove an old one
             meet_sync = case when v_mode = 'auto' or a.calendar_event_id is not null then 'pending' else 'none' end,
             meet_attempts = 0, meet_error = null, meet_claimed_at = null
       where a.id = cur.id
      returning * into nxt;
    else
      insert into public.interview_assignments (application_id, attempt_no, interviewer_id, slot_datetime, duration_min, meet_mode, meet_link,
                                                attendance, reschedule_count, version, meet_sync)
      values (p_app, vp.attempt_no, p_iid, p_slot, p_dur, v_mode, v_link, 'scheduled', 0, 1,
              case when v_mode = 'auto' then 'pending' else 'none' end)
      returning * into nxt;
    end if;
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'interview_assignments_meet_link_slot_datetime_key' then raise exception 'LINK_IN_USE' using errcode = '23505'; end if;
    raise exception 'SLOT_TAKEN' using errcode = '23505';
  end;

  perform public.vsat__iv_event(nxt, v_kind, cur, null, p_source, auth.uid());
  if vp.stage <> 'interview_scheduled' or vp.status <> 'active' then
    perform public.vsat__move_checked(p_app, 'interview_scheduled', 'active',
      case when vp.status <> 'active' then 'interview assigned' end, null, p_source);
  end if;
  return jsonb_build_object('application_id', p_app, 'kind', v_kind, 'slot', nxt.slot_datetime, 'changed', true);
end $$;

create or replace function public.vsat__cs_schedule(p_app text, p_iid uuid, p_slot timestamptz, p_dur int, p_link text, p_auto boolean,
                                                    p_source text, p_bulk boolean)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare vp public.vsat_pipeline; cur public.counselling_assignments; nxt public.counselling_assignments; has_row boolean; live boolean;
        v_mode text; v_link text; v_kind text; v_con text;
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

  -- Meet: own link → manual; auto_meet → Google; neither → keep a live counselling session's own link, else Google
  if p_link is not null and p_auto is true then raise exception 'BAD_VALUE: meet_link' using errcode = '22023'; end if;
  v_mode := case when p_link is not null then 'manual'
                 when p_auto is true then 'auto'
                 when live and cur.meet_mode = 'manual' and cur.zoom_link is not null then 'manual'
                 when p_auto is false then 'manual'
                 else 'auto' end;
  v_link := case when v_mode = 'manual' then coalesce(p_link, case when live then cur.zoom_link end) end;
  if v_mode = 'manual' and v_link is null then raise exception 'BAD_VALUE: meet_link' using errcode = '22023'; end if;

  -- one booking at a time per counsellor, so two admins can't give the same person overlapping slots
  perform pg_advisory_xact_lock(hashtextextended('vsat_counsellor:' || p_iid::text, 0));
  if public.vsat__cs_busy_until(p_iid, p_slot, p_dur, p_app, vp.attempt_no) is not null then
    raise exception 'SLOT_TAKEN' using errcode = '23505';
  end if;

  if live and cur.counsellor_id = p_iid and cur.slot_datetime = p_slot and cur.duration_min = p_dur
     and cur.meet_mode = v_mode and cur.zoom_link is not distinct from (case when v_mode = 'manual' then v_link else cur.zoom_link end) then
    -- nothing changed: no new event, no email
    if vp.stage <> 'counselling_scheduled' or vp.status <> 'active' then
      perform public.vsat__move_checked(p_app, 'counselling_scheduled', 'active',
        case when vp.status <> 'active' then 'counselling assigned' end, null, p_source);
    end if;
    return jsonb_build_object('application_id', p_app, 'kind', null, 'slot', p_slot, 'changed', false);
  end if;

  v_kind := case when live then 'rescheduled' else 'scheduled' end;
  begin
    if has_row then
      update public.counselling_assignments a
         set counsellor_id = p_iid, slot_datetime = p_slot, duration_min = p_dur, meet_mode = v_mode,
             -- Google: keep the link of a live event (a move keeps it); it is replaced when the event changes
             zoom_link = case when v_mode = 'manual' then v_link
                              when a.meet_mode = 'auto' and a.cancelled_at is null and a.calendar_event_id is not null then a.zoom_link end,
             attendance = 'scheduled', attendance_source = null, attendance_detail = null, attendance_checked_at = null,
             attendance_check_attempts = 0, attendance_set_by = null,
             reschedule_count = coalesce(a.reschedule_count, 0) + case when live then 1 else 0 end,
             version = a.version + 1, cancelled_at = null, cancelled_by = null, cancel_reason = null,
             -- Google work: make / move the event, or (own link) remove an old one
             meet_sync = case when v_mode = 'auto' or a.calendar_event_id is not null then 'pending' else 'none' end,
             meet_attempts = 0, meet_error = null, meet_claimed_at = null
       where a.id = cur.id
      returning * into nxt;
    else
      insert into public.counselling_assignments (application_id, attempt_no, counsellor_id, slot_datetime, duration_min, meet_mode, zoom_link,
                                                attendance, reschedule_count, version, meet_sync)
      values (p_app, vp.attempt_no, p_iid, p_slot, p_dur, v_mode, v_link, 'scheduled', 0, 1,
              case when v_mode = 'auto' then 'pending' else 'none' end)
      returning * into nxt;
    end if;
  exception when unique_violation then
    raise exception 'SLOT_TAKEN' using errcode = '23505';
  end;

  perform public.vsat__cs_event(nxt, v_kind, cur, null, p_source, auth.uid());
  if vp.stage <> 'counselling_scheduled' or vp.status <> 'active' then
    perform public.vsat__move_checked(p_app, 'counselling_scheduled', 'active',
      case when vp.status <> 'active' then 'counselling assigned' end, null, p_source);
  end if;
  return jsonb_build_object('application_id', p_app, 'kind', v_kind, 'slot', nxt.slot_datetime, 'changed', true);
end $$;

create or replace function public.vsat_cancel_interview(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare app text; reason text; vp public.vsat_pipeline; cur public.interview_assignments; nxt public.interview_assignments;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['application_id', 'reason']);
  app := public.vsat__txt(p, 'application_id', 64, true);
  vp := public.vsat__iv_managed(app);
  reason := public.vsat__txt(p, 'reason', 450, false);
  if char_length(coalesce(reason, '')) < 3 then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
  select * into cur from public.interview_assignments a where a.application_id = app and a.attempt_no = vp.attempt_no for update;
  if not found or cur.cancelled_at is not null or cur.slot_datetime is null then raise exception 'NO_INTERVIEW' using errcode = 'P0002'; end if;
  if cur.submitted_at is not null or vp.stage <> 'interview_scheduled' then raise exception 'WRONG_STAGE' using errcode = '22023'; end if;

  update public.interview_assignments a
     set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = reason,
         slot_datetime = null, interviewer_id = null, meet_link = null, version = a.version + 1,
         meet_sync = case when a.calendar_event_id is not null then 'pending' else 'none' end,
         meet_attempts = 0, meet_error = null, meet_claimed_at = null,
         attendance = 'scheduled', attendance_source = null, attendance_detail = null, attendance_checked_at = null,
         attendance_check_attempts = 0, attendance_set_by = null
   where a.id = cur.id
  returning * into nxt;
  perform public.vsat__iv_event(nxt, 'cancelled', cur, jsonb_build_object('reason', reason), 'manual', auth.uid());
  perform public.vsat__move_checked(app, 'vsat_cleared', 'active', 'Interview cancelled: ' || reason, 'interview_scheduled', 'manual');
  return public.vsat_student(app);
end $$;

create or replace function public.vsat_cancel_counselling(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare app text; reason text; vp public.vsat_pipeline; cur public.counselling_assignments; nxt public.counselling_assignments;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['application_id', 'reason']);
  app := public.vsat__txt(p, 'application_id', 64, true);
  vp := public.vsat__iv_managed(app);
  reason := public.vsat__txt(p, 'reason', 450, false);
  if char_length(coalesce(reason, '')) < 3 then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
  select * into cur from public.counselling_assignments a where a.application_id = app and a.attempt_no = vp.attempt_no for update;
  if not found or cur.cancelled_at is not null or cur.slot_datetime is null then raise exception 'NO_COUNSELLING' using errcode = 'P0002'; end if;
  if cur.submitted_at is not null or vp.stage <> 'counselling_scheduled' then raise exception 'WRONG_STAGE' using errcode = '22023'; end if;

  update public.counselling_assignments a
     set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = reason,
         slot_datetime = null, counsellor_id = null, zoom_link = null, version = a.version + 1,
         meet_sync = case when a.calendar_event_id is not null then 'pending' else 'none' end,
         meet_attempts = 0, meet_error = null, meet_claimed_at = null,
         attendance = 'scheduled', attendance_source = null, attendance_detail = null, attendance_checked_at = null,
         attendance_check_attempts = 0, attendance_set_by = null
   where a.id = cur.id
  returning * into nxt;
  perform public.vsat__cs_event(nxt, 'cancelled', cur, jsonb_build_object('reason', reason), 'manual', auth.uid());
  perform public.vsat__move_checked(app, 'pi_cleared', 'active', 'Counselling cancelled: ' || reason, 'counselling_scheduled', 'manual');
  return public.vsat_student(app);
end $$;

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

create or replace function public.vsat_submit_counselling(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  app text; vp public.vsat_pipeline; ca public.counselling_assignments; v_campus text; mgr boolean;
  pre jsonb; step numeric; rating int; fin jsonb; actual numeric;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['application_id', 'remarks']);
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
  step := (pre->>'auto_step')::numeric;  -- sheet column BK, never from the request
  if step is null then raise exception 'NO_BAND' using errcode = '22023'; end if;
  rating := (pre->>'special_rating')::int;  -- from the interview (achievements), never from the request
  fin := public.vsat_calc_final_scholarship(step, (pre->>'jee_floor')::numeric, rating, v_campus);
  actual := (fin->>'pct')::numeric;  -- formula only (Q8): no hand-typed %

  update public.counselling_assignments c set
    calc_score = (pre->>'score')::numeric, calc_case = pre->>'case', calc_category = (pre->>'category')::int, award_steps = pre->'award_steps',
    calc_inputs = pre->'inputs', chosen_step = step, jee_floor = (pre->>'jee_floor')::numeric, special_rating = rating,
    bonus_applied = (fin->>'bonus_applied')::boolean, calculated_pct = (fin->>'pct')::numeric, actual_pct = actual,
    actual_reason = null, counsellor_remarks = public.vsat__txt(p, 'remarks', 2000, false),
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

  perform public.vsat__move(app, 'counselled', 'active', null, 'manual', auth.uid(), null);
  return jsonb_build_object('step', step, 'calculated_pct', fin->'pct', 'actual_pct', actual, 'category', pre->'category', 'bonus_applied', fin->'bonus_applied',
                            'special_rating', rating, 'jee_floor_applied', fin->'jee_floor_applied', 'stage', 'counselled');
end $$;
