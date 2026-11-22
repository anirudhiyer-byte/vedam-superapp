-- 0140 · VSAT Phase 2 — interview scheduling with Google Meet (staging first).
--
-- Decisions (owner, 22 Nov 2026):
--   * Meet events come from a SEPARATE admissions Google account (server env ADMISSIONS_*), not PeerPath's.
--   * The admin picks the slot by hand; 30 minutes by default. Bulk = back-to-back slots for one
--     interviewer from a start time (times the interviewer is already busy are skipped), previewed first.
--   * The student's Join button works from 10 minutes before the start until the end: the database
--     hands the Meet link to the student only inside that window.
--   * Attendance is read from Meet after the slot. Nobody / only one person joined → no-show (the student
--     is marked absent); a very short call or no Meet record → left for an admin to mark. Admins can change it.
--   * Emails go through the VSAT comms steps: 6 new steps (student + interviewer × invite / moved / cancelled),
--     all OFF and in test mode until an admin turns them on in VSAT comms.
--
-- What this adds
--   interview_assignments   + duration, Meet mode (auto = Google | manual = own link), Google sync state,
--                             version, cancel info, attendance source / detail; one row per student + attempt
--   vsat_interview_events   history of every schedule / move / cancel / attendance change, and the outbox the
--                             server reads to send the emails (each event is emailed at most once)
--   vsat_comm_steps         + 6 interview steps
--   RPCs (signed-in staff; every check is inside):
--     vsat_assign_interview(p)          replaced: + duration_min, auto_meet; overlap check per interviewer;
--                                        no past slots; history + email event; Google sync queued
--     vsat_schedule_interviews_bulk(p)  admin / admissions: many students, one interviewer, back-to-back (dry_run = preview)
--     vsat_cancel_interview(p)          admin / admissions: removes the slot and the Meet; student back to VSAT cleared
--     vsat_set_interview_attendance(p)  admin / admissions (any change, reason when changing a mark) or the interviewer (first mark)
--     vsat_interview_meet_retry(p)      admin / admissions: try creating the Meet again after it failed
--     vsat_my_interview()               the student: own interview time; the Meet link only inside the join window
--   Server only (service_role — the cron and the sync route):
--     vsat_interview_sync_claim(p), vsat_interview_sync_release(p)      Google Calendar / Meet work
--     vsat_interview_attendance_due(p_limit), vsat_interview_attendance_apply(p)
--     vsat_interview_notices_claim(p), vsat_interview_notice_done(p)
--   Grid: interviewer dropdown (filter + counts) and an "Interview Meet" column (vsat__grid, vsat__grid_catalog).
--
-- Existing interviews (221 rows on staging, all with a hand-pasted meet.google.com link) become meet_mode
-- 'manual': no Google event and no email is ever made for them unless someone reschedules them.
--
-- Rollback: supabase/rollback/0140_vsat_interview_scheduling_down.sql
-- Tests:    supabase/tests/vsat_interview_scheduling.test.sql

-- ═════════════ 1. interview_assignments: new columns ═════════════
alter table public.interview_assignments
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

alter table public.interview_assignments
  add constraint interview_assignments_duration_check   check (duration_min between 10 and 180),
  add constraint interview_assignments_meet_mode_check  check (meet_mode in ('auto', 'manual')),
  add constraint interview_assignments_meet_sync_check  check (meet_sync in ('none', 'pending', 'syncing', 'ok', 'failed')),
  add constraint interview_assignments_att_source_check check (attendance_source in ('auto', 'manual'));

-- the save logic keeps ONE row per student + attempt (staging has no duplicates); make the database say so
create unique index if not exists interview_assignments_app_attempt_key on public.interview_assignments (application_id, attempt_no);
-- the cron's work lists
create index if not exists interview_assignments_meet_todo_idx on public.interview_assignments (meet_sync) where meet_sync in ('pending', 'syncing', 'failed');

comment on column public.interview_assignments.meet_mode is 'auto = Google Calendar event + Meet from the admissions account; manual = a link pasted by staff (no Google event).';
comment on column public.interview_assignments.meet_sync is 'Google work state: none (nothing to do) | pending (queued) | syncing (a server run holds it) | ok | failed (retried by the cron up to 5 times).';
comment on column public.interview_assignments.event_gen is 'Bumped each time the Google event is deleted, so a new event never reuses a deleted event id.';
comment on column public.interview_assignments.meet_event_version is 'The version the Google event matches. Equal to version → a run only reads the Meet link; it does not move the event again.';
comment on column public.interview_assignments.version is 'Bumped on every schedule / move / cancel. Events and attendance checks carry it, so stale work is ignored.';

-- existing interviews were all given a hand-pasted link: keep them as they are
update public.interview_assignments set meet_mode = 'manual' where meet_link is not null and meet_mode = 'auto';

-- ═════════════ 2. history + email outbox ═════════════
create table if not exists public.vsat_interview_events (
  id                  uuid primary key default gen_random_uuid(),
  assignment_id       uuid not null references public.interview_assignments(id) on delete cascade,
  application_id      text not null,
  attempt_no          int not null,
  kind                text not null check (kind in ('scheduled', 'rescheduled', 'cancelled', 'attendance')),
  version             int not null,
  -- after the change
  slot_start          timestamptz,
  duration_min        int,
  interviewer_id      uuid,
  meet_mode           text,
  -- before the change
  prev_slot_start     timestamptz,
  prev_duration_min   int,
  prev_interviewer_id uuid,
  detail              jsonb,
  source              text not null check (source in ('manual', 'bulk', 'auto')),
  actor_id            uuid,
  created_at          timestamptz not null default now(),
  -- email outbox (schedule / move / cancel only)
  notify_status       text not null default 'none' check (notify_status in ('none', 'pending', 'sending', 'sent', 'skipped', 'failed')),
  notify_attempts     int not null default 0,
  notify_claimed_at   timestamptz,
  notify_detail       jsonb,
  notified_at         timestamptz
);
create index if not exists vsat_interview_events_assignment_idx on public.vsat_interview_events (assignment_id, created_at);
create index if not exists vsat_interview_events_outbox_idx on public.vsat_interview_events (created_at) where notify_status in ('pending', 'sending');
alter table public.vsat_interview_events enable row level security;
revoke all on table public.vsat_interview_events from public, anon, authenticated;
grant select on table public.vsat_interview_events to service_role;
comment on table public.vsat_interview_events is
  'VSAT interviews: one row per schedule / move / cancel / attendance change (who, when, before → after). Also the email outbox: the server claims pending rows through vsat_interview_notices_claim. Browsers never read it directly.';

-- ═════════════ 3. VSAT comms: interview steps (off + test mode) ═════════════
alter table public.vsat_comm_steps drop constraint if exists vsat_comm_steps_step_key_check;
alter table public.vsat_comm_steps add constraint vsat_comm_steps_step_key_check check (step_key in (
  'first_half', 'application_started', 'payment_reminder_24h', 'payment_confirmed',
  'interview_invite', 'interview_rescheduled', 'interview_cancelled',
  'interviewer_invite', 'interviewer_rescheduled', 'interviewer_cancelled'));

insert into public.vsat_comm_steps (step_key, title, sort, wa_enabled, email_subject, email_body) values
  ('interview_invite', 'Interview scheduled → student', 5, false,
   'Your Vedam interview: {{date}}, {{time}}',
   '<p>Hi {{name}},</p><p>Your Vedam admissions interview is scheduled.</p><p><b>When:</b> {{date}}, {{time}}<br><b>Where:</b> Google Meet</p><p><a href="{{join_link}}">Join the interview →</a></p><p>You can also join from your <a href="{{dashboard_link}}">dashboard</a>. The Join button opens 10 minutes before the start. Please join on time from a quiet place, with your camera and microphone working.</p><p>All the best,<br>Team Vedam</p>'),
  ('interview_rescheduled', 'Interview moved → student', 6, false,
   'Your Vedam interview has moved: {{date}}, {{time}}',
   '<p>Hi {{name}},</p><p>Your Vedam admissions interview has a new time.</p><p><b>New time:</b> {{date}}, {{time}}<br><b>Earlier time:</b> {{old_date}}, {{old_time}}<br><b>Where:</b> Google Meet</p><p><a href="{{join_link}}">Join the interview →</a></p><p>You can also join from your <a href="{{dashboard_link}}">dashboard</a>. The Join button opens 10 minutes before the start.</p><p>All the best,<br>Team Vedam</p>'),
  ('interview_cancelled', 'Interview cancelled → student', 7, false,
   'Your Vedam interview on {{old_date}} is cancelled',
   '<p>Hi {{name}},</p><p>Your Vedam admissions interview on {{old_date}}, {{old_time}} has been cancelled. The admissions team will share a new time with you soon.</p><p>You can check your <a href="{{dashboard_link}}">dashboard</a> for updates.</p><p>Warmly,<br>Team Vedam</p>'),
  ('interviewer_invite', 'Interview assigned → interviewer', 8, false,
   'Interview assigned: {{student_name}}, {{date}}, {{time}}',
   '<p>Hi {{name}},</p><p>You have a VSAT interview with <b>{{student_name}}</b> ({{application_no}}).</p><p><b>When:</b> {{date}}, {{time}}<br><b>Meet:</b> <a href="{{join_link}}">{{join_link}}</a></p><p>The student''s details and the interview form are in the <a href="{{panel_link}}">Interview panel</a>.</p><p>Thanks,<br>Vedam Admissions</p>'),
  ('interviewer_rescheduled', 'Interview moved → interviewer', 9, false,
   'Interview moved: {{student_name}}, {{date}}, {{time}}',
   '<p>Hi {{name}},</p><p>Your VSAT interview with <b>{{student_name}}</b> ({{application_no}}) has a new time.</p><p><b>New time:</b> {{date}}, {{time}}<br><b>Earlier time:</b> {{old_date}}, {{old_time}}<br><b>Meet:</b> <a href="{{join_link}}">{{join_link}}</a></p><p>Thanks,<br>Vedam Admissions</p>'),
  ('interviewer_cancelled', 'Interview cancelled → interviewer', 10, false,
   'Interview cancelled: {{student_name}}, {{old_date}}',
   '<p>Hi {{name}},</p><p>Your VSAT interview with <b>{{student_name}}</b> ({{application_no}}) on {{old_date}}, {{old_time}} is no longer on your schedule.</p><p>Thanks,<br>Vedam Admissions</p>')
on conflict (step_key) do nothing;

-- ═════════════ 4. private helpers ═════════════

-- strict ISO 8601 with a timezone (Postgres would also accept words like 'tomorrow')
create or replace function public.vsat__iv_ts(p jsonb, k text)
returns timestamptz language plpgsql stable set search_path to '' as $$
declare s text; v timestamptz;
begin
  s := public.vsat__txt(p, k, 40, true);
  if s !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$' then
    raise exception 'BAD_VALUE: %', k using errcode = '22023';
  end if;
  begin v := s::timestamptz; exception when others then raise exception 'BAD_VALUE: %', k using errcode = '22023'; end;
  return v;
end $$;

-- interview length in whole minutes, 10–180; 30 when not given
create or replace function public.vsat__iv_dur(p jsonb)
returns int language plpgsql immutable set search_path to '' as $$
declare v numeric;
begin
  v := public.vsat__num(p, 'duration_min', 10, 180, false);
  if v is null then return 30; end if;
  if v <> trunc(v) then raise exception 'BAD_VALUE: duration_min' using errcode = '22023'; end if;
  return v::int;
end $$;

-- end of the interviewer's latest booking that overlaps [p_start, p_start + p_dur), or null when free
create or replace function public.vsat__iv_busy_until(p_iid uuid, p_start timestamptz, p_dur int, p_app text, p_attempt int)
returns timestamptz language sql stable security definer set search_path to '' as $$
  select max(a.slot_datetime + make_interval(mins => a.duration_min))
    from public.interview_assignments a
   where a.interviewer_id = p_iid and a.slot_datetime is not null and a.cancelled_at is null
     and not (a.application_id = p_app and a.attempt_no = p_attempt)
     and a.slot_datetime < p_start + make_interval(mins => p_dur)
     and a.slot_datetime + make_interval(mins => a.duration_min) > p_start
$$;

-- one history row (and, for schedule / move / cancel, one pending email job)
create or replace function public.vsat__iv_event(p_now public.interview_assignments, p_kind text, p_before public.interview_assignments,
                                                 p_detail jsonb, p_source text, p_actor uuid)
returns uuid language plpgsql security definer set search_path to '' as $$
declare v_id uuid;
begin
  insert into public.vsat_interview_events (assignment_id, application_id, attempt_no, kind, version, slot_start, duration_min, interviewer_id,
                                            meet_mode, prev_slot_start, prev_duration_min, prev_interviewer_id, detail, source, actor_id, notify_status)
  values (p_now.id, p_now.application_id, p_now.attempt_no, p_kind, p_now.version, p_now.slot_datetime, p_now.duration_min, p_now.interviewer_id,
          p_now.meet_mode, p_before.slot_datetime, p_before.duration_min, p_before.interviewer_id, p_detail, p_source, p_actor,
          case when p_kind in ('scheduled', 'rescheduled', 'cancelled') then 'pending' else 'none' end)
  returning id into v_id;
  return v_id;
end $$;

-- the pipeline row of a student the caller may manage (raises NOT_IN_PIPELINE / FORBIDDEN otherwise)
create or replace function public.vsat__iv_managed(p_app text)
returns public.vsat_pipeline language plpgsql stable security definer set search_path to '' as $$
declare vp public.vsat_pipeline; v_campus text;
begin
  select * into vp from public.vsat_pipeline where application_id = p_app;
  if not found then
    if public.vsat__can_manage(null) then raise exception 'NOT_IN_PIPELINE' using errcode = 'P0002'; end if;
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select public.vsat__campus_key(am.campus_applied) into v_campus from public.application_manager am where am.application_id = p_app;
  if not public.vsat__can_manage(v_campus) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return vp;
end $$;

-- schedule or move one interview (role already checked by the caller through vsat__iv_managed).
-- p_link = own link (manual); p_auto true = Google Meet; neither = keep what a live interview had (new ones: Google).
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

-- ═════════════ 5. staff RPCs ═════════════

-- p: {application_id, interviewer_id, slot_datetime, duration_min? (10–180, default 30), meet_link? (own https link), auto_meet?}
create or replace function public.vsat_assign_interview(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare app text; iid uuid; slot timestamptz; link text;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['application_id', 'interviewer_id', 'slot_datetime', 'meet_link', 'duration_min', 'auto_meet']);
  app := public.vsat__txt(p, 'application_id', 64, true);
  perform public.vsat__iv_managed(app);   -- role first: an outsider learns nothing from value errors
  begin iid := (public.vsat__txt(p, 'interviewer_id', 40, true))::uuid;
  exception when invalid_text_representation then raise exception 'BAD_VALUE: interviewer_id' using errcode = '22023'; end;
  slot := public.vsat__iv_ts(p, 'slot_datetime');
  link := public.vsat__txt(p, 'meet_link', 300, false);
  if link is not null and link !~ '^https://[a-z0-9.-]+/' then raise exception 'BAD_VALUE: meet_link' using errcode = '22023'; end if;
  perform public.vsat__iv_schedule(app, iid, slot, public.vsat__iv_dur(p), link, public.vsat__bool(p, 'auto_meet', false), 'manual', false);
  return public.vsat_student(app);
end $$;

-- Many students, one interviewer, back-to-back from `start` (busy times skipped), Google Meet for each.
-- p: {application_ids (1–40, in the order to schedule), interviewer_id, start, duration_min?, dry_run?}
-- dry_run = the plan only (nothing saved). Each student is checked on its own; skipped ones are listed with the reason.
create or replace function public.vsat_schedule_interviews_bulk(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare ids text[]; iid uuid; t0 timestamptz; dur int; dry boolean; app text; t timestamptz; busy timestamptz; vp public.vsat_pipeline;
        cur public.interview_assignments; nm text; tries int; done jsonb := '[]'::jsonb; skipped jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  if not public.vsat__can_manage(null) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['application_ids', 'interviewer_id', 'start', 'duration_min', 'dry_run']);
  if jsonb_typeof(p->'application_ids') is distinct from 'array' then raise exception 'BAD_VALUE: application_ids' using errcode = '22023'; end if;
  select array_agg(d.x order by d.o) into ids
    from (select e.x, min(e.o) o from jsonb_array_elements_text(p->'application_ids') with ordinality e(x, o)
           where char_length(e.x) between 1 and 64 group by e.x) d;
  if ids is null or array_length(ids, 1) > 40 then raise exception 'BAD_VALUE: application_ids' using errcode = '22023'; end if;
  begin iid := (public.vsat__txt(p, 'interviewer_id', 40, true))::uuid;
  exception when invalid_text_representation then raise exception 'BAD_VALUE: interviewer_id' using errcode = '22023'; end;
  if not exists (select 1 from public.vsat_team tm where tm.user_id = iid and tm.role = 'interviewer' and tm.active) then
    raise exception 'NOT_AN_INTERVIEWER' using errcode = '22023';
  end if;
  t0 := public.vsat__iv_ts(p, 'start');
  if t0 < now() then raise exception 'SLOT_IN_PAST' using errcode = '22023'; end if;
  dur := public.vsat__iv_dur(p);
  dry := coalesce(public.vsat__bool(p, 'dry_run', false), false);

  perform pg_advisory_xact_lock(hashtextextended('vsat_interviewer:' || iid::text, 0));
  t := t0;
  foreach app in array ids loop
    nm := null;
    begin
      vp := public.vsat__iv_managed(app);
      select am.registered_name into nm from public.application_manager am where am.application_id = app;
      -- the same checks the save makes, so the preview already shows who will be skipped
      if vp.stage not in ('vsat_cleared', 'interview_scheduled') or vp.status = 'not_selected' then raise exception 'WRONG_STAGE'; end if;
      select * into cur from public.interview_assignments a where a.application_id = app and a.attempt_no = vp.attempt_no;
      if found and cur.submitted_at is not null then raise exception 'ALREADY_INTERVIEWED'; end if;
      if found and cur.cancelled_at is null and cur.slot_datetime is not null and cur.interviewer_id is not null then
        raise exception 'ALREADY_SCHEDULED';
      end if;
      -- next time this interviewer is free
      tries := 0;
      loop
        busy := public.vsat__iv_busy_until(iid, t, dur, app, vp.attempt_no);
        exit when busy is null;
        t := busy; tries := tries + 1;
        if tries > 200 then raise exception 'NO_FREE_SLOT'; end if;
      end loop;
      if not dry then
        perform public.vsat__iv_schedule(app, iid, t, dur, null, true, 'bulk', true);
      end if;
      done := done || jsonb_build_array(jsonb_build_object('application_id', app, 'name', nm, 'slot', t));
      t := t + make_interval(mins => dur);
    exception when others then
      skipped := skipped || jsonb_build_array(jsonb_build_object('application_id', app, 'name', nm, 'code', sqlerrm));
    end;
  end loop;
  return jsonb_build_object('dry_run', dry, 'interviewer_id', iid, 'duration_min', dur, 'start', t0,
                            'scheduled', done, 'skipped', skipped,
                            'ends_at', case when jsonb_array_length(done) > 0
                                               then (done -> (jsonb_array_length(done) - 1) ->> 'slot')::timestamptz + make_interval(mins => dur) end);
end $$;

-- p: {application_id, reason}. Removes the slot (and the Google event), student back to VSAT cleared.
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

-- p: {application_id, attendance: 'done' | 'no_show', reason?}
-- Admin / admissions: any change (reason needed when changing an earlier mark). The assigned interviewer: the first mark only.
-- no_show → the student is marked absent; done after absent → back to active (admins, with a reason).
create or replace function public.vsat_set_interview_attendance(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
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
  if cur.submitted_at is not null or vp.stage <> 'interview_scheduled' then raise exception 'WRONG_STAGE' using errcode = '22023'; end if;
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
    perform public.vsat__move_checked(app, 'interview_scheduled', 'absent', coalesce(reason, 'Did not join the interview'), 'interview_scheduled', 'manual');
  elsif v = 'done' and vp.status = 'absent' then
    perform public.vsat__move_checked(app, 'interview_scheduled', 'active', reason, 'interview_scheduled', 'manual');
  end if;
  return public.vsat_student(app);
end $$;

-- p: {application_id}. Google failed for good (5 tries) → queue it again.
create or replace function public.vsat_interview_meet_retry(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare app text; vp public.vsat_pipeline; n int;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['application_id']);
  app := public.vsat__txt(p, 'application_id', 64, true);
  vp := public.vsat__iv_managed(app);
  update public.interview_assignments a
     set meet_sync = 'pending', meet_attempts = 0, meet_error = null, meet_claimed_at = null
   where a.application_id = app and a.attempt_no = vp.attempt_no and a.meet_sync = 'failed'
     and (a.meet_mode = 'auto' or a.calendar_event_id is not null);
  get diagnostics n = row_count;
  if n = 0 then raise exception 'NOTHING_TO_RETRY' using errcode = '22023'; end if;
  return public.vsat_student(app);
end $$;

-- ═════════════ 6. the student ═════════════
-- Own interview (current attempt) by auth.uid() only. state: none | upcoming | open | ended | missed.
-- The Meet link is returned ONLY while open: from 10 minutes before the start until the end.
create or replace function public.vsat_my_interview()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare uid uuid := auth.uid(); r record; t_open timestamptz; t_end timestamptz; st text;
begin
  if uid is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  select a.slot_datetime, a.duration_min, a.meet_link, a.attendance, vp.status into r
    from public.application_manager am
    join public.vsat_pipeline vp on vp.application_id = am.application_id
    join public.interview_assignments a on a.application_id = vp.application_id and a.attempt_no = vp.attempt_no
   where am.lead_id = uid and vp.stage = 'interview_scheduled' and a.cancelled_at is null and a.slot_datetime is not null
   order by a.slot_datetime desc
   limit 1;
  if not found then return jsonb_build_object('state', 'none', 'now', now()); end if;
  t_open := r.slot_datetime - interval '10 minutes';
  t_end  := r.slot_datetime + make_interval(mins => r.duration_min);
  st := case when r.status = 'absent' or r.attendance = 'no_show' then 'missed'
             when now() < t_open then 'upcoming'
             when now() < t_end then 'open'
             else 'ended' end;
  return jsonb_build_object('state', st, 'now', now(), 'start', r.slot_datetime, 'end', t_end, 'opens_at', t_open,
                            'duration_min', r.duration_min, 'has_link', r.meet_link is not null,
                            'meet_link', case when st = 'open' then r.meet_link end);
end $$;

-- ═════════════ 7. server only (service_role) ═════════════

-- Google work: claim up to `limit` interviews whose event must be made, moved or removed. p: {limit? (1–50), application_ids?}
-- A claim is held for 3 minutes; the token (claimed_at) must come back with the result.
create or replace function public.vsat_interview_sync_claim(p jsonb)
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
      from public.interview_assignments a
     where (a.meet_sync = 'pending' or (a.meet_sync = 'failed' and a.meet_attempts < 5)
            or (a.meet_sync = 'syncing' and a.meet_claimed_at < now() - interval '3 minutes'))
       and (ids is null or a.application_id = any(ids))
     order by a.slot_datetime nulls first
     limit lim
       for update of a skip locked
  ), upd as (
    update public.interview_assignments a
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
             'interviewer', case when a.interviewer_id is not null then
                              jsonb_build_object('id', a.interviewer_id, 'name', coalesce(ip.full_name, ip.email), 'email', ip.email) end)
             order by a.slot_datetime nulls first)
      from public.interview_assignments a
      join public.application_manager am on am.application_id = a.application_id
      left join public.profiles ip on ip.id = a.interviewer_id
     where a.id = any(claimed)), '[]'::jsonb);
end $$;

-- Google work: the result of one claim.
-- p: {id, version, claimed_at, outcome: ok | pending (Meet link not ready yet) | failed | none (no event wanted),
--     final? (failed: stop retrying), error?, calendar_event_id?, meet_link?, meet_code?, event_gen?, deleted_event_id?}
-- What happened on Google (an event made or deleted) is recorded even if the interview changed meanwhile, so no
-- event is ever lost track of; the state itself is written only while this run still holds the claim.
create or replace function public.vsat_interview_sync_release(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_id uuid; ver int; v_claimed timestamptz; outc text; ev text; del text; link text; code text; gen int; err text; fin boolean;
        cur public.interview_assignments;
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

  select * into cur from public.interview_assignments a where a.id = v_id for update;
  if not found then return jsonb_build_object('applied', false); end if;

  if del is not null and cur.calendar_event_id = del then
    update public.interview_assignments a
       set calendar_event_id = null, meet_code = null, meet_event_version = null, event_gen = a.event_gen + 1,
           meet_link = case when a.meet_mode = 'auto' then null else a.meet_link end
     where a.id = v_id
    returning * into cur;
  end if;
  if ev is not null and cur.calendar_event_id is null then
    update public.interview_assignments a
       set calendar_event_id = ev, event_gen = greatest(a.event_gen, coalesce(gen, a.event_gen))
     where a.id = v_id
    returning * into cur;
  end if;

  if not (cur.meet_sync = 'syncing' and cur.version = ver and cur.meet_claimed_at = v_claimed) then
    return jsonb_build_object('applied', false);
  end if;
  update public.interview_assignments a
     set meet_claimed_at = null,
         meet_sync = outc,
         meet_error = case when outc = 'failed' then coalesce(err, 'failed') end,
         meet_attempts = case when outc in ('ok', 'none') then 0 when outc = 'failed' and fin then greatest(a.meet_attempts, 5) else a.meet_attempts end,
         meet_link = case when outc in ('ok', 'pending') and link is not null and a.meet_mode = 'auto' and a.cancelled_at is null then link else a.meet_link end,
         meet_code = case when outc in ('ok', 'pending') and code is not null then code else a.meet_code end,
         meet_event_version = case when outc in ('ok', 'pending') and a.calendar_event_id is not null then ver else a.meet_event_version end,
         meet_synced_at = case when outc in ('ok', 'none') then now() else a.meet_synced_at end
   where a.id = v_id;
  return jsonb_build_object('applied', true);
end $$;

-- Google interviews that ended at least 10 minutes ago and still have no attendance (last 3 days, 12 tries max)
create or replace function public.vsat_interview_attendance_due(p_limit int)
returns jsonb language sql stable security definer set search_path to '' as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.slot_datetime), '[]'::jsonb)
    from (select a.id, a.version, a.application_id, a.slot_datetime, a.duration_min, a.meet_code, a.attendance_check_attempts
            from public.interview_assignments a
            join public.vsat_pipeline vp on vp.application_id = a.application_id and vp.attempt_no = a.attempt_no
           where a.meet_mode = 'auto' and a.meet_sync = 'ok' and a.meet_code is not null and a.cancelled_at is null
             and a.slot_datetime is not null and a.attendance = 'scheduled' and a.attendance_source is null
             and a.attendance_checked_at is null and a.submitted_at is null and vp.stage = 'interview_scheduled'
             and a.slot_datetime + make_interval(mins => a.duration_min + 10) < now()
             and a.slot_datetime > now() - interval '3 days'
             and a.attendance_check_attempts < 12
           order by a.slot_datetime
           limit least(greatest(coalesce(p_limit, 20), 1), 50)) x
$$;

-- p: {id, version, result: done | no_show | needs_marking | retry, detail?: {people, overlap_min, records, reason}}
-- Applies only if nothing changed meanwhile (same version, still unmarked). no_show → the student is marked absent.
create or replace function public.vsat_interview_attendance_apply(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_id uuid; ver int; res text; det jsonb; d jsonb; cur public.interview_assignments; nxt public.interview_assignments; vp public.vsat_pipeline;
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
    -- attendance stays 'scheduled'; the drawer shows why and asks an admin to mark it
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
      perform public.vsat__move(cur.application_id, 'interview_scheduled', 'absent',
        'Did not join the Google Meet (checked automatically)', 'auto', null, 'interview_scheduled');
    end if;
  end if;
  return jsonb_build_object('applied', true);
end $$;

-- Email outbox: claim the jobs to send now. p: {limit? (1–100), wait_for_meet? (default true), application_ids?}
-- Only the newest job per interview (highest version) is sent (older pending ones are skipped as superseded); a job for an interview
-- whose Google Meet is still being made waits up to 20 minutes so the email can carry the link; jobs for a time
-- that has already passed are skipped. `baseline` = what the people were last emailed (to pick invite vs moved).
create or replace function public.vsat_interview_notices_claim(p jsonb)
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

  update public.vsat_interview_events ev
     set notify_status = 'skipped', notify_detail = jsonb_build_object('why', 'superseded'), notified_at = now(), notify_claimed_at = null
   where ev.notify_status in ('pending', 'failed')
     and exists (select 1 from public.vsat_interview_events n
                  where n.assignment_id = ev.assignment_id and n.kind in ('scheduled', 'rescheduled', 'cancelled') and n.version > ev.version);
  update public.vsat_interview_events ev
     set notify_status = 'skipped', notify_detail = jsonb_build_object('why', 'time_passed'), notified_at = now(), notify_claimed_at = null
   where ev.notify_status = 'pending'
     and ((ev.kind <> 'cancelled' and ev.slot_start + make_interval(mins => ev.duration_min) < now())
       or (ev.kind = 'cancelled' and ev.prev_slot_start + make_interval(mins => coalesce(ev.prev_duration_min, 30)) < now()));

  with cand as (
    select ev.id
      from public.vsat_interview_events ev
     where (ev.notify_status = 'pending' or (ev.notify_status = 'sending' and ev.notify_claimed_at < now() - interval '10 minutes'))
       and ev.notify_attempts < 5
       and (ids is null or ev.application_id = any(ids))
       and not (v_wait and ev.kind <> 'cancelled' and ev.created_at > now() - interval '20 minutes'
                and exists (select 1 from public.interview_assignments a
                             where a.id = ev.assignment_id and a.version = ev.version and a.meet_mode = 'auto' and a.meet_sync in ('pending', 'syncing')))
     order by ev.created_at
     limit lim
       for update of ev skip locked
  ), upd as (
    update public.vsat_interview_events ev
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
             'interviewer', case when ev.interviewer_id is not null then
                              jsonb_build_object('id', ev.interviewer_id, 'name', coalesce(ip.full_name, ip.email), 'email', ip.email) end,
             'baseline', (select jsonb_build_object('kind', b.kind, 'slot_start', b.slot_start, 'duration_min', b.duration_min,
                                   'interviewer', case when b.interviewer_id is not null then
                                                    jsonb_build_object('id', b.interviewer_id, 'name', coalesce(bp.full_name, bp.email), 'email', bp.email) end)
                            from public.vsat_interview_events b left join public.profiles bp on bp.id = b.interviewer_id
                           where b.assignment_id = ev.assignment_id and b.notify_status = 'sent' and b.version < ev.version
                           order by b.version desc limit 1),
             'student', jsonb_build_object('name', am.registered_name, 'email', am.registered_email,
                                           'application_no', coalesce(am.application_no::text, am.application_id), 'lead_id', am.lead_id),
             'meet_link', case when a.version = ev.version then a.meet_link end,
             'meet_mode', ev.meet_mode) order by ev.created_at)
      from public.vsat_interview_events ev
      join public.interview_assignments a on a.id = ev.assignment_id
      join public.application_manager am on am.application_id = ev.application_id
      left join public.profiles ip on ip.id = ev.interviewer_id
     where ev.id = any(claimed)), '[]'::jsonb);
end $$;

-- p: {id, status: sent | skipped | failed, detail?: {sent_to: [...], ...}}. failed → retried (5 tries in all).
create or replace function public.vsat_interview_notice_done(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_id uuid; st text; d jsonb; n int;
begin
  perform public.vsat__check_keys(p, array['id', 'status', 'detail']);
  begin v_id := (public.vsat__txt(p, 'id', 40, true))::uuid;
  exception when invalid_text_representation then raise exception 'BAD_VALUE: id' using errcode = '22023'; end;
  st := public.vsat__txt(p, 'status', 10, true);
  if st not in ('sent', 'skipped', 'failed') then raise exception 'BAD_VALUE: status' using errcode = '22023'; end if;
  d := case when jsonb_typeof(p->'detail') = 'object' and pg_column_size(p->'detail') < 4000 then p->'detail' else null end;
  update public.vsat_interview_events ev
     set notify_status = case when st = 'failed' and ev.notify_attempts < 5 then 'pending' else st end,
         notify_detail = d, notify_claimed_at = null,
         notified_at = case when st = 'failed' and ev.notify_attempts < 5 then null else now() end
   where ev.id = v_id and ev.notify_status = 'sending';
  get diagnostics n = row_count;
  return jsonb_build_object('updated', n = 1);
end $$;

-- ═════════════ 8. grid: interviewer dropdown + "Interview Meet" column ═════════════
-- Same as 0139 (catalogue) and 0135 (grid) plus: catalogue row interview_meet; request key interviewer_ids
-- (user ids or 'none'); an interviewer count per dropdown option (facets.interviewer + interviewer_name); every
-- other count also honours the interviewer choice; the row value interview_meet (ready | creating | failed | own_link | cancelled).
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
      ('counselling_pct',            'Counselling', 'num',    34), ('counselling_calculated_pct', 'Counselling', 'num', 35)
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
  v_form text[]; v_pay text[]; v_ivs text[];
  f_ids text[]; has_filters boolean := false; fl jsonb; fcol text; fop text; ftyp text; fwhere text := ''; frag text; fsym text; farr text[]; fcat record; fsql text;
  fexpr text;
  v_limit int; v_offset int; k text; s text;
  s_col text; s_vals text[]; s_pat text[]; s_dig text[]; s_ids text[]; s_any boolean := false; s_cat record;
  need_eff boolean; total int; rows jsonb; facets jsonb;
begin
  if uid is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(coalesce(p, '{}'::jsonb),
    array['scope', 'stages', 'statuses', 'exam_date_ids', 'campuses', 'form_stages', 'payment_stages', 'interviewer_ids', 'filters', 'search', 'columns', 'application_ids', 'limit', 'offset']);
  foreach k in array array['scope', 'stages', 'statuses', 'exam_date_ids', 'campuses', 'form_stages', 'payment_stages', 'interviewer_ids', 'filters', 'columns', 'application_ids'] loop
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
                      order by a.created_at desc limit 1), 'none') iv_id
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
       and (v_ivs is null or vis.iv_id = any(v_ivs))
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
           ca.who ca_who, ca.slot_datetime ca_slot, ca.attendance ca_att, ca.scholarship_category ca_cat, ca.scholarship_pct ca_pct, ca.calculated_pct ca_calc
      from page pg
      join public.application_manager am on am.application_id = pg.application_id
      left join public.vsat_exam_dates d on d.id = am.exam_date_id
      left join public.vsat_proctoring pr on pr.application_id = pg.application_id and pr.attempt_no = pg.attempt_no
      left join lateral (select ia.slot_datetime, ia.attendance, ia.weighted_avg, ia.calc_verdict, ia.result, ia.interviewer_verdict, ia.cheating_seen,
                                ia.cancelled_at, ia.meet_mode, ia.meet_sync, coalesce(ip.full_name, ip.email) who
                           from public.interview_assignments ia left join public.profiles ip on ip.id = ia.interviewer_id
                          where ia.application_id = pg.application_id and ia.attempt_no = pg.attempt_no order by ia.created_at desc limit 1) ia on true
      left join lateral (select ca.slot_datetime, ca.attendance, ca.scholarship_category, ca.scholarship_pct, ca.calculated_pct,
                                coalesce(cp.full_name, cp.email) who
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
             'counselling_category', pj.ca_cat, 'counselling_pct', pj.ca_pct, 'counselling_calculated_pct', pj.ca_calc) v
      from pagej pj
  )
  select (select count(*) from base),
         case when p_facets then jsonb_build_object(
           'stage',  (select coalesce(jsonb_object_agg(x.stage, x.n), '{}'::jsonb) from (
                        select vis.stage, count(*) n from vis
                         where (v_statuses is null or vis.status = any(v_statuses)) and (v_dates is null or vis.exam_date_id = any(v_dates))
                           and (v_campuses is null or vis.campus = any(v_campuses))
                           and (v_form is null or vis.form_stage = any(v_form)) and (v_pay is null or vis.pay_stage = any(v_pay)) and (v_ivs is null or vis.iv_id = any(v_ivs)) group by vis.stage) x),
           'status', (select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb) from (
                        select vis.status, count(*) n from vis
                         where (v_stages is null or vis.stage = any(v_stages)) and (v_dates is null or vis.exam_date_id = any(v_dates))
                           and (v_campuses is null or vis.campus = any(v_campuses))
                           and (v_form is null or vis.form_stage = any(v_form)) and (v_pay is null or vis.pay_stage = any(v_pay)) and (v_ivs is null or vis.iv_id = any(v_ivs)) group by vis.status) x),
           'vsat',   (select coalesce(jsonb_object_agg(coalesce(x.exam_date_id::text, 'none'), x.n), '{}'::jsonb) from (
                        select vis.exam_date_id, count(*) n from vis
                         where (v_stages is null or vis.stage = any(v_stages)) and (v_statuses is null or vis.status = any(v_statuses))
                           and (v_campuses is null or vis.campus = any(v_campuses))
                           and (v_form is null or vis.form_stage = any(v_form)) and (v_pay is null or vis.pay_stage = any(v_pay)) and (v_ivs is null or vis.iv_id = any(v_ivs)) group by vis.exam_date_id) x),
           'campus', (select coalesce(jsonb_object_agg(coalesce(x.campus, 'none'), x.n), '{}'::jsonb) from (
                        select vis.campus, count(*) n from vis
                         where (v_stages is null or vis.stage = any(v_stages)) and (v_statuses is null or vis.status = any(v_statuses))
                           and (v_dates is null or vis.exam_date_id = any(v_dates))
                           and (v_form is null or vis.form_stage = any(v_form)) and (v_pay is null or vis.pay_stage = any(v_pay)) and (v_ivs is null or vis.iv_id = any(v_ivs)) group by vis.campus) x),
           'form_stage', (select coalesce(jsonb_object_agg(coalesce(x.form_stage, 'none'), x.n), '{}'::jsonb) from (
                        select vis.form_stage, count(*) n from vis
                         where (v_stages is null or vis.stage = any(v_stages)) and (v_statuses is null or vis.status = any(v_statuses))
                           and (v_dates is null or vis.exam_date_id = any(v_dates)) and (v_campuses is null or vis.campus = any(v_campuses))
                           and (v_pay is null or vis.pay_stage = any(v_pay)) and (v_ivs is null or vis.iv_id = any(v_ivs)) group by vis.form_stage) x),
           'payment_stage', case when mgr then (select coalesce(jsonb_object_agg(coalesce(x.pay_stage, 'none'), x.n), '{}'::jsonb) from (
                        select vis.pay_stage, count(*) n from vis
                         where (v_stages is null or vis.stage = any(v_stages)) and (v_statuses is null or vis.status = any(v_statuses))
                           and (v_dates is null or vis.exam_date_id = any(v_dates)) and (v_campuses is null or vis.campus = any(v_campuses))
                           and (v_form is null or vis.form_stage = any(v_form)) and (v_ivs is null or vis.iv_id = any(v_ivs)) group by vis.pay_stage) x) else '{}'::jsonb end,
           'interviewer', (select coalesce(jsonb_object_agg(x.iv_id, x.n), '{}'::jsonb) from (
                        select vis.iv_id, count(*) n from vis
                         where (v_stages is null or vis.stage = any(v_stages)) and (v_statuses is null or vis.status = any(v_statuses))
                           and (v_dates is null or vis.exam_date_id = any(v_dates)) and (v_campuses is null or vis.campus = any(v_campuses))
                           and (v_form is null or vis.form_stage = any(v_form)) and (v_pay is null or vis.pay_stage = any(v_pay)) group by vis.iv_id) x),
           'interviewer_name', (select coalesce(jsonb_object_agg(v.iv_id, coalesce(ip.full_name, ip.email)), '{}'::jsonb)
                                  from (select distinct vis.iv_id from vis where vis.iv_id <> 'none') v
                                  join public.profiles ip on ip.id = v.iv_id::uuid)) end,
         (select coalesce(jsonb_agg(
                   jsonb_build_object('application_id', pv.application_id, 'stage', pv.stage, 'status', pv.status, 'attempt_no', pv.attempt_no)
                   || coalesce((select jsonb_object_agg(c, pv.v -> c) from unnest(v_cols) c), '{}'::jsonb)
                   order by pv.stage_changed_at desc, pv.application_id), '[]'::jsonb)
            from pagev pv)
    into total, facets, rows;

  return jsonb_build_object('total', total, 'facets', facets, 'rows', rows, 'limit', v_limit, 'offset', v_offset, 'can_manage', mgr);
end $function$;

-- ═════════════ 9. grants ═════════════
-- private helpers: nobody calls them directly
revoke all on function public.vsat__iv_ts(jsonb, text) from public, anon, authenticated;
revoke all on function public.vsat__iv_dur(jsonb) from public, anon, authenticated;
revoke all on function public.vsat__iv_busy_until(uuid, timestamptz, int, text, int) from public, anon, authenticated;
revoke all on function public.vsat__iv_event(public.interview_assignments, text, public.interview_assignments, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.vsat__iv_managed(text) from public, anon, authenticated;
revoke all on function public.vsat__iv_schedule(text, uuid, timestamptz, int, text, boolean, text, boolean) from public, anon, authenticated;
revoke all on function public.vsat__grid(jsonb, integer, boolean, boolean) from public, anon, authenticated;
revoke all on function public.vsat__grid_catalog() from public, anon, authenticated;

-- signed-in staff / students (each checks the caller inside)
revoke all on function public.vsat_assign_interview(jsonb) from public, anon;
revoke all on function public.vsat_schedule_interviews_bulk(jsonb) from public, anon;
revoke all on function public.vsat_cancel_interview(jsonb) from public, anon;
revoke all on function public.vsat_set_interview_attendance(jsonb) from public, anon;
revoke all on function public.vsat_interview_meet_retry(jsonb) from public, anon;
revoke all on function public.vsat_my_interview() from public, anon;
grant execute on function public.vsat_assign_interview(jsonb) to authenticated;
grant execute on function public.vsat_schedule_interviews_bulk(jsonb) to authenticated;
grant execute on function public.vsat_cancel_interview(jsonb) to authenticated;
grant execute on function public.vsat_set_interview_attendance(jsonb) to authenticated;
grant execute on function public.vsat_interview_meet_retry(jsonb) to authenticated;
grant execute on function public.vsat_my_interview() to authenticated;

-- the server (service role) only
revoke all on function public.vsat_interview_sync_claim(jsonb) from public, anon, authenticated;
revoke all on function public.vsat_interview_sync_release(jsonb) from public, anon, authenticated;
revoke all on function public.vsat_interview_attendance_due(int) from public, anon, authenticated;
revoke all on function public.vsat_interview_attendance_apply(jsonb) from public, anon, authenticated;
revoke all on function public.vsat_interview_notices_claim(jsonb) from public, anon, authenticated;
revoke all on function public.vsat_interview_notice_done(jsonb) from public, anon, authenticated;
grant execute on function public.vsat_interview_sync_claim(jsonb) to service_role;
grant execute on function public.vsat_interview_sync_release(jsonb) to service_role;
grant execute on function public.vsat_interview_attendance_due(int) to service_role;
grant execute on function public.vsat_interview_attendance_apply(jsonb) to service_role;
grant execute on function public.vsat_interview_notices_claim(jsonb) to service_role;
grant execute on function public.vsat_interview_notice_done(jsonb) to service_role;

comment on function public.vsat_assign_interview(jsonb) is
  'Admin / admissions: schedule or move one interview (interviewer, slot, 10–180 min, Google Meet or own link). Overlap-checked per interviewer; history + email event; Google sync queued.';
comment on function public.vsat_schedule_interviews_bulk(jsonb) is
  'Admin / admissions: up to 40 students, one interviewer, back-to-back slots from a start time (busy times skipped). dry_run = preview only.';
comment on function public.vsat_cancel_interview(jsonb) is
  'Admin / admissions: cancel a scheduled interview (reason required). Removes the slot and the Google event; the student goes back to VSAT cleared.';
comment on function public.vsat_set_interview_attendance(jsonb) is
  'Mark an interview joined / no-show after it starts. Admin / admissions any time (reason when changing a mark); the assigned interviewer the first mark.';
comment on function public.vsat_my_interview() is
  'The signed-in student''s own interview time. The Meet link is returned only from 10 minutes before the start until the end.';
comment on function public.vsat_interview_notices_claim(jsonb) is
  'Server only: claim interview email jobs (newest per interview; waits briefly for the Meet link; skips past times).';
