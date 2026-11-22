-- Rollback for 0145_vsat_counselling_scheduling.sql (staging first). Roll back 0145 before 0144.
-- Removes the counselling row booking, Google Meet / attendance / email jobs, the 6 counselling email steps and the
-- new columns, and puts vsat_assign_counsellor back as it was (0081). Counselling sessions already booked stay as rows
-- (counsellor, slot, link); their Google events are NOT deleted on Google (cancel them first if needed). Typed, not-sent
-- values and the counselling history are lost.

drop trigger if exists vsat_counselling_drafts_clear on public.counselling_assignments;

drop function if exists public.vsat_my_counselling();
drop function if exists public.vsat_counselling_drafts_send(jsonb);
drop function if exists public.vsat_counselling_drafts_fill(jsonb);
drop function if exists public.vsat_counselling_draft_set(jsonb);
drop function if exists public.vsat_counselling_plan(jsonb);
drop function if exists public.vsat_counselling_notice_done(jsonb);
drop function if exists public.vsat_counselling_notices_claim(jsonb);
drop function if exists public.vsat_counselling_attendance_apply(jsonb);
drop function if exists public.vsat_counselling_attendance_due(int);
drop function if exists public.vsat_counselling_sync_release(jsonb);
drop function if exists public.vsat_counselling_sync_claim(jsonb);
drop function if exists public.vsat_counselling_meet_retry(jsonb);
drop function if exists public.vsat_set_counselling_attendance(jsonb);
drop function if exists public.vsat_cancel_counselling(jsonb);
drop function if exists public.vsat__cs_drafts_clear();
drop function if exists public.vsat__cs_eff_busy(uuid, timestamptz, int, text[]);
drop function if exists public.vsat__cs_schedule(text, uuid, timestamptz, int, text, boolean, text, boolean);
drop function if exists public.vsat__cs_event(public.counselling_assignments, text, public.counselling_assignments, jsonb, text, uuid);
drop function if exists public.vsat__cs_busy_until(uuid, timestamptz, int, text, int);

-- as in 0081
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

delete from public.vsat_comm_steps where step_key in ('counselling_invite', 'counselling_rescheduled', 'counselling_cancelled',
                                                      'counsellor_invite', 'counsellor_rescheduled', 'counsellor_cancelled');
alter table public.vsat_comm_steps drop constraint if exists vsat_comm_steps_step_key_check;
alter table public.vsat_comm_steps add constraint vsat_comm_steps_step_key_check check (step_key in (
  'first_half', 'application_started', 'payment_reminder_24h', 'payment_confirmed',
  'interview_invite', 'interview_rescheduled', 'interview_cancelled',
  'interviewer_invite', 'interviewer_rescheduled', 'interviewer_cancelled',
  'offer_released'));

drop table if exists public.vsat_counselling_drafts;
drop table if exists public.vsat_counselling_events;

drop index if exists public.counselling_assignments_meet_todo_idx;
drop index if exists public.counselling_assignments_app_attempt_key;
comment on column public.counselling_assignments.zoom_link is null;
alter table public.counselling_assignments
  drop constraint if exists counselling_assignments_duration_check,
  drop constraint if exists counselling_assignments_meet_mode_check,
  drop constraint if exists counselling_assignments_meet_sync_check,
  drop constraint if exists counselling_assignments_att_source_check;
alter table public.counselling_assignments
  drop column if exists duration_min, drop column if exists meet_mode, drop column if exists meet_sync,
  drop column if exists calendar_event_id, drop column if exists event_gen, drop column if exists meet_code,
  drop column if exists meet_error, drop column if exists meet_attempts, drop column if exists meet_claimed_at,
  drop column if exists meet_synced_at, drop column if exists meet_event_version, drop column if exists version,
  drop column if exists cancelled_at, drop column if exists cancelled_by, drop column if exists cancel_reason,
  drop column if exists attendance_source, drop column if exists attendance_detail, drop column if exists attendance_checked_at,
  drop column if exists attendance_check_attempts, drop column if exists attendance_set_by;
