-- 0040 · VSAT Exam Center (Wheebox) — exam dates, results ledger, settings, rpcs
--
-- Admin locks a Wheebox test ID to each exam date + window and enables it; only
-- enabled dates are offered to paid applicants. On selecting a date the applicant
-- moves to slot_selected and is assigned that date's test (the Wheebox register/
-- assign + the start-exam link + the result callback are server API routes that
-- use these columns; this migration is the data layer only).
--
-- Student NEVER sees raw Wheebox marks: the raw/overall/section results are stored
-- for admins only; the student sees a VPS score (computed in code from percentile).
-- Mock results ARE shown to the student.
--
-- Wheebox credentials (company code / access token / private key / base url) are
-- NOT stored here — they are server-only env vars. This table holds only the
-- non-secret exam config (mock test id, OSR, VPS anchors, clickable lead).
--
-- NOTE: the `alter type ... add value 'mock_enabled'` is applied as its own
-- statement before the rest (an enum value can't be added and used in one txn).
-- Rollback: supabase/rollback/0040_vsat_exam_center_down.sql

alter type public.vm_app_stage add value if not exists 'mock_enabled';

-- ── exam dates (admin-created, one Wheebox test id each) ────────────────────
create table if not exists public.vsat_exam_dates (
  id               uuid primary key default gen_random_uuid(),
  label            text not null check (char_length(label) between 1 and 160),
  wheebox_test_id  text not null check (char_length(wheebox_test_id) between 1 and 64),
  exam_date        date not null,
  start_at         timestamptz not null,      -- window opens (exam start)
  end_at           timestamptz not null,      -- window closes
  clickable_lead_minutes int not null default 15 check (clickable_lead_minutes between 0 and 240),
  capacity         int check (capacity is null or capacity >= 0),
  enabled          boolean not null default false,  -- enabled => offered on the dashboard
  created_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (end_at > start_at)
);
alter table public.vsat_exam_dates enable row level security;
revoke all on table public.vsat_exam_dates from public, anon, authenticated;
grant select, insert, update on table public.vsat_exam_dates to service_role;

-- ── raw result ledger (ADMIN ONLY — never exposed to students) ──────────────
create table if not exists public.vsat_exam_results (
  id               uuid primary key default gen_random_uuid(),
  application_id   text,
  lead_id          uuid,
  wheebox_test_id  text,
  is_mock          boolean not null default false,
  overall_result   text,                 -- Pass / Fail / etc as Wheebox reports
  obtained_marks   numeric,
  max_marks        numeric,
  percentile       numeric,
  sections         jsonb not null default '{}'::jsonb,  -- sectionName -> marks (math/cs/logical)
  raw              jsonb not null default '{}'::jsonb,   -- full decrypted callback
  received_at      timestamptz not null default now()
);
alter table public.vsat_exam_results enable row level security;
revoke all on table public.vsat_exam_results from public, anon, authenticated;
grant select, insert, update on table public.vsat_exam_results to service_role;

-- ── exam-center settings (singleton; non-secret config) ─────────────────────
create table if not exists public.vsat_exam_settings (
  id               int primary key default 1 check (id = 1),
  mock_test_id     text,
  osr_format       text not null default 'o',
  clickable_lead_minutes int not null default 15,
  pass_vps_cutoff  numeric,              -- optional convenience for bulk select
  vps_anchors      jsonb not null default '[{"percentile":0,"vps":0},{"percentile":50,"vps":7.5},{"percentile":100,"vps":10}]'::jsonb,
  updated_by       text,
  updated_at       timestamptz not null default now()
);
alter table public.vsat_exam_settings enable row level security;
revoke all on table public.vsat_exam_settings from public, anon, authenticated;
grant select, insert, update on table public.vsat_exam_settings to service_role;
insert into public.vsat_exam_settings (id) values (1) on conflict (id) do nothing;

-- ── exam columns on the application (all per-student data lives here) ────────
alter table public.application_manager
  add column if not exists wheebox_login_id   text,
  add column if not exists wheebox_registered boolean not null default false,
  add column if not exists exam_date_id        uuid references public.vsat_exam_dates(id) on delete set null,
  add column if not exists exam_assigned        boolean not null default false,
  add column if not exists exam_given           boolean not null default false,
  add column if not exists mock_assigned         boolean not null default false,
  add column if not exists mock_given            boolean not null default false,
  add column if not exists mock_result           jsonb,        -- shown to the student
  add column if not exists exam_overall          text,         -- admin only
  add column if not exists exam_sections         jsonb,        -- admin only (math/cs/logical)
  add column if not exists exam_obtained_marks   numeric,      -- admin only
  add column if not exists exam_max_marks         numeric,     -- admin only
  add column if not exists exam_percentile        numeric,     -- admin only
  add column if not exists vps_score              numeric;     -- student-visible

-- ── admin: create / update an exam date ─────────────────────────────────────
create or replace function public.vsat_exam_date_upsert(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  k text; v_id uuid; v_start timestamptz; v_end timestamptz; v_who text;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if p is null or jsonb_typeof(p) <> 'object' or octet_length(p::text) > 8000 then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('id','label','testId','examDate','startAt','endAt','capacity','leadMinutes') then
      return jsonb_build_object('ok', false, 'code', 'INVALID');
    end if;
  end loop;
  if jsonb_typeof(p->'label') is distinct from 'string' or jsonb_typeof(p->'testId') is distinct from 'string'
     or jsonb_typeof(p->'examDate') is distinct from 'string' or jsonb_typeof(p->'startAt') is distinct from 'string'
     or jsonb_typeof(p->'endAt') is distinct from 'string' then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;
  begin v_start := (p->>'startAt')::timestamptz; v_end := (p->>'endAt')::timestamptz;
  exception when others then return jsonb_build_object('ok', false, 'code', 'INVALID_DATE'); end;
  if v_end <= v_start then return jsonb_build_object('ok', false, 'code', 'BAD_WINDOW'); end if;

  select coalesce(nullif(u.raw_user_meta_data->>'full_name',''), u.email) into v_who from auth.users u where u.id = auth.uid();

  if p ? 'id' and jsonb_typeof(p->'id') = 'string' then
    if lower(p->>'id') !~ c_uuid then return jsonb_build_object('ok', false, 'code', 'INVALID'); end if;
    v_id := (p->>'id')::uuid;
    update public.vsat_exam_dates set
      label = btrim(p->>'label'), wheebox_test_id = btrim(p->>'testId'),
      exam_date = (p->>'examDate')::date, start_at = v_start, end_at = v_end,
      capacity = case when jsonb_typeof(p->'capacity') = 'number' then (p->>'capacity')::int else capacity end,
      clickable_lead_minutes = case when jsonb_typeof(p->'leadMinutes') = 'number' then (p->>'leadMinutes')::int else clickable_lead_minutes end,
      updated_at = now()
     where id = v_id;
    if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  else
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at, capacity, clickable_lead_minutes, created_by)
    values (btrim(p->>'label'), btrim(p->>'testId'), (p->>'examDate')::date, v_start, v_end,
            case when jsonb_typeof(p->'capacity') = 'number' then (p->>'capacity')::int end,
            coalesce(case when jsonb_typeof(p->'leadMinutes') = 'number' then (p->>'leadMinutes')::int end, 15),
            v_who)
    returning id into v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $fn$;

-- ── admin: enable / disable an exam date ────────────────────────────────────
create or replace function public.vsat_exam_date_set_enabled(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if p is null or lower(coalesce(p->>'id','')) !~ c_uuid or jsonb_typeof(p->'enabled') <> 'boolean' then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;
  update public.vsat_exam_dates set enabled = (p->>'enabled')::boolean, updated_at = now() where id = (p->>'id')::uuid;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  return jsonb_build_object('ok', true);
end $fn$;

-- ── admin: list all exam dates (+ how many picked each) ──────────────────────
create or replace function public.vsat_exam_dates_admin_list()
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare v jsonb;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'label', d.label, 'testId', d.wheebox_test_id, 'examDate', d.exam_date,
    'startAt', d.start_at, 'endAt', d.end_at, 'leadMinutes', d.clickable_lead_minutes,
    'capacity', d.capacity, 'enabled', d.enabled,
    'picked', (select count(*) from public.application_manager am where am.exam_date_id = d.id)
  ) order by d.start_at), '[]'::jsonb) into v from public.vsat_exam_dates d;
  return jsonb_build_object('ok', true, 'dates', v);
end $fn$;

-- ── admin: read / write exam-center settings ────────────────────────────────
create or replace function public.vsat_exam_settings_get()
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare s public.vsat_exam_settings;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  select * into s from public.vsat_exam_settings where id = 1;
  return jsonb_build_object('ok', true, 'settings', jsonb_build_object(
    'mockTestId', s.mock_test_id, 'osrFormat', s.osr_format, 'leadMinutes', s.clickable_lead_minutes,
    'passVpsCutoff', s.pass_vps_cutoff, 'vpsAnchors', s.vps_anchors));
end $fn$;

create or replace function public.vsat_exam_settings_set(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare k text;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if p is null or jsonb_typeof(p) <> 'object' or octet_length(p::text) > 8000 then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('mockTestId','osrFormat','leadMinutes','passVpsCutoff','vpsAnchors') then
      return jsonb_build_object('ok', false, 'code', 'INVALID');
    end if;
  end loop;
  if p ? 'vpsAnchors' and jsonb_typeof(p->'vpsAnchors') is distinct from 'array' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ANCHORS');
  end if;
  update public.vsat_exam_settings set
    mock_test_id = case when p ? 'mockTestId' then nullif(btrim(p->>'mockTestId'),'') else mock_test_id end,
    osr_format   = case when p ? 'osrFormat' then coalesce(nullif(btrim(p->>'osrFormat'),''),'o') else osr_format end,
    clickable_lead_minutes = case when jsonb_typeof(p->'leadMinutes') = 'number' then (p->>'leadMinutes')::int else clickable_lead_minutes end,
    pass_vps_cutoff = case when jsonb_typeof(p->'passVpsCutoff') = 'number' then (p->>'passVpsCutoff')::numeric
                           when p ? 'passVpsCutoff' then null else pass_vps_cutoff end,
    vps_anchors = case when p ? 'vpsAnchors' then p->'vpsAnchors' else vps_anchors end,
    updated_by = (select coalesce(nullif(u.raw_user_meta_data->>'full_name',''), u.email) from auth.users u where u.id = auth.uid()),
    updated_at = now()
  where id = 1;
  return jsonb_build_object('ok', true);
end $fn$;

-- ── student: enabled exam dates to choose from ──────────────────────────────
create or replace function public.vsat_exam_open_dates()
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare u uuid := auth.uid(); v jsonb; v_paid boolean;
begin
  if u is null then return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED'); end if;
  v_paid := exists (select 1 from public.vsat_payments vp where vp.lead_id = u);
  if not v_paid and not public.is_admin() then return jsonb_build_object('ok', false, 'code', 'NOT_PAID'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'label', d.label, 'examDate', d.exam_date, 'startAt', d.start_at, 'endAt', d.end_at,
    'clickableFrom', d.start_at - make_interval(mins => d.clickable_lead_minutes)
  ) order by d.start_at), '[]'::jsonb) into v
  from public.vsat_exam_dates d where d.enabled = true;
  return jsonb_build_object('ok', true, 'dates', v);
end $fn$;

-- ── student: select an exam date (-> slot_selected; assign happens server-side) ─
create or replace function public.vsat_exam_select_date(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  u uuid := auth.uid(); d public.vsat_exam_dates; v_app public.application_manager;
begin
  if u is null then return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED'); end if;
  if p is null or lower(coalesce(p->>'dateId','')) !~ c_uuid then return jsonb_build_object('ok', false, 'code', 'INVALID'); end if;
  select * into v_app from public.application_manager where lead_id = u limit 1;
  if v_app.application_id is null then return jsonb_build_object('ok', false, 'code', 'NOT_AN_APPLICANT'); end if;
  if not exists (select 1 from public.vsat_payments vp where vp.lead_id = u) then return jsonb_build_object('ok', false, 'code', 'NOT_PAID'); end if;
  select * into d from public.vsat_exam_dates where id = (p->>'dateId')::uuid and enabled = true;
  if d.id is null then return jsonb_build_object('ok', false, 'code', 'DATE_UNAVAILABLE'); end if;
  if d.capacity is not null and (select count(*) from public.application_manager am where am.exam_date_id = d.id and am.lead_id <> u) >= d.capacity then
    return jsonb_build_object('ok', false, 'code', 'DATE_FULL');
  end if;

  update public.application_manager set
    exam_date_id = d.id, application_stage_1 = 'slot_selected', vsat_slot_datetime_1 = d.start_at,
    last_updated_date = now()
  where lead_id = u;

  insert into public.crm_activity_log (entity_type, application_id, lead_id, action, stage_type, to_value, metadata, actor, path)
  values ('application', v_app.application_id, u, 'stage_change', 'application', 'slot_selected',
          jsonb_build_object('exam_date_id', d.id, 'test_id', d.wheebox_test_id), 'applicant', '/vsat/dashboard');

  -- test id + window returned so the server route can register/assign on Wheebox
  return jsonb_build_object('ok', true, 'testId', d.wheebox_test_id, 'startAt', d.start_at, 'endAt', d.end_at);
end $fn$;

-- ── admin: bulk push VSAT result stage (cleared / not_cleared) ──────────────
create or replace function public.vsat_exam_bulk_result(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_result text; v_ids jsonb; n int;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if p is null or (p->>'result') not in ('vsat_cleared','vsat_not_cleared') or jsonb_typeof(p->'applicationIds') <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;
  v_result := p->>'result'; v_ids := p->'applicationIds';
  update public.application_manager set application_stage_1 = v_result::public.vm_app_stage, last_updated_date = now()
   where application_id in (select jsonb_array_elements_text(v_ids));
  get diagnostics n = row_count;
  insert into public.crm_activity_log (entity_type, lead_id, action, stage_type, to_value, metadata, actor, path)
  select 'application', am.lead_id, 'stage_change', 'application', v_result,
         jsonb_build_object('bulk', true), 'admin', '/admin/vsat-exam'
    from public.application_manager am where am.application_id in (select jsonb_array_elements_text(v_ids));
  return jsonb_build_object('ok', true, 'updated', n);
end $fn$;

-- ── grants: rpcs callable by logged-in users; checks live inside ────────────
revoke all on function public.vsat_exam_date_upsert(jsonb)       from public, anon, authenticated, service_role;
revoke all on function public.vsat_exam_date_set_enabled(jsonb)  from public, anon, authenticated, service_role;
revoke all on function public.vsat_exam_dates_admin_list()       from public, anon, authenticated, service_role;
revoke all on function public.vsat_exam_settings_get()           from public, anon, authenticated, service_role;
revoke all on function public.vsat_exam_settings_set(jsonb)      from public, anon, authenticated, service_role;
revoke all on function public.vsat_exam_open_dates()             from public, anon, authenticated, service_role;
revoke all on function public.vsat_exam_select_date(jsonb)       from public, anon, authenticated, service_role;
revoke all on function public.vsat_exam_bulk_result(jsonb)       from public, anon, authenticated, service_role;

grant execute on function public.vsat_exam_date_upsert(jsonb)      to authenticated;
grant execute on function public.vsat_exam_date_set_enabled(jsonb) to authenticated;
grant execute on function public.vsat_exam_dates_admin_list()      to authenticated;
grant execute on function public.vsat_exam_settings_get()          to authenticated;
grant execute on function public.vsat_exam_settings_set(jsonb)     to authenticated;
grant execute on function public.vsat_exam_open_dates()            to authenticated;
grant execute on function public.vsat_exam_select_date(jsonb)      to authenticated;
grant execute on function public.vsat_exam_bulk_result(jsonb)      to authenticated;
