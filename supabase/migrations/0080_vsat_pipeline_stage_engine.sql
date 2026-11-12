-- 0080 · VSAT pipeline, step 2 — stage engine (staging first).
--
-- One pipeline row per application, moved only through database functions that check the
-- caller's role. Every move is written to a history table (who, when, from, to, reason).
-- Spec: "VSAT Pipeline in Vedam One — Build Spec". Builds on 0079 (roles, formulas).
--
-- Decisions (owner, 12 Nov 2026):
--   * The pipeline stage is NEW and staff-only (vsat_pipeline). Each move also updates the
--     old fields application_stage_1/2 and lead_manager.lead_stage where a matching value
--     exists, so the student dashboard, communication lists and the Elevate webhook keep working.
--   * Eligibility is shown only (no exam block yet). Admins may override VPS or eligibility
--     with a required reason; the calculated value stays visible.
--   * After the interview form: auto-move only when the calculated AND interviewer verdicts are
--     both Selected (wired in step 4 through vsat__move; this file provides the engine).
--
-- Stages (in order):  booked → eligible → exam_taken → vsat_cleared → interview_scheduled →
--   interviewed → pi_cleared → counselling_scheduled → counselled → offer_sent →
--   seat_blocked | offer_lapsed | offer_cancelled
-- Status at any stage: active | not_selected | absent | on_hold.
--
-- Who may move:
--   admin, admissions  any move. Reason required when moving back, skipping a stage, reopening a
--                      student who is not active, or setting not_selected / on_hold.
--                      Admissions with a campus only act on that campus (or students with none).
--   interviewer        own student only: interview_scheduled → interviewed, or mark absent.
--   counsellor         own student only: counselling_scheduled → counselled, or mark absent.
--   Moving into interview_scheduled / counselling_scheduled needs an assignment row first.
--
-- Automatic (source = system): a pipeline row is created as "booked" when an application gets
-- an exam date, and moves to "exam_taken" when exam_given turns true.
--
-- Backfill: existing applications get a pipeline row derived from their current fields
-- (source = backfill). Before the production release, review backfilled rows in post-exam
-- stages: until this release applicants could set application_stage_1 themselves.
--
-- Rollback: supabase/rollback/0080_vsat_pipeline_stage_engine_down.sql
-- Tests:    supabase/tests/vsat_pipeline_stage_engine.test.sql

-- ── tables ────────────────────────────────────────────────────────────────────────────
create table if not exists public.vsat_pipeline (
  application_id   text primary key references public.application_manager(application_id) on delete cascade,
  attempt_no       int  not null default 1 check (attempt_no between 1 and 2),
  stage            text not null check (stage in ('booked', 'eligible', 'exam_taken', 'vsat_cleared', 'interview_scheduled',
                     'interviewed', 'pi_cleared', 'counselling_scheduled', 'counselled', 'offer_sent', 'seat_blocked',
                     'offer_lapsed', 'offer_cancelled')),
  status           text not null default 'active' check (status in ('active', 'not_selected', 'absent', 'on_hold')),
  stage_changed_at timestamptz not null default now(),
  stage_changed_by uuid,
  created_at       timestamptz not null default now()
);
create index if not exists vsat_pipeline_stage_idx on public.vsat_pipeline (stage, status, stage_changed_at desc);
alter table public.vsat_pipeline enable row level security;

create table if not exists public.vsat_stage_history (
  id             bigint generated always as identity primary key,
  application_id text not null references public.application_manager(application_id) on delete cascade,
  attempt_no     int  not null,
  from_stage     text,
  to_stage       text not null,
  from_status    text,
  to_status      text not null,
  reason         text,
  source         text not null check (source in ('manual', 'bulk', 'auto', 'system', 'backfill')),
  actor_id       uuid,
  created_at     timestamptz not null default now()
);
create index if not exists vsat_stage_history_app_idx on public.vsat_stage_history (application_id, created_at desc);
alter table public.vsat_stage_history enable row level security;

create table if not exists public.vsat_overrides (
  id             uuid primary key default gen_random_uuid(),
  application_id text not null references public.application_manager(application_id) on delete cascade,
  field          text not null check (field in ('vps', 'eligible')),
  value          jsonb not null,
  calculated     jsonb,
  reason         text not null check (char_length(btrim(reason)) between 3 and 500),
  set_by         uuid not null,
  set_at         timestamptz not null default now(),
  cleared_by     uuid,
  cleared_at     timestamptz,
  clear_reason   text
);
create unique index if not exists vsat_overrides_active_key on public.vsat_overrides (application_id, field) where cleared_at is null;
alter table public.vsat_overrides enable row level security;

-- ── small private helpers ─────────────────────────────────────────────────────────────
create or replace function public.vsat__stage_order(p_stage text)
returns int language sql immutable set search_path to '' as $$
  select case p_stage
    when 'booked' then 1 when 'eligible' then 2 when 'exam_taken' then 3 when 'vsat_cleared' then 4
    when 'interview_scheduled' then 5 when 'interviewed' then 6 when 'pi_cleared' then 7
    when 'counselling_scheduled' then 8 when 'counselled' then 9 when 'offer_sent' then 10
    when 'seat_blocked' then 11 when 'offer_lapsed' then 11 when 'offer_cancelled' then 11 end
$$;

-- campus_applied is free text ("Ajeenkya DY Patil University — Pune", "Gurugram (Sushant University)", …)
create or replace function public.vsat__campus_key(p_campus text)
returns text language sql immutable set search_path to '' as $$
  select case when p_campus ilike '%pune%' then 'pune' when p_campus ilike '%gurugram%' then 'gurugram' end
$$;

-- pipeline stage → old application/lead stage value (null = leave the old field alone)
create or replace function public.vsat__legacy_stage(p_stage text, p_status text)
returns text language sql immutable set search_path to '' as $$
  select case
    when p_stage = 'exam_taken'   and p_status = 'not_selected' then 'vsat_not_cleared'
    when p_stage = 'vsat_cleared' and p_status = 'active'       then 'vsat_cleared'
    when p_stage = 'interview_scheduled' and p_status = 'active' then 'interview_selected'
    when p_stage = 'interviewed'  and p_status = 'not_selected' then 'interview_rejected'
    when p_stage = 'counselled'   and p_status = 'active'       then 'counselling_done'
    when p_stage = 'offer_sent'   and p_status = 'active'       then 'offer_released'
    when p_stage = 'seat_blocked' and p_status = 'active'       then 'enrolled'
    when p_stage = 'offer_cancelled'                            then 'offer_cancelled'
  end
$$;

-- admin, or active admissions member allowed on this campus (team campus null = all; student campus null = visible to all)
create or replace function public.vsat__can_manage(p_campus text)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(public.is_admin(), false)
      or exists (select 1 from public.vsat_team t
                  where t.user_id = auth.uid() and t.role = 'admissions' and t.active
                    and (t.campus is null or p_campus is null or t.campus = p_campus))
$$;

create or replace function public.vsat__is_assigned(p_role text, p_app text, p_attempt int)
returns boolean language sql stable security definer set search_path to '' as $$
  select case p_role
    when 'interviewer' then exists (select 1 from public.vsat_team t where t.user_id = auth.uid() and t.role = 'interviewer' and t.active)
                        and exists (select 1 from public.interview_assignments a
                                     where a.application_id = p_app and a.attempt_no = p_attempt and a.interviewer_id = auth.uid())
    when 'counsellor'  then exists (select 1 from public.vsat_team t where t.user_id = auth.uid() and t.role = 'counsellor' and t.active)
                        and exists (select 1 from public.counselling_assignments a
                                     where a.application_id = p_app and a.attempt_no = p_attempt and a.counsellor_id = auth.uid())
    else false end
$$;

-- may the caller see this student at all?
create or replace function public.vsat__can_view(p_app text)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.vsat_pipeline vp join public.application_manager am on am.application_id = vp.application_id
     where vp.application_id = p_app
       and (public.vsat__can_manage(public.vsat__campus_key(am.campus_applied))
            or public.vsat__is_assigned('interviewer', vp.application_id, vp.attempt_no)
            or public.vsat__is_assigned('counsellor', vp.application_id, vp.attempt_no)))
$$;

-- effective VPS and eligibility: calculated value, active override, and what counts
create or replace function public.vsat__effective(p_app text)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare am public.application_manager; rules jsonb; el jsonb; ov_vps jsonb; ov_el jsonb;
begin
  select * into am from public.application_manager where application_id = p_app;
  if not found then return null; end if;
  select s.eligibility into rules from public.vsat_exam_settings s limit 1;
  el := public.vsat_calc_eligibility(am.class10_year, am.class12_year, am.marks_physics_12, am.marks_chemistry_12, am.marks_maths_12, rules);
  select o.value into ov_vps from public.vsat_overrides o where o.application_id = p_app and o.field = 'vps' and o.cleared_at is null;
  select o.value into ov_el  from public.vsat_overrides o where o.application_id = p_app and o.field = 'eligible' and o.cleared_at is null;
  return jsonb_build_object(
    'vps',      jsonb_build_object('calculated', am.vps_score, 'override', ov_vps, 'value', coalesce(ov_vps, to_jsonb(am.vps_score))),
    'eligible', jsonb_build_object('calculated', el->'eligible', 'detail', el, 'override', ov_el, 'value', coalesce(ov_el, el->'eligible')));
end $$;

-- ── the engine (private): move one student, log it, sync the old fields ─────────────────
create or replace function public.vsat__move(
  p_app text, p_to_stage text, p_to_status text, p_reason text, p_source text, p_actor uuid, p_expected_stage text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare cur public.vsat_pipeline; legacy text;
begin
  select * into cur from public.vsat_pipeline where application_id = p_app for update;
  if not found then raise exception 'NOT_IN_PIPELINE' using errcode = 'P0002'; end if;
  if p_expected_stage is not null and cur.stage <> p_expected_stage then
    raise exception 'STAGE_CHANGED' using errcode = '40001';
  end if;
  if cur.stage = p_to_stage and cur.status = p_to_status then
    return jsonb_build_object('application_id', p_app, 'stage', cur.stage, 'status', cur.status, 'changed', false);
  end if;

  update public.vsat_pipeline
     set stage = p_to_stage, status = p_to_status, stage_changed_at = now(), stage_changed_by = p_actor
   where application_id = p_app;
  insert into public.vsat_stage_history (application_id, attempt_no, from_stage, to_stage, from_status, to_status, reason, source, actor_id)
  values (p_app, cur.attempt_no, cur.stage, p_to_stage, cur.status, p_to_status, nullif(btrim(p_reason), ''), p_source, p_actor);

  legacy := public.vsat__legacy_stage(p_to_stage, p_to_status);
  if legacy is not null then
    if cur.attempt_no = 2 then
      update public.application_manager set application_stage_2 = legacy::public.vm_app_stage, last_updated_date = now()
       where application_id = p_app and application_stage_2 is distinct from legacy::public.vm_app_stage;
    else
      update public.application_manager set application_stage_1 = legacy::public.vm_app_stage, last_updated_date = now()
       where application_id = p_app and application_stage_1 is distinct from legacy::public.vm_app_stage;
    end if;
    update public.lead_manager lm set previous_lead_stage = lm.lead_stage::text, lead_stage = legacy::public.vm_lead_stage
      from public.application_manager am
     where am.application_id = p_app and lm.lead_id = am.lead_id and lm.lead_stage is distinct from legacy::public.vm_lead_stage;
  end if;

  return jsonb_build_object('application_id', p_app, 'stage', p_to_stage, 'status', p_to_status,
                            'from_stage', cur.stage, 'from_status', cur.status, 'changed', true);
end $$;

-- role and rule checks for one move by the signed-in user (private; used by the RPCs below)
create or replace function public.vsat__move_checked(
  p_app text, p_to_stage text, p_to_status text, p_reason text, p_expected_stage text, p_source text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare cur public.vsat_pipeline; campus text; to_stage text; to_status text; o_cur int; o_to int; need_reason boolean;
begin
  select vp.* into cur from public.vsat_pipeline vp where vp.application_id = p_app;
  if not found then
    if public.vsat__can_manage(null) then raise exception 'NOT_IN_PIPELINE' using errcode = 'P0002'; end if;
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select public.vsat__campus_key(am.campus_applied) into campus from public.application_manager am where am.application_id = p_app;
  to_stage  := coalesce(p_to_stage, cur.stage);
  to_status := coalesce(p_to_status, 'active');
  o_cur := public.vsat__stage_order(cur.stage);
  o_to  := public.vsat__stage_order(to_stage);
  if o_to is null then raise exception 'BAD_STAGE' using errcode = '22023'; end if;
  if to_status not in ('active', 'not_selected', 'absent', 'on_hold') then raise exception 'BAD_STATUS' using errcode = '22023'; end if;
  if p_reason is not null and char_length(p_reason) > 500 then raise exception 'REASON_TOO_LONG' using errcode = '22023'; end if;

  if public.vsat__can_manage(campus) then
    need_reason := o_to < o_cur or o_to > o_cur + 1 or to_status in ('not_selected', 'on_hold')
                   or (cur.status <> 'active' and to_status = 'active');
  elsif cur.stage = 'interview_scheduled' and public.vsat__is_assigned('interviewer', p_app, cur.attempt_no)
        and ((to_stage = 'interviewed' and to_status = 'active') or (to_stage = 'interview_scheduled' and to_status = 'absent')) then
    need_reason := false;
  elsif cur.stage = 'counselling_scheduled' and public.vsat__is_assigned('counsellor', p_app, cur.attempt_no)
        and ((to_stage = 'counselled' and to_status = 'active') or (to_stage = 'counselling_scheduled' and to_status = 'absent')) then
    need_reason := false;
  else
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  -- the panel was out of date: say so before any other rule
  if p_expected_stage is not null and cur.stage <> p_expected_stage then
    raise exception 'STAGE_CHANGED' using errcode = '40001';
  end if;

  if need_reason and char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;
  -- scheduled stages need the assignment (interviewer / counsellor + slot) first
  if to_stage = 'interview_scheduled' and cur.stage <> 'interview_scheduled'
     and not exists (select 1 from public.interview_assignments a where a.application_id = p_app and a.attempt_no = cur.attempt_no and a.interviewer_id is not null) then
    raise exception 'NEEDS_INTERVIEWER' using errcode = '22023';
  end if;
  if to_stage = 'counselling_scheduled' and cur.stage <> 'counselling_scheduled'
     and not exists (select 1 from public.counselling_assignments a where a.application_id = p_app and a.attempt_no = cur.attempt_no and a.counsellor_id is not null) then
    raise exception 'NEEDS_COUNSELLOR' using errcode = '22023';
  end if;

  return public.vsat__move(p_app, to_stage, to_status, p_reason, p_source, auth.uid(), p_expected_stage);
end $$;

-- refuse unknown keys and non-text values (same pattern as pp_book)
create or replace function public.vsat__check_keys(p jsonb, p_allowed text[])
returns void language plpgsql immutable set search_path to '' as $$
declare k text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'BAD_REQUEST' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p) loop
    if not (k = any(p_allowed)) then raise exception 'UNKNOWN_KEY: %', k using errcode = '22023'; end if;
  end loop;
end $$;

-- ── browser-callable RPCs ─────────────────────────────────────────────────────────────

-- move one student. p: {application_id, to_stage?, to_status?, reason?, expected_stage?}
create or replace function public.vsat_move_stage(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare k text;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['application_id', 'to_stage', 'to_status', 'reason', 'expected_stage']);
  foreach k in array array['application_id', 'to_stage', 'to_status', 'reason', 'expected_stage'] loop
    if p ? k and jsonb_typeof(p->k) not in ('string', 'null') then raise exception 'BAD_VALUE: %', k using errcode = '22023'; end if;
  end loop;
  if coalesce(p->>'application_id', '') = '' then raise exception 'BAD_VALUE: application_id' using errcode = '22023'; end if;
  return public.vsat__move_checked(p->>'application_id', p->>'to_stage', p->>'to_status', p->>'reason', p->>'expected_stage', 'manual');
end $$;

-- move many students (admin / admissions only, up to 500). Each student is checked on its own;
-- the result lists who moved and who was skipped with the reason code.
-- p: {application_ids: [..], to_stage, to_status?, reason?, expected_stage?}
create or replace function public.vsat_move_bulk(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare ids text[]; id text; moved int := 0; unchanged int := 0; skipped jsonb := '[]'::jsonb; r jsonb; k text;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  if not public.vsat__can_manage(null) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['application_ids', 'to_stage', 'to_status', 'reason', 'expected_stage']);
  foreach k in array array['to_stage', 'to_status', 'reason', 'expected_stage'] loop
    if p ? k and jsonb_typeof(p->k) not in ('string', 'null') then raise exception 'BAD_VALUE: %', k using errcode = '22023'; end if;
  end loop;
  if jsonb_typeof(p->'application_ids') <> 'array' or jsonb_array_length(p->'application_ids') = 0
     or jsonb_array_length(p->'application_ids') > 500
     or exists (select 1 from jsonb_array_elements(p->'application_ids') e where jsonb_typeof(e) <> 'string') then
    raise exception 'BAD_VALUE: application_ids' using errcode = '22023';
  end if;
  if coalesce(p->>'to_stage', '') = '' then raise exception 'BAD_VALUE: to_stage' using errcode = '22023'; end if;
  select array_agg(distinct e) into ids from jsonb_array_elements_text(p->'application_ids') e;

  foreach id in array ids loop
    begin
      r := public.vsat__move_checked(id, p->>'to_stage', p->>'to_status', p->>'reason', p->>'expected_stage', 'bulk');
      if (r->>'changed')::boolean then moved := moved + 1; else unchanged := unchanged + 1; end if;
    exception when others then
      skipped := skipped || jsonb_build_object('application_id', id, 'code', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('moved', moved, 'unchanged', unchanged, 'skipped', skipped);
end $$;

-- panel list with stage counts (trickle-down: filter by stage). Interviewers / counsellors see
-- only their own students and no contact details.
-- p: {stage?, status?, exam_date_id?, campus?, q?, limit? (≤200), offset?}
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
             'exam_percentile', am.exam_percentile, 'effective', public.vsat__effective(pg.application_id))
             order by pg.stage_changed_at desc, pg.application_id), '[]'::jsonb)
            from page pg join public.application_manager am on am.application_id = pg.application_id
            left join public.vsat_exam_dates d on d.id = am.exam_date_id)
    into counts, total, rows;

  return jsonb_build_object('total', total, 'counts', counts, 'rows', rows, 'limit', v_limit, 'offset', v_offset);
end $$;

-- a student's stage history (anyone who may see the student)
create or replace function public.vsat_stage_history_for(p_application_id text)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  if not public.vsat__can_view(p_application_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('at', h.created_at, 'from_stage', h.from_stage, 'to_stage', h.to_stage,
             'from_status', h.from_status, 'to_status', h.to_status, 'reason', h.reason, 'source', h.source,
             'attempt_no', h.attempt_no, 'by', coalesce(pr.full_name, pr.email)) order by h.created_at desc, h.id desc)
      from public.vsat_stage_history h left join public.profiles pr on pr.id = h.actor_id
     where h.application_id = p_application_id), '[]'::jsonb);
end $$;

-- admin override of VPS (0–10) or eligibility (true/false), reason required. p: {application_id, field, value, reason}
create or replace function public.vsat_set_override(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare app text; f text; v jsonb; v_reason text; eff jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['application_id', 'field', 'value', 'reason']);
  app := p->>'application_id'; f := p->>'field'; v := p->'value'; v_reason := btrim(coalesce(p->>'reason', ''));
  if jsonb_typeof(p->'application_id') <> 'string' or not exists (select 1 from public.vsat_pipeline vp where vp.application_id = app) then
    raise exception 'NOT_IN_PIPELINE' using errcode = 'P0002';
  end if;
  if f = 'vps' then
    if jsonb_typeof(v) <> 'number' or (v::text)::numeric < 0 or (v::text)::numeric > 10 then raise exception 'BAD_VALUE: value' using errcode = '22023'; end if;
  elsif f = 'eligible' then
    if jsonb_typeof(v) <> 'boolean' then raise exception 'BAD_VALUE: value' using errcode = '22023'; end if;
  else
    raise exception 'BAD_VALUE: field' using errcode = '22023';
  end if;
  if jsonb_typeof(p->'reason') <> 'string' or char_length(v_reason) < 3 then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
  if char_length(v_reason) > 500 then raise exception 'REASON_TOO_LONG' using errcode = '22023'; end if;

  eff := public.vsat__effective(app);
  update public.vsat_overrides set cleared_at = now(), cleared_by = auth.uid(), clear_reason = 'replaced'
   where application_id = app and field = f and cleared_at is null;
  insert into public.vsat_overrides (application_id, field, value, calculated, reason, set_by)
  values (app, f, v, eff->f->'calculated', v_reason, auth.uid());
  return public.vsat__effective(app);
end $$;

-- remove an active override (admin). p: {application_id, field, reason}
create or replace function public.vsat_clear_override(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare n int; v_reason text;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  perform public.vsat__check_keys(p, array['application_id', 'field', 'reason']);
  v_reason := btrim(coalesce(p->>'reason', ''));
  if char_length(v_reason) < 3 then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
  if char_length(v_reason) > 500 then raise exception 'REASON_TOO_LONG' using errcode = '22023'; end if;
  update public.vsat_overrides set cleared_at = now(), cleared_by = auth.uid(), clear_reason = v_reason
   where application_id = p->>'application_id' and field = p->>'field' and cleared_at is null;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'NO_OVERRIDE' using errcode = 'P0002'; end if;
  return public.vsat__effective(p->>'application_id');
end $$;

-- ── automatic moves from the exam flow ────────────────────────────────────────────────
create or replace function public.vsat__on_application()
returns trigger language plpgsql security definer set search_path to '' as $$
declare st text; stt text;
begin
  if new.exam_date_id is not null and not exists (select 1 from public.vsat_pipeline vp where vp.application_id = new.application_id) then
    insert into public.vsat_pipeline (application_id, attempt_no, stage, status)
    values (new.application_id, least(greatest(coalesce(new.current_attempt, 1), 1), 2), 'booked', 'active')
    on conflict (application_id) do nothing;
    if found then
      insert into public.vsat_stage_history (application_id, attempt_no, to_stage, to_status, source)
      values (new.application_id, least(greatest(coalesce(new.current_attempt, 1), 1), 2), 'booked', 'active', 'system');
    end if;
  end if;
  if coalesce(new.exam_given, false) and (tg_op = 'INSERT' or not coalesce(old.exam_given, false)) then
    select vp.stage, vp.status into st, stt from public.vsat_pipeline vp where vp.application_id = new.application_id;
    if st in ('booked', 'eligible') and stt = 'active' then
      perform public.vsat__move(new.application_id, 'exam_taken', 'active', null, 'system', null, null);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists trg_vsat_pipeline_sync on public.application_manager;
create trigger trg_vsat_pipeline_sync after insert or update of exam_date_id, exam_given on public.application_manager
  for each row execute function public.vsat__on_application();

-- ── backfill existing applications ────────────────────────────────────────────────────
with src as (
  select am.application_id, least(greatest(coalesce(am.current_attempt, 1), 1), 2) attempt_no,
    case am.application_stage_1::text
      when 'enrolled' then 'seat_blocked'        when 'offer_cancelled' then 'offer_cancelled'
      when 'offer_released' then 'offer_sent'    when 'counselling_done' then 'counselled'
      when 'interview_selected' then 'pi_cleared' when 'interview_rejected' then 'interviewed'
      when 'vsat_cleared' then 'vsat_cleared'    when 'vsat_not_cleared' then 'exam_taken'
      else case when am.exam_given then 'exam_taken'
                when am.exam_date_id is not null or am.application_stage_1::text = 'slot_selected' then 'booked' end
    end stage,
    case when am.application_stage_1::text in ('interview_rejected', 'vsat_not_cleared') then 'not_selected' else 'active' end status
  from public.application_manager am
  where not exists (select 1 from public.vsat_pipeline vp where vp.application_id = am.application_id)
), ins as (
  insert into public.vsat_pipeline (application_id, attempt_no, stage, status)
  select application_id, attempt_no, stage, status from src where stage is not null
  returning application_id, attempt_no, stage, status
)
insert into public.vsat_stage_history (application_id, attempt_no, to_stage, to_status, source)
select application_id, attempt_no, stage, status, 'backfill' from ins;

-- ── grants ────────────────────────────────────────────────────────────────────────────
revoke all on public.vsat_pipeline, public.vsat_stage_history, public.vsat_overrides from public, anon, authenticated;

revoke all on function public.vsat__stage_order(text) from public, anon, authenticated;
revoke all on function public.vsat__campus_key(text) from public, anon, authenticated;
revoke all on function public.vsat__legacy_stage(text, text) from public, anon, authenticated;
revoke all on function public.vsat__can_manage(text) from public, anon, authenticated;
revoke all on function public.vsat__is_assigned(text, text, int) from public, anon, authenticated;
revoke all on function public.vsat__can_view(text) from public, anon, authenticated;
revoke all on function public.vsat__effective(text) from public, anon, authenticated;
revoke all on function public.vsat__move(text, text, text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.vsat__move_checked(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.vsat__check_keys(jsonb, text[]) from public, anon, authenticated;
revoke all on function public.vsat__on_application() from public, anon, authenticated;

revoke all on function public.vsat_move_stage(jsonb) from public, anon;
revoke all on function public.vsat_move_bulk(jsonb) from public, anon;
revoke all on function public.vsat_pipeline_list(jsonb) from public, anon;
revoke all on function public.vsat_stage_history_for(text) from public, anon;
revoke all on function public.vsat_set_override(jsonb) from public, anon;
revoke all on function public.vsat_clear_override(jsonb) from public, anon;
grant execute on function public.vsat_move_stage(jsonb) to authenticated;
grant execute on function public.vsat_move_bulk(jsonb) to authenticated;
grant execute on function public.vsat_pipeline_list(jsonb) to authenticated;
grant execute on function public.vsat_stage_history_for(text) to authenticated;
grant execute on function public.vsat_set_override(jsonb) to authenticated;
grant execute on function public.vsat_clear_override(jsonb) to authenticated;
