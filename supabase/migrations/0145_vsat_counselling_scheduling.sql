-- 0145 · VSAT Phase 3, part 2 — counselling scheduling with Google Meet, booked from the Counselling panel rows (staging first).
--
-- Decisions (owner, 23 Nov 2026): Phase 3 counselling works exactly like the interviews (0140 + 0143):
--   * Admin / admissions type Counsellor, Date and Time on each student's row in the Counselling panel, select rows and
--     press one Send: every row is booked with its own time, its own Google Meet and its own emails. "Fill times" types
--     back-to-back times for the selection. What is typed but not sent is kept in the database and counts in the clash check.
--   * The same admissions Google account (ADMISSIONS_* env), 30 minutes by default, the student's Join button from
--     10 minutes before the start until the end, attendance read from Google Meet (not joined → no-show, the student is
--     marked absent; admins can change it), emails through 6 new VSAT comms steps (OFF and in test mode until turned on).
--   * The drawer: schedule / move / cancel one student, Meet state, attendance — same as the interview.
--   * The student's card shows the counselling session the same way as the interview (vsat_my_counselling).
--
-- Built from the interview functions (0140 / 0143) with the counselling table, stage and role. Differences:
--   * the link column of counselling_assignments is zoom_link (it holds a Google Meet or an own link);
--   * from PI cleared (instead of VSAT cleared); a cancel moves the student back to PI cleared;
--   * error codes NOT_A_COUNSELLOR, ALREADY_COUNSELLED (counselling saved), NO_COUNSELLING;
--   * vsat_assign_counsellor keeps its request keys (meeting_link) and gains duration_min / auto_meet;
--   * no "link already used at this time" rule (counselling_assignments has no such key).
--
-- Existing counselling rows (120 on staging, all with a hand-pasted link) become meet_mode 'manual': no Google event and
-- no email is made for them unless someone reschedules them.
--
-- What this adds
--   counselling_assignments    + duration, Meet mode, Google sync state, version, cancel info, attendance source / detail
--   vsat_counselling_events    history of every schedule / move / cancel / attendance change + the email outbox
--   vsat_counselling_drafts    the counsellor / time typed on a row, not sent yet
--   vsat_comm_steps            + 6 counselling steps (student + counsellor × invite / moved / cancelled)
--   RPCs (signed-in staff; every check is inside):
--     vsat_assign_counsellor(p)          replaced: Google Meet (or own link), length, overlap check, no past slots, history + emails
--     vsat_cancel_counselling(p)         admin / admissions: removes the slot and the Meet; student back to PI cleared
--     vsat_set_counselling_attendance(p) admin / admissions, or the counsellor (first mark)
--     vsat_counselling_meet_retry(p)     admin / admissions: try the Google Meet again after it failed
--     vsat_counselling_plan / _draft_set / _drafts_fill / _drafts_send   the row booking (as 0143)
--     vsat_my_counselling()              the student: own session; the link only inside the join window
--   Server only (service_role): vsat_counselling_sync_claim / _sync_release / _attendance_due / _attendance_apply /
--     _notices_claim / _notice_done
--
-- Uses vsat__iv_ts, vsat__iv_dur, vsat__iv_managed (0140) and vsat__iv_ids (0143). Apply after 0144.
-- Rollback: supabase/rollback/0145_vsat_counselling_scheduling_down.sql
-- Tests:    supabase/tests/vsat_counselling_scheduling.test.sql

-- ═════════════ 1. counselling_assignments: new columns ═════════════
alter table public.counselling_assignments
  add column if not exists duration_min              int not null default 30,
  add column if not exists meet_mode                 text not null default 'auto',
  add column if not exists meet_sync                 text not null default 'none',
  add column if not exists calendar_event_id         text,
  add column if not exists event_gen                 int not null default 0,
  add column if not exists meet_code                 text,
  add column if not exists meet_error                text,
  add column if not exists meet_attempts             int not null default 0,
  add column if not exists meet_claimed_at           timestamptz,
  add column if not exists meet_synced_at            timestamptz,
  add column if not exists meet_event_version        int,
  add column if not exists version                   int not null default 0,
  add column if not exists cancelled_at              timestamptz,
  add column if not exists cancelled_by              uuid,
  add column if not exists cancel_reason             text,
  add column if not exists attendance_source         text,
  add column if not exists attendance_detail         jsonb,
  add column if not exists attendance_checked_at     timestamptz,
  add column if not exists attendance_check_attempts int not null default 0,
  add column if not exists attendance_set_by         uuid;

alter table public.counselling_assignments
  add constraint counselling_assignments_duration_check   check (duration_min between 10 and 180),
  add constraint counselling_assignments_meet_mode_check  check (meet_mode in ('auto', 'manual')),
  add constraint counselling_assignments_meet_sync_check  check (meet_sync in ('none', 'pending', 'syncing', 'ok', 'failed')),
  add constraint counselling_assignments_att_source_check check (attendance_source in ('auto', 'manual'));

-- the save logic keeps ONE row per student + attempt (staging has no duplicates); make the database say so
create unique index if not exists counselling_assignments_app_attempt_key on public.counselling_assignments (application_id, attempt_no);
create index if not exists counselling_assignments_meet_todo_idx on public.counselling_assignments (meet_sync) where meet_sync in ('pending', 'syncing', 'failed');

comment on column public.counselling_assignments.zoom_link is 'The meeting link: the Google Meet made by the admissions account (meet_mode auto) or a link pasted by staff (manual).';
comment on column public.counselling_assignments.meet_mode is 'auto = Google Calendar event + Meet from the admissions account; manual = a link pasted by staff (no Google event).';
comment on column public.counselling_assignments.meet_sync is 'Google work state: none | pending (queued) | syncing (a server run holds it) | ok | failed (retried by the cron up to 5 times).';
comment on column public.counselling_assignments.version is 'Bumped on every schedule / move / cancel. Events and attendance checks carry it, so stale work is ignored.';

-- existing sessions were all given a hand-pasted link: keep them as they are
update public.counselling_assignments set meet_mode = 'manual' where zoom_link is not null and meet_mode = 'auto';

-- ═════════════ 2. history + email outbox ═════════════
create table if not exists public.vsat_counselling_events (
  id                  uuid primary key default gen_random_uuid(),
  assignment_id       uuid not null references public.counselling_assignments(id) on delete cascade,
  application_id      text not null,
  attempt_no          int not null,
  kind                text not null check (kind in ('scheduled', 'rescheduled', 'cancelled', 'attendance')),
  version             int not null,
  slot_start          timestamptz,
  duration_min        int,
  counsellor_id       uuid,
  meet_mode           text,
  prev_slot_start     timestamptz,
  prev_duration_min   int,
  prev_counsellor_id  uuid,
  detail              jsonb,
  source              text not null check (source in ('manual', 'bulk', 'auto')),
  actor_id            uuid,
  created_at          timestamptz not null default now(),
  notify_status       text not null default 'none' check (notify_status in ('none', 'pending', 'sending', 'sent', 'skipped', 'failed')),
  notify_attempts     int not null default 0,
  notify_claimed_at   timestamptz,
  notify_detail       jsonb,
  notified_at         timestamptz
);
create index if not exists vsat_counselling_events_assignment_idx on public.vsat_counselling_events (assignment_id, created_at);
create index if not exists vsat_counselling_events_outbox_idx on public.vsat_counselling_events (created_at) where notify_status in ('pending', 'sending');
alter table public.vsat_counselling_events enable row level security;
revoke all on table public.vsat_counselling_events from public, anon, authenticated;
grant select on table public.vsat_counselling_events to service_role;
comment on table public.vsat_counselling_events is
  'VSAT counselling: one row per schedule / move / cancel / attendance change (who, when, before → after). Also the email outbox the server reads through vsat_counselling_notices_claim. Browsers never read it directly.';

-- ═════════════ 3. typed, not-sent-yet values (Counselling panel rows) ═════════════
create table if not exists public.vsat_counselling_drafts (
  application_id text primary key references public.vsat_pipeline(application_id) on delete cascade,
  attempt_no     int not null,
  counsellor_id  uuid,
  slot_datetime  timestamptz,
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  constraint vsat_counselling_drafts_not_empty check (counsellor_id is not null or slot_datetime is not null)
);
create index if not exists vsat_counselling_drafts_counsellor_idx on public.vsat_counselling_drafts (counsellor_id, slot_datetime)
  where counsellor_id is not null and slot_datetime is not null;
alter table public.vsat_counselling_drafts enable row level security;
revoke all on table public.vsat_counselling_drafts from public, anon, authenticated;
comment on table public.vsat_counselling_drafts is
  'VSAT Counselling panel: the counsellor / time typed on a student''s row and not sent yet. Read and written only through vsat_counselling_* functions. Cleared when the student is booked, moved or cancelled.';

-- ═════════════ 4. VSAT comms: counselling steps (off + test mode) ═════════════
alter table public.vsat_comm_steps drop constraint if exists vsat_comm_steps_step_key_check;
alter table public.vsat_comm_steps add constraint vsat_comm_steps_step_key_check check (step_key in (
  'first_half', 'application_started', 'payment_reminder_24h', 'payment_confirmed',
  'interview_invite', 'interview_rescheduled', 'interview_cancelled',
  'interviewer_invite', 'interviewer_rescheduled', 'interviewer_cancelled',
  'offer_released',
  'counselling_invite', 'counselling_rescheduled', 'counselling_cancelled',
  'counsellor_invite', 'counsellor_rescheduled', 'counsellor_cancelled'));

insert into public.vsat_comm_steps (step_key, title, sort, wa_enabled, email_subject, email_body) values
  ('counselling_invite', 'Counselling scheduled → student', 11, false,
   'Your Vedam counselling session: {{date}}, {{time}}',
   '<p>Hi {{name}},</p><p>Your Vedam counselling session is scheduled.</p><p><b>When:</b> {{date}}, {{time}}<br><b>Where:</b> Google Meet</p><p><a href="{{join_link}}">Join the session →</a></p><p>You can also join from your <a href="{{dashboard_link}}">dashboard</a>. The Join button opens 10 minutes before the start. Please join on time from a quiet place, with your camera and microphone working.</p><p>All the best,<br>Team Vedam</p>'),
  ('counselling_rescheduled', 'Counselling moved → student', 12, false,
   'Your Vedam counselling session has moved: {{date}}, {{time}}',
   '<p>Hi {{name}},</p><p>Your Vedam counselling session has a new time.</p><p><b>New time:</b> {{date}}, {{time}}<br><b>Earlier time:</b> {{old_date}}, {{old_time}}<br><b>Where:</b> Google Meet</p><p><a href="{{join_link}}">Join the session →</a></p><p>You can also join from your <a href="{{dashboard_link}}">dashboard</a>. The Join button opens 10 minutes before the start.</p><p>All the best,<br>Team Vedam</p>'),
  ('counselling_cancelled', 'Counselling cancelled → student', 13, false,
   'Your Vedam counselling session on {{old_date}} is cancelled',
   '<p>Hi {{name}},</p><p>Your Vedam counselling session on {{old_date}}, {{old_time}} has been cancelled. The admissions team will share a new time with you soon.</p><p>You can check your <a href="{{dashboard_link}}">dashboard</a> for updates.</p><p>Warmly,<br>Team Vedam</p>'),
  ('counsellor_invite', 'Counselling assigned → counsellor', 14, false,
   'Counselling assigned: {{student_name}}, {{date}}, {{time}}',
   '<p>Hi {{name}},</p><p>You have a VSAT counselling session with <b>{{student_name}}</b> ({{application_no}}).</p><p><b>When:</b> {{date}}, {{time}}<br><b>Meet:</b> <a href="{{join_link}}">{{join_link}}</a></p><p>The student''s details, the profile briefing and the counselling form are in the <a href="{{panel_link}}">Counselling panel</a>.</p><p>Thanks,<br>Vedam Admissions</p>'),
  ('counsellor_rescheduled', 'Counselling moved → counsellor', 15, false,
   'Counselling moved: {{student_name}}, {{date}}, {{time}}',
   '<p>Hi {{name}},</p><p>Your VSAT counselling session with <b>{{student_name}}</b> ({{application_no}}) has a new time.</p><p><b>New time:</b> {{date}}, {{time}}<br><b>Earlier time:</b> {{old_date}}, {{old_time}}<br><b>Meet:</b> <a href="{{join_link}}">{{join_link}}</a></p><p>Thanks,<br>Vedam Admissions</p>'),
  ('counsellor_cancelled', 'Counselling cancelled → counsellor', 16, false,
   'Counselling cancelled: {{student_name}}, {{old_date}}',
   '<p>Hi {{name}},</p><p>Your VSAT counselling session with <b>{{student_name}}</b> ({{application_no}}) on {{old_date}}, {{old_time}} is no longer on your schedule.</p><p>Thanks,<br>Vedam Admissions</p>')
on conflict (step_key) do nothing;

-- ═════════════ 5. functions (as the interview ones, for counselling) ═════════════
-- end of the counsellor's latest booking that overlaps [p_start, p_start + p_dur), or null when free
create or replace function public.vsat__cs_busy_until(p_iid uuid, p_start timestamptz, p_dur int, p_app text, p_attempt int)
returns timestamptz language sql stable security definer set search_path to '' as $$
  select max(a.slot_datetime + make_interval(mins => a.duration_min))
    from public.counselling_assignments a
   where a.counsellor_id = p_iid and a.slot_datetime is not null and a.cancelled_at is null
     and not (a.application_id = p_app and a.attempt_no = p_attempt)
     and a.slot_datetime < p_start + make_interval(mins => p_dur)
     and a.slot_datetime + make_interval(mins => a.duration_min) > p_start
$$;

-- one history row (and, for schedule / move / cancel, one pending email job)
create or replace function public.vsat__cs_event(p_now public.counselling_assignments, p_kind text, p_before public.counselling_assignments,
                                                 p_detail jsonb, p_source text, p_actor uuid)
returns uuid language plpgsql security definer set search_path to '' as $$
declare v_id uuid;
begin
  insert into public.vsat_counselling_events (assignment_id, application_id, attempt_no, kind, version, slot_start, duration_min, counsellor_id,
                                            meet_mode, prev_slot_start, prev_duration_min, prev_counsellor_id, detail, source, actor_id, notify_status)
  values (p_now.id, p_now.application_id, p_now.attempt_no, p_kind, p_now.version, p_now.slot_datetime, p_now.duration_min, p_now.counsellor_id,
          p_now.meet_mode, p_before.slot_datetime, p_before.duration_min, p_before.counsellor_id, p_detail, p_source, p_actor,
          case when p_kind in ('scheduled', 'rescheduled', 'cancelled') then 'pending' else 'none' end)
  returning id into v_id;
  return v_id;
end $$;

-- schedule or move one counselling session (role already checked by the caller through vsat__iv_managed).
-- p_link = own link (manual); p_auto true = Google Meet; neither = keep what a live counselling session had (new ones: Google).
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

-- p: {application_id, reason}. Removes the slot (and the Google event), student back to PI cleared.
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

-- p: {application_id, attendance: 'done' | 'no_show', reason?}
-- Admin / admissions: any change (reason needed when changing an earlier mark). The assigned counsellor: the first mark only.
-- no_show → the student is marked absent; done after absent → back to active (admins, with a reason).
create or replace function public.vsat_set_counselling_attendance(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
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
  if cur.submitted_at is not null or vp.stage <> 'counselling_scheduled' then raise exception 'WRONG_STAGE' using errcode = '22023'; end if;
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
    perform public.vsat__move_checked(app, 'counselling_scheduled', 'absent', coalesce(reason, 'Did not join the counselling session'), 'counselling_scheduled', 'manual');
  elsif v = 'done' and vp.status = 'absent' then
    perform public.vsat__move_checked(app, 'counselling_scheduled', 'active', reason, 'counselling_scheduled', 'manual');
  end if;
  return public.vsat_student(app);
end $$;

-- p: {application_id}. Google failed for good (5 tries) → queue it again.
create or replace function public.vsat_counselling_meet_retry(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare app text; vp public.vsat_pipeline; n int;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['application_id']);
  app := public.vsat__txt(p, 'application_id', 64, true);
  vp := public.vsat__iv_managed(app);
  update public.counselling_assignments a
     set meet_sync = 'pending', meet_attempts = 0, meet_error = null, meet_claimed_at = null
   where a.application_id = app and a.attempt_no = vp.attempt_no and a.meet_sync = 'failed'
     and (a.meet_mode = 'auto' or a.calendar_event_id is not null);
  get diagnostics n = row_count;
  if n = 0 then raise exception 'NOTHING_TO_RETRY' using errcode = '22023'; end if;
  return public.vsat_student(app);
end $$;

-- Google work: claim up to `limit` counselling sessions whose event must be made, moved or removed. p: {limit? (1–50), application_ids?}
-- A claim is held for 3 minutes; the token (claimed_at) must come back with the result.
create or replace function public.vsat_counselling_sync_claim(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare lim int; ids text[]; claimed uuid[];
begin
  p := coalesce(p, '{}'::jsonb);
  perform public.vsat__check_keys(p, array['limit', 'application_ids']);
  lim := coalesce(public.vsat__num(p, 'limit', 1, 50, false), 20)::int;
  if p ? 'application_ids' then
    if jsonb_typeof(p->'application_ids') <> 'array' then raise exception 'BAD_VALUE: application_ids' using errcode = '22023'; end if;
    select array_agg(x) into ids from jsonb_array_elements_text(p->'application_ids') x;
    if coalesce(array_length(ids, 1), 0) > 200 then raise exception 'BAD_VALUE: application_ids' using errcode = '22023'; end if;
  end if;

  with cand as (
    select a.id
      from public.counselling_assignments a
     where (a.meet_sync = 'pending' or (a.meet_sync = 'failed' and a.meet_attempts < 5)
            or (a.meet_sync = 'syncing' and a.meet_claimed_at < now() - interval '3 minutes'))
       and (ids is null or a.application_id = any(ids))
     order by a.slot_datetime nulls first
     limit lim
       for update of a skip locked
  ), upd as (
    update public.counselling_assignments a
       set meet_sync = 'syncing', meet_claimed_at = clock_timestamp(), meet_attempts = a.meet_attempts + 1
      from cand
     where a.id = cand.id
    returning a.id
  )
  select array_agg(upd.id) into claimed from upd;

  if claimed is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', a.id, 'version', a.version, 'claimed_at', a.meet_claimed_at, 'attempts', a.meet_attempts,
             'application_id', a.application_id, 'slot_start', a.slot_datetime, 'duration_min', a.duration_min,
             'meet_mode', a.meet_mode, 'cancelled', a.cancelled_at is not null, 'calendar_event_id', a.calendar_event_id,
             'event_gen', a.event_gen, 'event_version', a.meet_event_version,
             'student', jsonb_build_object('name', am.registered_name, 'email', am.registered_email,
                                           'application_no', coalesce(am.application_no::text, am.application_id)),
             'counsellor', case when a.counsellor_id is not null then
                              jsonb_build_object('id', a.counsellor_id, 'name', coalesce(ip.full_name, ip.email), 'email', ip.email) end)
             order by a.slot_datetime nulls first)
      from public.counselling_assignments a
      join public.application_manager am on am.application_id = a.application_id
      left join public.profiles ip on ip.id = a.counsellor_id
     where a.id = any(claimed)), '[]'::jsonb);
end $$;

-- Google work: the result of one claim.
-- p: {id, version, claimed_at, outcome: ok | pending (Meet link not ready yet) | failed | none (no event wanted),
--     final? (failed: stop retrying), error?, calendar_event_id?, meet_link?, meet_code?, event_gen?, deleted_event_id?}
-- What happened on Google (an event made or deleted) is recorded even if the counselling session changed meanwhile, so no
-- event is ever lost track of; the state itself is written only while this run still holds the claim.
create or replace function public.vsat_counselling_sync_release(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_id uuid; ver int; v_claimed timestamptz; outc text; ev text; del text; link text; code text; gen int; err text; fin boolean;
        cur public.counselling_assignments;
begin
  perform public.vsat__check_keys(p, array['id', 'version', 'claimed_at', 'outcome', 'final', 'error', 'calendar_event_id',
                                           'meet_link', 'meet_code', 'event_gen', 'deleted_event_id']);
  begin v_id := (public.vsat__txt(p, 'id', 40, true))::uuid;
  exception when invalid_text_representation then raise exception 'BAD_VALUE: id' using errcode = '22023'; end;
  ver := public.vsat__num(p, 'version', 0, 1000000000, true)::int;
  begin v_claimed := (public.vsat__txt(p, 'claimed_at', 40, true))::timestamptz;
  exception when others then raise exception 'BAD_VALUE: claimed_at' using errcode = '22023'; end;
  outc := public.vsat__txt(p, 'outcome', 10, true);
  if outc not in ('ok', 'pending', 'failed', 'none') then raise exception 'BAD_VALUE: outcome' using errcode = '22023'; end if;
  ev := public.vsat__txt(p, 'calendar_event_id', 1024, false);
  if ev is not null and ev !~ '^[a-v0-9]{5,}$' then raise exception 'BAD_VALUE: calendar_event_id' using errcode = '22023'; end if;
  del := public.vsat__txt(p, 'deleted_event_id', 1024, false);
  link := public.vsat__txt(p, 'meet_link', 300, false);
  if link is not null and link !~ '^https://meet\.google\.com/[a-z0-9-]+$' then raise exception 'BAD_VALUE: meet_link' using errcode = '22023'; end if;
  code := public.vsat__txt(p, 'meet_code', 40, false);
  if code is not null and code !~ '^[a-z0-9-]{3,40}$' then raise exception 'BAD_VALUE: meet_code' using errcode = '22023'; end if;
  gen := public.vsat__num(p, 'event_gen', 0, 1000, false)::int;
  err := left(public.vsat__txt(p, 'error', 2000, false), 300);
  fin := coalesce(public.vsat__bool(p, 'final', false), false);

  select * into cur from public.counselling_assignments a where a.id = v_id for update;
  if not found then return jsonb_build_object('applied', false); end if;

  if del is not null and cur.calendar_event_id = del then
    update public.counselling_assignments a
       set calendar_event_id = null, meet_code = null, meet_event_version = null, event_gen = a.event_gen + 1,
           zoom_link = case when a.meet_mode = 'auto' then null else a.zoom_link end
     where a.id = v_id
    returning * into cur;
  end if;
  if ev is not null and cur.calendar_event_id is null then
    update public.counselling_assignments a
       set calendar_event_id = ev, event_gen = greatest(a.event_gen, coalesce(gen, a.event_gen))
     where a.id = v_id
    returning * into cur;
  end if;

  if not (cur.meet_sync = 'syncing' and cur.version = ver and cur.meet_claimed_at = v_claimed) then
    return jsonb_build_object('applied', false);
  end if;
  update public.counselling_assignments a
     set meet_claimed_at = null,
         meet_sync = outc,
         meet_error = case when outc = 'failed' then coalesce(err, 'failed') end,
         meet_attempts = case when outc in ('ok', 'none') then 0 when outc = 'failed' and fin then greatest(a.meet_attempts, 5) else a.meet_attempts end,
         zoom_link = case when outc in ('ok', 'pending') and link is not null and a.meet_mode = 'auto' and a.cancelled_at is null then link else a.zoom_link end,
         meet_code = case when outc in ('ok', 'pending') and code is not null then code else a.meet_code end,
         meet_event_version = case when outc in ('ok', 'pending') and a.calendar_event_id is not null then ver else a.meet_event_version end,
         meet_synced_at = case when outc in ('ok', 'none') then now() else a.meet_synced_at end
   where a.id = v_id;
  return jsonb_build_object('applied', true);
end $$;

-- Google counselling sessions that ended at least 10 minutes ago and still have no attendance (last 3 days, 12 tries max)
create or replace function public.vsat_counselling_attendance_due(p_limit int)
returns jsonb language sql stable security definer set search_path to '' as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.slot_datetime), '[]'::jsonb)
    from (select a.id, a.version, a.application_id, a.slot_datetime, a.duration_min, a.meet_code, a.attendance_check_attempts
            from public.counselling_assignments a
            join public.vsat_pipeline vp on vp.application_id = a.application_id and vp.attempt_no = a.attempt_no
           where a.meet_mode = 'auto' and a.meet_sync = 'ok' and a.meet_code is not null and a.cancelled_at is null
             and a.slot_datetime is not null and a.attendance = 'scheduled' and a.attendance_source is null
             and a.attendance_checked_at is null and a.submitted_at is null and vp.stage = 'counselling_scheduled'
             and a.slot_datetime + make_interval(mins => a.duration_min + 10) < now()
             and a.slot_datetime > now() - interval '3 days'
             and a.attendance_check_attempts < 12
           order by a.slot_datetime
           limit least(greatest(coalesce(p_limit, 20), 1), 50)) x
$$;

-- p: {id, version, result: done | no_show | needs_marking | retry, detail?: {people, overlap_min, records, reason}}
-- Applies only if nothing changed meanwhile (same version, still unmarked). no_show → the student is marked absent.
create or replace function public.vsat_counselling_attendance_apply(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_id uuid; ver int; res text; det jsonb; d jsonb; cur public.counselling_assignments; nxt public.counselling_assignments; vp public.vsat_pipeline;
begin
  perform public.vsat__check_keys(p, array['id', 'version', 'result', 'detail']);
  begin v_id := (public.vsat__txt(p, 'id', 40, true))::uuid;
  exception when invalid_text_representation then raise exception 'BAD_VALUE: id' using errcode = '22023'; end;
  ver := public.vsat__num(p, 'version', 0, 1000000000, true)::int;
  res := public.vsat__txt(p, 'result', 20, true);
  if res not in ('done', 'no_show', 'needs_marking', 'retry') then raise exception 'BAD_VALUE: result' using errcode = '22023'; end if;
  d := case when jsonb_typeof(p->'detail') = 'object' then p->'detail' else '{}'::jsonb end;
  -- only known, small values are kept
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
    -- attendance stays 'scheduled'; the drawer shows why and asks an admin to mark it
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
      perform public.vsat__move(cur.application_id, 'counselling_scheduled', 'absent',
        'Did not join the Google Meet (checked automatically)', 'auto', null, 'counselling_scheduled');
    end if;
  end if;
  return jsonb_build_object('applied', true);
end $$;

-- Email outbox: claim the jobs to send now. p: {limit? (1–100), wait_for_meet? (default true), application_ids?}
-- Only the newest job per counselling session (highest version) is sent (older pending ones are skipped as superseded); a job for a counselling session
-- whose Google Meet is still being made waits up to 20 minutes so the email can carry the link; jobs for a time
-- that has already passed are skipped. `baseline` = what the people were last emailed (to pick invite vs moved).
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

-- p: {id, status: sent | skipped | failed, detail?: {sent_to: [...], ...}}. failed → retried (5 tries in all).
create or replace function public.vsat_counselling_notice_done(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_id uuid; st text; d jsonb; n int;
begin
  perform public.vsat__check_keys(p, array['id', 'status', 'detail']);
  begin v_id := (public.vsat__txt(p, 'id', 40, true))::uuid;
  exception when invalid_text_representation then raise exception 'BAD_VALUE: id' using errcode = '22023'; end;
  st := public.vsat__txt(p, 'status', 10, true);
  if st not in ('sent', 'skipped', 'failed') then raise exception 'BAD_VALUE: status' using errcode = '22023'; end if;
  d := case when jsonb_typeof(p->'detail') = 'object' and pg_column_size(p->'detail') < 4000 then p->'detail' else null end;
  update public.vsat_counselling_events ev
     set notify_status = case when st = 'failed' and ev.notify_attempts < 5 then 'pending' else st end,
         notify_detail = d, notify_claimed_at = null,
         notified_at = case when st = 'failed' and ev.notify_attempts < 5 then null else now() end
   where ev.id = v_id and ev.notify_status = 'sending';
  get diagnostics n = row_count;
  return jsonb_build_object('updated', n = 1);
end $$;

-- The counsellor's busiest overlap with [p_start, p_start + p_dur) in the effective plan, or no row when free.
-- Effective plan: complete typed rows of students who can still be booked (at the typed time) + every live
-- booking of the other students. Students in p_exclude are left out entirely.
create or replace function public.vsat__cs_eff_busy(p_iid uuid, p_start timestamptz, p_dur int, p_exclude text[])
returns table (clash_app text, busy_until timestamptz)
language sql stable security definer set search_path to '' as $$
  with moving as (
    select d.application_id, d.counsellor_id, d.slot_datetime,
           coalesce((select a.duration_min from public.counselling_assignments a
                      where a.application_id = d.application_id and a.attempt_no = d.attempt_no and a.cancelled_at is null
                        and a.slot_datetime is not null and a.counsellor_id is not null), 30) as dur
      from public.vsat_counselling_drafts d
      join public.vsat_pipeline vp on vp.application_id = d.application_id and vp.attempt_no = d.attempt_no
     where d.counsellor_id is not null and d.slot_datetime is not null
       and vp.stage in ('pi_cleared', 'counselling_scheduled') and vp.status <> 'not_selected'
       and not exists (select 1 from public.counselling_assignments s
                        where s.application_id = d.application_id and s.attempt_no = d.attempt_no and s.submitted_at is not null)
  ), eff as (
    select m.application_id, m.counsellor_id, m.slot_datetime, m.dur from moving m
    union all
    select a.application_id, a.counsellor_id, a.slot_datetime, a.duration_min
      from public.counselling_assignments a
     where a.cancelled_at is null and a.slot_datetime is not null and a.counsellor_id is not null
       and not exists (select 1 from moving m where m.application_id = a.application_id)
  )
  select e.application_id, e.slot_datetime + make_interval(mins => e.dur)
    from eff e
   where e.counsellor_id = p_iid
     and not (e.application_id = any(coalesce(p_exclude, '{}'::text[])))
     and e.slot_datetime < p_start + make_interval(mins => p_dur)
     and e.slot_datetime + make_interval(mins => e.dur) > p_start
   order by 2 desc, 1
   limit 1
$$;

-- a schedule / move / cancel from anywhere (drawer, panel, bulk) replaces what was typed for that student
create or replace function public.vsat__cs_drafts_clear()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if tg_op = 'INSERT' or new.version is distinct from old.version then
    delete from public.vsat_counselling_drafts d where d.application_id = new.application_id;
  end if;
  return null;
end $$;

drop trigger if exists vsat_counselling_drafts_clear on public.counselling_assignments;
create trigger vsat_counselling_drafts_clear
  after insert or update of version on public.counselling_assignments
  for each row execute function public.vsat__cs_drafts_clear();

-- p: {application_ids (1–100)}. One entry per student the caller may manage (others are left out), in the given order:
--   {application_id, attempt_no, state, problem, clash_with, booked, draft}
--   state: empty | incomplete | ready (new, can be sent) | booked | changed (booked + a new time, can be sent)
--          | problem (typed but can't be sent: see problem) | locked (counselling session done / not at a counselling session stage)
--   problem: ALREADY_COUNSELLED | WRONG_STAGE | SLOT_IN_PAST | NOT_A_COUNSELLOR | CLASH (clash_with = {application_id, name})
create or replace function public.vsat_counselling_plan(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare ids text[]; app text; vp public.vsat_pipeline; cur public.counselling_assignments; d public.vsat_counselling_drafts;
        has_row boolean; live boolean; done boolean; ok_stage boolean; has_draft boolean; dur int; c record;
        st text; prob text; cw jsonb; out jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  if not public.vsat__can_manage(null) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['application_ids']);
  ids := public.vsat__iv_ids(p, 100);

  foreach app in array ids loop
    begin
      vp := public.vsat__iv_managed(app);
    exception when others then
      continue;   -- not in the pipeline / another campus: nothing about it is returned
    end;
    select * into cur from public.counselling_assignments a where a.application_id = app and a.attempt_no = vp.attempt_no;
    has_row := found;
    live := has_row and cur.cancelled_at is null and cur.slot_datetime is not null and cur.counsellor_id is not null;
    done := has_row and cur.submitted_at is not null;
    ok_stage := vp.stage in ('pi_cleared', 'counselling_scheduled') and vp.status <> 'not_selected';
    select * into d from public.vsat_counselling_drafts x where x.application_id = app and x.attempt_no = vp.attempt_no;
    has_draft := found;
    prob := null; cw := null;

    if not has_draft then
      st := case when done or not ok_stage then 'locked' when live then 'booked' else 'empty' end;
    else
      prob := case when done then 'ALREADY_COUNSELLED' when not ok_stage then 'WRONG_STAGE' end;
      if prob is null and (d.counsellor_id is null or d.slot_datetime is null) then
        st := 'incomplete';
      else
        if prob is null and d.slot_datetime < now() then prob := 'SLOT_IN_PAST'; end if;
        if prob is null and not exists (select 1 from public.vsat_team t where t.user_id = d.counsellor_id and t.role = 'counsellor' and t.active) then
          prob := 'NOT_A_COUNSELLOR';
        end if;
        if prob is null then
          dur := case when live then cur.duration_min else 30 end;
          select * into c from public.vsat__cs_eff_busy(d.counsellor_id, d.slot_datetime, dur, array[app]);
          if found then
            prob := 'CLASH';
            -- who it clashes with, only when this person may see that student (else just "another student")
            select case when public.vsat__can_manage(public.vsat__campus_key(am.campus_applied))
                        then jsonb_build_object('application_id', am.application_id, 'name', am.registered_name) end
              into cw from public.application_manager am where am.application_id = c.clash_app;
            cw := coalesce(cw, jsonb_build_object('application_id', null, 'name', null));
          end if;
        end if;
        st := case when prob is not null then 'problem' when live then 'changed' else 'ready' end;
      end if;
    end if;

    out := out || jsonb_build_array(jsonb_build_object(
      'application_id', app, 'attempt_no', vp.attempt_no, 'state', st, 'problem', prob, 'clash_with', cw,
      'booked', case when live then jsonb_build_object('counsellor_id', cur.counsellor_id, 'slot', cur.slot_datetime,
                                                       'duration_min', cur.duration_min, 'meet_mode', cur.meet_mode) end,
      'draft', case when has_draft then jsonb_build_object('counsellor_id', d.counsellor_id, 'slot', d.slot_datetime,
                                                           'updated_at', d.updated_at) end));
  end loop;
  return out;
end $$;

-- p: {application_id, counsellor_id (or null), slot_datetime (or null)} — what the row shows now.
-- Both empty, or the same as the booking → the typed values are cleared. Returns the row's plan entry.
create or replace function public.vsat_counselling_draft_set(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare app text; iid uuid; slot timestamptz; vp public.vsat_pipeline; cur public.counselling_assignments; has_row boolean; live boolean;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['application_id', 'counsellor_id', 'slot_datetime']);
  app := public.vsat__txt(p, 'application_id', 64, true);
  vp := public.vsat__iv_managed(app);   -- role first: an outsider learns nothing from value errors
  begin iid := (public.vsat__txt(p, 'counsellor_id', 40, false))::uuid;
  exception when invalid_text_representation then raise exception 'BAD_VALUE: counsellor_id' using errcode = '22023'; end;
  if p ? 'slot_datetime' and jsonb_typeof(p->'slot_datetime') <> 'null' then
    slot := public.vsat__iv_ts(p, 'slot_datetime');
    if slot < now() - interval '30 days' or slot > now() + interval '366 days' then
      raise exception 'BAD_VALUE: slot_datetime' using errcode = '22023';
    end if;
  end if;
  if iid is not null and not exists (select 1 from public.vsat_team t where t.user_id = iid and t.role = 'counsellor' and t.active) then
    raise exception 'NOT_A_COUNSELLOR' using errcode = '22023';
  end if;

  select * into cur from public.counselling_assignments a where a.application_id = app and a.attempt_no = vp.attempt_no;
  has_row := found;
  live := has_row and cur.cancelled_at is null and cur.slot_datetime is not null and cur.counsellor_id is not null;
  if has_row and cur.submitted_at is not null then raise exception 'ALREADY_COUNSELLED' using errcode = '22023'; end if;
  if vp.stage not in ('pi_cleared', 'counselling_scheduled') or vp.status = 'not_selected' then
    raise exception 'WRONG_STAGE' using errcode = '22023';
  end if;

  if (iid is null and slot is null) or (live and cur.counsellor_id = iid and cur.slot_datetime = slot) then
    delete from public.vsat_counselling_drafts d where d.application_id = app;
  else
    insert into public.vsat_counselling_drafts as d (application_id, attempt_no, counsellor_id, slot_datetime, updated_at, updated_by)
    values (app, vp.attempt_no, iid, slot, now(), auth.uid())
    on conflict (application_id) do update
      set attempt_no = excluded.attempt_no, counsellor_id = excluded.counsellor_id, slot_datetime = excluded.slot_datetime,
          updated_at = now(), updated_by = auth.uid();
  end if;
  return coalesce(public.vsat_counselling_plan(jsonb_build_object('application_ids', jsonb_build_array(app))) -> 0, 'null'::jsonb);
end $$;

-- p: {application_ids (1–40, in row order), counsellor_id, start}. Back-to-back 30-minute times from `start` for
-- the students that are not booked yet; times this counsellor is busy (bookings or other typed rows) are skipped.
-- Only fills the rows: nothing is booked or emailed. Returns {filled: [{application_id, name, slot}], skipped: [{application_id, name, code}]}.
create or replace function public.vsat_counselling_drafts_fill(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare ids text[]; fillable text[] := '{}'; rest text[]; iid uuid; t timestamptz; app text; vp public.vsat_pipeline;
        cur public.counselling_assignments; nm text; c record; tries int; filled jsonb := '[]'::jsonb; skipped jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  if not public.vsat__can_manage(null) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['application_ids', 'counsellor_id', 'start']);
  ids := public.vsat__iv_ids(p, 40);
  begin iid := (public.vsat__txt(p, 'counsellor_id', 40, true))::uuid;
  exception when invalid_text_representation then raise exception 'BAD_VALUE: counsellor_id' using errcode = '22023'; end;
  if not exists (select 1 from public.vsat_team tm where tm.user_id = iid and tm.role = 'counsellor' and tm.active) then
    raise exception 'NOT_A_COUNSELLOR' using errcode = '22023';
  end if;
  t := public.vsat__iv_ts(p, 'start');
  if t < now() then raise exception 'SLOT_IN_PAST' using errcode = '22023'; end if;
  if t > now() + interval '366 days' then raise exception 'BAD_VALUE: start' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended('vsat_counsellor:' || iid::text, 0));

  -- 1) who can be filled (the others are listed with the reason and keep what they have)
  foreach app in array ids loop
    nm := null;
    begin
      vp := public.vsat__iv_managed(app);
      select am.registered_name into nm from public.application_manager am where am.application_id = app;
      if vp.stage not in ('pi_cleared', 'counselling_scheduled') or vp.status = 'not_selected' then raise exception 'WRONG_STAGE'; end if;
      select * into cur from public.counselling_assignments a where a.application_id = app and a.attempt_no = vp.attempt_no;
      if found and cur.submitted_at is not null then raise exception 'ALREADY_COUNSELLED'; end if;
      if found and cur.cancelled_at is null and cur.slot_datetime is not null and cur.counsellor_id is not null then
        raise exception 'ALREADY_SCHEDULED';
      end if;
      fillable := fillable || app;
    exception when others then
      skipped := skipped || jsonb_build_array(jsonb_build_object('application_id', app, 'name', nm, 'code', sqlerrm));
    end;
  end loop;

  -- 2) back to back; the rows being filled don't block each other's old typed times
  rest := fillable;
  foreach app in array fillable loop
    select am.registered_name into nm from public.application_manager am where am.application_id = app;
    tries := 0;
    loop
      select * into c from public.vsat__cs_eff_busy(iid, t, 30, rest);
      exit when not found;
      t := c.busy_until; tries := tries + 1;
      if tries > 200 then exit; end if;
    end loop;
    if tries > 200 then
      skipped := skipped || jsonb_build_array(jsonb_build_object('application_id', app, 'name', nm, 'code', 'NO_FREE_SLOT'));
    else
      insert into public.vsat_counselling_drafts as d (application_id, attempt_no, counsellor_id, slot_datetime, updated_at, updated_by)
      select app, vp2.attempt_no, iid, t, now(), auth.uid() from public.vsat_pipeline vp2 where vp2.application_id = app
      on conflict (application_id) do update
        set attempt_no = excluded.attempt_no, counsellor_id = excluded.counsellor_id, slot_datetime = excluded.slot_datetime,
            updated_at = now(), updated_by = auth.uid();
      filled := filled || jsonb_build_array(jsonb_build_object('application_id', app, 'name', nm, 'slot', t));
      t := t + interval '30 minutes';
    end if;
    rest := array_remove(rest, app);
  end loop;
  return jsonb_build_object('filled', filled, 'skipped', skipped);
end $$;

-- p: {application_ids (1–40)}. Books every listed student from what was typed on the row: new → scheduled (invite),
-- booked → rescheduled ("moved" emails), with the same checks, Google Meet and email jobs as one booking (0140).
-- A row that clashes in the effective plan is not sent. Rows wait for each other: a student moving out of a time
-- frees it for the next one in the same send. Returns {sent: [{application_id, name, kind, slot}], skipped: [{application_id, name, code}]}.
create or replace function public.vsat_counselling_drafts_send(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare ids text[]; pending text[]; nxt text[]; app text; vp public.vsat_pipeline; cur public.counselling_assignments;
        d public.vsat_counselling_drafts; live boolean; dur int; nm text; names jsonb := '{}'::jsonb; c record; r jsonb;
        sent jsonb := '[]'::jsonb; skipped jsonb := '[]'::jsonb; progress boolean; passes int := 0;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  if not public.vsat__can_manage(null) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['application_ids']);
  ids := public.vsat__iv_ids(p, 40);
  pending := ids;

  loop
    passes := passes + 1; progress := false; nxt := '{}';
    foreach app in array pending loop
      nm := null;
      begin
        vp := public.vsat__iv_managed(app);
        select am.registered_name into nm from public.application_manager am where am.application_id = app;
        names := names || jsonb_build_object(app, nm);
        select * into d from public.vsat_counselling_drafts x where x.application_id = app and x.attempt_no = vp.attempt_no;
        if not found or d.counsellor_id is null or d.slot_datetime is null then raise exception 'NO_DRAFT' using errcode = '22023'; end if;
        select * into cur from public.counselling_assignments a where a.application_id = app and a.attempt_no = vp.attempt_no;
        live := found and cur.cancelled_at is null and cur.slot_datetime is not null and cur.counsellor_id is not null;
        dur := case when live then cur.duration_min else 30 end;
        select * into c from public.vsat__cs_eff_busy(d.counsellor_id, d.slot_datetime, dur, array[app]);
        if found then raise exception 'CLASH' using errcode = '23505'; end if;
        -- Google Meet for new ones; a booked one keeps its Meet (or its own link)
        r := public.vsat__cs_schedule(app, d.counsellor_id, d.slot_datetime, dur, null, null, 'bulk', false);
        delete from public.vsat_counselling_drafts x where x.application_id = app;
        sent := sent || jsonb_build_array(jsonb_build_object('application_id', app, 'name', nm, 'kind', r -> 'kind', 'slot', d.slot_datetime));
        progress := true;
      exception when others then
        if sqlerrm = 'SLOT_TAKEN' then
          nxt := nxt || app;   -- maybe a student later in this send is moving out of that time: try again
        else
          skipped := skipped || jsonb_build_array(jsonb_build_object('application_id', app, 'name', nm, 'code', sqlerrm));
        end if;
      end;
    end loop;
    pending := nxt;
    exit when coalesce(array_length(pending, 1), 0) = 0 or not progress or passes >= 40;
  end loop;

  foreach app in array coalesce(pending, '{}'::text[]) loop
    skipped := skipped || jsonb_build_array(jsonb_build_object('application_id', app, 'name', names ->> app, 'code', 'SLOT_TAKEN'));
  end loop;
  return jsonb_build_object('sent', sent, 'skipped', skipped);
end $$;

-- p: {application_id, counsellor_id, slot_datetime, duration_min? (10–180, default 30), meeting_link? (own https link), auto_meet?}
-- Replaces the 0081 version: Google Meet (or own link), length, overlap check, no past slots, history + email jobs.
create or replace function public.vsat_assign_counsellor(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare app text; cid uuid; slot timestamptz; link text;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['application_id', 'counsellor_id', 'slot_datetime', 'meeting_link', 'duration_min', 'auto_meet']);
  app := public.vsat__txt(p, 'application_id', 64, true);
  perform public.vsat__iv_managed(app);   -- role first: an outsider learns nothing from value errors
  begin cid := (public.vsat__txt(p, 'counsellor_id', 40, true))::uuid;
  exception when invalid_text_representation then raise exception 'BAD_VALUE: counsellor_id' using errcode = '22023'; end;
  slot := public.vsat__iv_ts(p, 'slot_datetime');
  link := public.vsat__txt(p, 'meeting_link', 300, false);
  if link is not null and link !~ '^https://[a-z0-9.-]+/' then raise exception 'BAD_VALUE: meeting_link' using errcode = '22023'; end if;
  perform public.vsat__cs_schedule(app, cid, slot, public.vsat__iv_dur(p), link, public.vsat__bool(p, 'auto_meet', false), 'manual', false);
  return public.vsat_student(app);
end $$;

-- The student: own counselling session (current attempt) by auth.uid() only.
-- step: interview (still at the interview) | interviewed (waiting for the result) | pi_cleared (cleared, not booked yet) | counselling
-- state: none | upcoming | open | ended | missed. The link is returned ONLY while open (10 minutes before the start until the end).
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
                 when vp.stage = 'pi_cleared' and vp.status = 'active' then 'pi_cleared'
                 when vp.stage in ('interviewed', 'pi_cleared') then 'interviewed'
                 else 'interview' end;
  if v_step <> 'counselling' then return jsonb_build_object('state', 'none', 'now', now(), 'step', v_step); end if;

  select a.slot_datetime, a.duration_min, a.zoom_link, a.attendance into r
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
                            'meet_link', case when st = 'open' then r.zoom_link end);
end $$;

-- ═════════════ 6. who may run what ═════════════
revoke all on function public.vsat__cs_busy_until(uuid, timestamptz, int, text, int) from public, anon, authenticated;
revoke all on function public.vsat__cs_event(public.counselling_assignments, text, public.counselling_assignments, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.vsat__cs_schedule(text, uuid, timestamptz, int, text, boolean, text, boolean) from public, anon, authenticated;
revoke all on function public.vsat__cs_eff_busy(uuid, timestamptz, int, text[]) from public, anon, authenticated;
revoke all on function public.vsat__cs_drafts_clear() from public, anon, authenticated;

revoke all on function public.vsat_assign_counsellor(jsonb) from public, anon;
revoke all on function public.vsat_cancel_counselling(jsonb) from public, anon;
revoke all on function public.vsat_set_counselling_attendance(jsonb) from public, anon;
revoke all on function public.vsat_counselling_meet_retry(jsonb) from public, anon;
revoke all on function public.vsat_my_counselling() from public, anon;
revoke all on function public.vsat_counselling_plan(jsonb) from public, anon;
revoke all on function public.vsat_counselling_draft_set(jsonb) from public, anon;
revoke all on function public.vsat_counselling_drafts_fill(jsonb) from public, anon;
revoke all on function public.vsat_counselling_drafts_send(jsonb) from public, anon;
grant execute on function public.vsat_assign_counsellor(jsonb) to authenticated;
grant execute on function public.vsat_cancel_counselling(jsonb) to authenticated;
grant execute on function public.vsat_set_counselling_attendance(jsonb) to authenticated;
grant execute on function public.vsat_counselling_meet_retry(jsonb) to authenticated;
grant execute on function public.vsat_my_counselling() to authenticated;
grant execute on function public.vsat_counselling_plan(jsonb) to authenticated;
grant execute on function public.vsat_counselling_draft_set(jsonb) to authenticated;
grant execute on function public.vsat_counselling_drafts_fill(jsonb) to authenticated;
grant execute on function public.vsat_counselling_drafts_send(jsonb) to authenticated;

revoke all on function public.vsat_counselling_sync_claim(jsonb) from public, anon, authenticated;
revoke all on function public.vsat_counselling_sync_release(jsonb) from public, anon, authenticated;
revoke all on function public.vsat_counselling_attendance_due(int) from public, anon, authenticated;
revoke all on function public.vsat_counselling_attendance_apply(jsonb) from public, anon, authenticated;
revoke all on function public.vsat_counselling_notices_claim(jsonb) from public, anon, authenticated;
revoke all on function public.vsat_counselling_notice_done(jsonb) from public, anon, authenticated;
grant execute on function public.vsat_counselling_sync_claim(jsonb) to service_role;
grant execute on function public.vsat_counselling_sync_release(jsonb) to service_role;
grant execute on function public.vsat_counselling_attendance_due(int) to service_role;
grant execute on function public.vsat_counselling_attendance_apply(jsonb) to service_role;
grant execute on function public.vsat_counselling_notices_claim(jsonb) to service_role;
grant execute on function public.vsat_counselling_notice_done(jsonb) to service_role;
