-- 0143 · VSAT interviews — book from the Interview panel rows (staging first).
--
-- Decisions (owner, 23 Nov 2026):
--   * No popup. Admin / admissions type Interviewer, Date and Time on each student's row (like the old sheet),
--     select rows and press one button: every row is booked with its own time, its own Google Meet and its
--     own emails (the 0140 rules, Meet and email jobs are reused as they are).
--   * What is typed but not sent yet is kept in the database (shared by the team, survives a refresh) and
--     counts in the clash check, so two rows can't be planned on top of each other.
--   * "Fill times": interviewer + start → back-to-back times for the selected rows (busy times skipped). It only
--     fills the rows; nothing is sent until someone presses Send.
--   * A booked student's time can be changed from the row too: Send → the "moved" emails.
--
-- What this adds
--   vsat_interview_drafts            one row per student: the interviewer / time typed in the panel, not sent yet
--   RPCs (signed-in admin / admissions; every check is inside, campus rules included):
--     vsat_interview_plan(p)          per student: booked values, typed values, state and any problem
--     vsat_interview_draft_set(p)     save (or clear) what was typed on one row
--     vsat_interview_drafts_fill(p)   back-to-back times for many rows from one interviewer + start time
--     vsat_interview_drafts_send(p)   book every typed row (new → invite, changed → moved); per-row results
--   Trigger: any schedule / move / cancel (from anywhere) clears that student's typed values.
--
-- "Effective plan": a booked student with a complete typed change counts at the NEW time; everyone else at
-- their booked time. A typed row clashes when the same interviewer is busy in that plan.
--
-- Rollback: supabase/rollback/0143_vsat_interview_inline_schedule_down.sql
-- Tests:    supabase/tests/vsat_interview_inline_schedule.test.sql

-- ═════════════ 1. typed, not-sent-yet values ═════════════
create table if not exists public.vsat_interview_drafts (
  application_id text primary key references public.vsat_pipeline(application_id) on delete cascade,
  attempt_no     int not null,
  interviewer_id uuid,
  slot_datetime  timestamptz,
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  constraint vsat_interview_drafts_not_empty check (interviewer_id is not null or slot_datetime is not null)
);
create index if not exists vsat_interview_drafts_interviewer_idx on public.vsat_interview_drafts (interviewer_id, slot_datetime)
  where interviewer_id is not null and slot_datetime is not null;
alter table public.vsat_interview_drafts enable row level security;
revoke all on table public.vsat_interview_drafts from public, anon, authenticated;
comment on table public.vsat_interview_drafts is
  'VSAT Interview panel: the interviewer / time typed on a student''s row and not sent yet. Read and written only through vsat_interview_* functions. Cleared when the student is booked, moved or cancelled.';

-- ═════════════ 2. helpers (not callable by browsers) ═════════════

-- application ids from a request: non-empty strings up to 64 characters, de-duplicated (first position kept), 1..p_max
create or replace function public.vsat__iv_ids(p jsonb, p_max int)
returns text[] language plpgsql immutable set search_path to '' as $$
declare ids text[];
begin
  if jsonb_typeof(p->'application_ids') is distinct from 'array' then raise exception 'BAD_VALUE: application_ids' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p->'application_ids') e(x)
              where jsonb_typeof(e.x) <> 'string' or char_length(e.x #>> '{}') not between 1 and 64) then
    raise exception 'BAD_VALUE: application_ids' using errcode = '22023';
  end if;
  select array_agg(d.x order by d.o) into ids
    from (select e.x, min(e.o) o from jsonb_array_elements_text(p->'application_ids') with ordinality e(x, o) group by e.x) d;
  if ids is null or array_length(ids, 1) > p_max then raise exception 'BAD_VALUE: application_ids' using errcode = '22023'; end if;
  return ids;
end $$;

-- The interviewer's busiest overlap with [p_start, p_start + p_dur) in the effective plan, or no row when free.
-- Effective plan: complete typed rows of students who can still be booked (at the typed time) + every live
-- booking of the other students. Students in p_exclude are left out entirely.
create or replace function public.vsat__iv_eff_busy(p_iid uuid, p_start timestamptz, p_dur int, p_exclude text[])
returns table (clash_app text, busy_until timestamptz)
language sql stable security definer set search_path to '' as $$
  with moving as (
    select d.application_id, d.interviewer_id, d.slot_datetime,
           coalesce((select a.duration_min from public.interview_assignments a
                      where a.application_id = d.application_id and a.attempt_no = d.attempt_no and a.cancelled_at is null
                        and a.slot_datetime is not null and a.interviewer_id is not null), 30) as dur
      from public.vsat_interview_drafts d
      join public.vsat_pipeline vp on vp.application_id = d.application_id and vp.attempt_no = d.attempt_no
     where d.interviewer_id is not null and d.slot_datetime is not null
       and vp.stage in ('vsat_cleared', 'interview_scheduled') and vp.status <> 'not_selected'
       and not exists (select 1 from public.interview_assignments s
                        where s.application_id = d.application_id and s.attempt_no = d.attempt_no and s.submitted_at is not null)
  ), eff as (
    select m.application_id, m.interviewer_id, m.slot_datetime, m.dur from moving m
    union all
    select a.application_id, a.interviewer_id, a.slot_datetime, a.duration_min
      from public.interview_assignments a
     where a.cancelled_at is null and a.slot_datetime is not null and a.interviewer_id is not null
       and not exists (select 1 from moving m where m.application_id = a.application_id)
  )
  select e.application_id, e.slot_datetime + make_interval(mins => e.dur)
    from eff e
   where e.interviewer_id = p_iid
     and not (e.application_id = any(coalesce(p_exclude, '{}'::text[])))
     and e.slot_datetime < p_start + make_interval(mins => p_dur)
     and e.slot_datetime + make_interval(mins => e.dur) > p_start
   order by 2 desc, 1
   limit 1
$$;

-- a schedule / move / cancel from anywhere (drawer, panel, bulk) replaces what was typed for that student
create or replace function public.vsat__iv_drafts_clear()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if tg_op = 'INSERT' or new.version is distinct from old.version then
    delete from public.vsat_interview_drafts d where d.application_id = new.application_id;
  end if;
  return null;
end $$;

drop trigger if exists vsat_interview_drafts_clear on public.interview_assignments;
create trigger vsat_interview_drafts_clear
  after insert or update of version on public.interview_assignments
  for each row execute function public.vsat__iv_drafts_clear();

-- ═════════════ 3. staff RPCs ═════════════

-- p: {application_ids (1–100)}. One entry per student the caller may manage (others are left out), in the given order:
--   {application_id, attempt_no, state, problem, clash_with, booked, draft}
--   state: empty | incomplete | ready (new, can be sent) | booked | changed (booked + a new time, can be sent)
--          | problem (typed but can't be sent: see problem) | locked (interview done / not at an interview stage)
--   problem: ALREADY_INTERVIEWED | WRONG_STAGE | SLOT_IN_PAST | NOT_AN_INTERVIEWER | CLASH (clash_with = {application_id, name})
create or replace function public.vsat_interview_plan(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare ids text[]; app text; vp public.vsat_pipeline; cur public.interview_assignments; d public.vsat_interview_drafts;
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
    select * into cur from public.interview_assignments a where a.application_id = app and a.attempt_no = vp.attempt_no;
    has_row := found;
    live := has_row and cur.cancelled_at is null and cur.slot_datetime is not null and cur.interviewer_id is not null;
    done := has_row and cur.submitted_at is not null;
    ok_stage := vp.stage in ('vsat_cleared', 'interview_scheduled') and vp.status <> 'not_selected';
    select * into d from public.vsat_interview_drafts x where x.application_id = app and x.attempt_no = vp.attempt_no;
    has_draft := found;
    prob := null; cw := null;

    if not has_draft then
      st := case when done or not ok_stage then 'locked' when live then 'booked' else 'empty' end;
    else
      prob := case when done then 'ALREADY_INTERVIEWED' when not ok_stage then 'WRONG_STAGE' end;
      if prob is null and (d.interviewer_id is null or d.slot_datetime is null) then
        st := 'incomplete';
      else
        if prob is null and d.slot_datetime < now() then prob := 'SLOT_IN_PAST'; end if;
        if prob is null and not exists (select 1 from public.vsat_team t where t.user_id = d.interviewer_id and t.role = 'interviewer' and t.active) then
          prob := 'NOT_AN_INTERVIEWER';
        end if;
        if prob is null then
          dur := case when live then cur.duration_min else 30 end;
          select * into c from public.vsat__iv_eff_busy(d.interviewer_id, d.slot_datetime, dur, array[app]);
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
      'booked', case when live then jsonb_build_object('interviewer_id', cur.interviewer_id, 'slot', cur.slot_datetime,
                                                       'duration_min', cur.duration_min, 'meet_mode', cur.meet_mode) end,
      'draft', case when has_draft then jsonb_build_object('interviewer_id', d.interviewer_id, 'slot', d.slot_datetime,
                                                           'updated_at', d.updated_at) end));
  end loop;
  return out;
end $$;

-- p: {application_id, interviewer_id (or null), slot_datetime (or null)} — what the row shows now.
-- Both empty, or the same as the booking → the typed values are cleared. Returns the row's plan entry.
create or replace function public.vsat_interview_draft_set(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare app text; iid uuid; slot timestamptz; vp public.vsat_pipeline; cur public.interview_assignments; has_row boolean; live boolean;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['application_id', 'interviewer_id', 'slot_datetime']);
  app := public.vsat__txt(p, 'application_id', 64, true);
  vp := public.vsat__iv_managed(app);   -- role first: an outsider learns nothing from value errors
  begin iid := (public.vsat__txt(p, 'interviewer_id', 40, false))::uuid;
  exception when invalid_text_representation then raise exception 'BAD_VALUE: interviewer_id' using errcode = '22023'; end;
  if p ? 'slot_datetime' and jsonb_typeof(p->'slot_datetime') <> 'null' then
    slot := public.vsat__iv_ts(p, 'slot_datetime');
    if slot < now() - interval '30 days' or slot > now() + interval '366 days' then
      raise exception 'BAD_VALUE: slot_datetime' using errcode = '22023';
    end if;
  end if;
  if iid is not null and not exists (select 1 from public.vsat_team t where t.user_id = iid and t.role = 'interviewer' and t.active) then
    raise exception 'NOT_AN_INTERVIEWER' using errcode = '22023';
  end if;

  select * into cur from public.interview_assignments a where a.application_id = app and a.attempt_no = vp.attempt_no;
  has_row := found;
  live := has_row and cur.cancelled_at is null and cur.slot_datetime is not null and cur.interviewer_id is not null;
  if has_row and cur.submitted_at is not null then raise exception 'ALREADY_INTERVIEWED' using errcode = '22023'; end if;
  if vp.stage not in ('vsat_cleared', 'interview_scheduled') or vp.status = 'not_selected' then
    raise exception 'WRONG_STAGE' using errcode = '22023';
  end if;

  if (iid is null and slot is null) or (live and cur.interviewer_id = iid and cur.slot_datetime = slot) then
    delete from public.vsat_interview_drafts d where d.application_id = app;
  else
    insert into public.vsat_interview_drafts as d (application_id, attempt_no, interviewer_id, slot_datetime, updated_at, updated_by)
    values (app, vp.attempt_no, iid, slot, now(), auth.uid())
    on conflict (application_id) do update
      set attempt_no = excluded.attempt_no, interviewer_id = excluded.interviewer_id, slot_datetime = excluded.slot_datetime,
          updated_at = now(), updated_by = auth.uid();
  end if;
  return coalesce(public.vsat_interview_plan(jsonb_build_object('application_ids', jsonb_build_array(app))) -> 0, 'null'::jsonb);
end $$;

-- p: {application_ids (1–40, in row order), interviewer_id, start}. Back-to-back 30-minute times from `start` for
-- the students that are not booked yet; times this interviewer is busy (bookings or other typed rows) are skipped.
-- Only fills the rows: nothing is booked or emailed. Returns {filled: [{application_id, name, slot}], skipped: [{application_id, name, code}]}.
create or replace function public.vsat_interview_drafts_fill(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare ids text[]; fillable text[] := '{}'; rest text[]; iid uuid; t timestamptz; app text; vp public.vsat_pipeline;
        cur public.interview_assignments; nm text; c record; tries int; filled jsonb := '[]'::jsonb; skipped jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  if not public.vsat__can_manage(null) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['application_ids', 'interviewer_id', 'start']);
  ids := public.vsat__iv_ids(p, 40);
  begin iid := (public.vsat__txt(p, 'interviewer_id', 40, true))::uuid;
  exception when invalid_text_representation then raise exception 'BAD_VALUE: interviewer_id' using errcode = '22023'; end;
  if not exists (select 1 from public.vsat_team tm where tm.user_id = iid and tm.role = 'interviewer' and tm.active) then
    raise exception 'NOT_AN_INTERVIEWER' using errcode = '22023';
  end if;
  t := public.vsat__iv_ts(p, 'start');
  if t < now() then raise exception 'SLOT_IN_PAST' using errcode = '22023'; end if;
  if t > now() + interval '366 days' then raise exception 'BAD_VALUE: start' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended('vsat_interviewer:' || iid::text, 0));

  -- 1) who can be filled (the others are listed with the reason and keep what they have)
  foreach app in array ids loop
    nm := null;
    begin
      vp := public.vsat__iv_managed(app);
      select am.registered_name into nm from public.application_manager am where am.application_id = app;
      if vp.stage not in ('vsat_cleared', 'interview_scheduled') or vp.status = 'not_selected' then raise exception 'WRONG_STAGE'; end if;
      select * into cur from public.interview_assignments a where a.application_id = app and a.attempt_no = vp.attempt_no;
      if found and cur.submitted_at is not null then raise exception 'ALREADY_INTERVIEWED'; end if;
      if found and cur.cancelled_at is null and cur.slot_datetime is not null and cur.interviewer_id is not null then
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
      select * into c from public.vsat__iv_eff_busy(iid, t, 30, rest);
      exit when not found;
      t := c.busy_until; tries := tries + 1;
      if tries > 200 then exit; end if;
    end loop;
    if tries > 200 then
      skipped := skipped || jsonb_build_array(jsonb_build_object('application_id', app, 'name', nm, 'code', 'NO_FREE_SLOT'));
    else
      insert into public.vsat_interview_drafts as d (application_id, attempt_no, interviewer_id, slot_datetime, updated_at, updated_by)
      select app, vp2.attempt_no, iid, t, now(), auth.uid() from public.vsat_pipeline vp2 where vp2.application_id = app
      on conflict (application_id) do update
        set attempt_no = excluded.attempt_no, interviewer_id = excluded.interviewer_id, slot_datetime = excluded.slot_datetime,
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
create or replace function public.vsat_interview_drafts_send(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare ids text[]; pending text[]; nxt text[]; app text; vp public.vsat_pipeline; cur public.interview_assignments;
        d public.vsat_interview_drafts; live boolean; dur int; nm text; names jsonb := '{}'::jsonb; c record; r jsonb;
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
        select * into d from public.vsat_interview_drafts x where x.application_id = app and x.attempt_no = vp.attempt_no;
        if not found or d.interviewer_id is null or d.slot_datetime is null then raise exception 'NO_DRAFT' using errcode = '22023'; end if;
        select * into cur from public.interview_assignments a where a.application_id = app and a.attempt_no = vp.attempt_no;
        live := found and cur.cancelled_at is null and cur.slot_datetime is not null and cur.interviewer_id is not null;
        dur := case when live then cur.duration_min else 30 end;
        select * into c from public.vsat__iv_eff_busy(d.interviewer_id, d.slot_datetime, dur, array[app]);
        if found then raise exception 'CLASH' using errcode = '23505'; end if;
        -- Google Meet for new ones; a booked one keeps its Meet (or its own link)
        r := public.vsat__iv_schedule(app, d.interviewer_id, d.slot_datetime, dur, null, null, 'bulk', false);
        delete from public.vsat_interview_drafts x where x.application_id = app;
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

-- ═════════════ 4. access ═════════════
revoke all on function public.vsat__iv_ids(jsonb, int) from public, anon, authenticated;
revoke all on function public.vsat__iv_eff_busy(uuid, timestamptz, int, text[]) from public, anon, authenticated;
revoke all on function public.vsat__iv_drafts_clear() from public, anon, authenticated;

revoke all on function public.vsat_interview_plan(jsonb) from public, anon;
revoke all on function public.vsat_interview_draft_set(jsonb) from public, anon;
revoke all on function public.vsat_interview_drafts_fill(jsonb) from public, anon;
revoke all on function public.vsat_interview_drafts_send(jsonb) from public, anon;
grant execute on function public.vsat_interview_plan(jsonb) to authenticated;
grant execute on function public.vsat_interview_draft_set(jsonb) to authenticated;
grant execute on function public.vsat_interview_drafts_fill(jsonb) to authenticated;
grant execute on function public.vsat_interview_drafts_send(jsonb) to authenticated;
