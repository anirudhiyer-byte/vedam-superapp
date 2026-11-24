-- 0167 · VSAT — Google Meet only: no pasted ("own") meeting links (staging first).
--
-- The owner's review (24 Nov 2026): "No own link — Google Meet only". The screen stopped offering a pasted link in
-- 0166; this makes the database refuse it too, for every way in (vsat_assign_interview / vsat_assign_counsellor,
-- the row Send, the old bulk function): a meet_link / meeting_link or auto_meet = false → BAD_VALUE: meet_link.
-- Bookings that already have a pasted link keep it (their Join link still works, the row shows "Own link"); the next
-- time one is changed (new time or person) it becomes a Google Meet booking: the Google event is made and the
-- student and interviewer / counsellor get the "moved" email with the new link.
-- Counselling: the counsellor's own Zoom link (the owner's review) comes later from a per-counsellor setting, not
-- from a link pasted per booking.
-- Both functions are the live 0166 definitions (md5 checked on staging) with only the marked lines changed.
--
-- Rollback: supabase/rollback/0167_vsat_meet_only_down.sql
-- Tests:    supabase/tests/vsat_meet_only.test.sql

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

  -- vsat_meet_only: Google Meet only (owner's review, 24 Nov 2026). A pasted link is refused; an old booking with a
  -- pasted link moves to Google Meet the next time it is changed (its link is then replaced by the Google one).
  if p_link is not null or p_auto is false then raise exception 'BAD_VALUE: meet_link' using errcode = '22023'; end if;
  v_mode := 'auto';
  v_link := null;

  -- one booking at a time per interviewer, so two admins can't give the same person overlapping slots
  perform pg_advisory_xact_lock(hashtextextended('vsat_interviewer:' || p_iid::text, 0));
  if public.vsat__iv_busy_until(p_iid, p_slot, p_dur, p_app, vp.attempt_no) is not null then
    raise exception 'SLOT_TAKEN' using errcode = '23505';
  end if;

  if live and cur.interviewer_id = p_iid and cur.slot_datetime = p_slot and cur.duration_min = p_dur
     and cur.meet_mode = v_mode and cur.meet_link is not distinct from (case when v_mode = 'manual' then v_link else cur.meet_link end) then
    -- nothing changed: no new event, no email
    -- vsat_manual_stages: booking no longer moves the stage (stages are changed by hand)
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
  -- vsat_manual_stages: booking no longer moves the stage (stages are changed by hand)
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

  -- vsat_meet_only: Google Meet only (owner's review, 24 Nov 2026). A pasted link is refused; an old booking with a
  -- pasted link moves to Google Meet the next time it is changed (its link is then replaced by the Google one).
  if p_link is not null or p_auto is false then raise exception 'BAD_VALUE: meet_link' using errcode = '22023'; end if;
  v_mode := 'auto';
  v_link := null;

  -- one booking at a time per counsellor, so two admins can't give the same person overlapping slots
  perform pg_advisory_xact_lock(hashtextextended('vsat_counsellor:' || p_iid::text, 0));
  if public.vsat__cs_busy_until(p_iid, p_slot, p_dur, p_app, vp.attempt_no) is not null then
    raise exception 'SLOT_TAKEN' using errcode = '23505';
  end if;

  if live and cur.counsellor_id = p_iid and cur.slot_datetime = p_slot and cur.duration_min = p_dur
     and cur.meet_mode = v_mode and cur.zoom_link is not distinct from (case when v_mode = 'manual' then v_link else cur.zoom_link end) then
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
  -- vsat_manual_stages: booking no longer moves the stage (stages are changed by hand)
  return jsonb_build_object('application_id', p_app, 'kind', v_kind, 'slot', nxt.slot_datetime, 'changed', true);
end $$;
