-- 0165 · Store the Wheebox result lookup keys (test name + domain name) that the result API
-- needs — they are per-test constants, not derivable from the company code / test id.
--
-- The Wheebox RESULT API is keyed by domainName + testName (strings, e.g. testName "VSAT",
-- domainName "April 2026"), NOT the numeric test id. Until now the result pull fell back to the
-- company code + test id, so it returned "no such domain name/test name found". We now store the
-- pair per test: on vsat_exam_settings for the mock, and on each vsat_exam_dates row for the exam.
--
-- Extends the admin RPCs vsat_exam_settings_get/_set (mockTestName, mockDomainName) and
-- vsat_exam_date_upsert / vsat_exam_dates_admin_list (testName, domainName). Additive columns.
-- Rollback: supabase/rollback/0165_wheebox_result_names_down.sql

alter table public.vsat_exam_settings add column if not exists mock_test_name   text;
alter table public.vsat_exam_settings add column if not exists mock_domain_name text;
alter table public.vsat_exam_dates    add column if not exists test_name        text;
alter table public.vsat_exam_dates    add column if not exists domain_name      text;

-- ── settings get: expose the mock test name + domain ────────────────────────────────────────
create or replace function public.vsat_exam_settings_get()
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare s public.vsat_exam_settings;
begin
  if not public.vsat_is_staff() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  select * into s from public.vsat_exam_settings where id = 1;
  return jsonb_build_object('ok', true, 'settings', jsonb_build_object(
    'mockTestId', s.mock_test_id, 'mockTestName', s.mock_test_name, 'mockDomainName', s.mock_domain_name,
    'osrFormat', s.osr_format, 'leadMinutes', s.clickable_lead_minutes,
    'passVpsCutoff', s.pass_vps_cutoff, 'vpsAnchors', s.vps_anchors));
end $function$;

-- ── settings set: accept the two new keys ───────────────────────────────────────────────────
create or replace function public.vsat_exam_settings_set(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare k text;
begin
  if not public.vsat_is_staff() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if p is null or jsonb_typeof(p) <> 'object' or octet_length(p::text) > 8000 then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('mockTestId','mockTestName','mockDomainName','osrFormat','leadMinutes','passVpsCutoff','vpsAnchors') then
      return jsonb_build_object('ok', false, 'code', 'INVALID');
    end if;
  end loop;
  if p ? 'vpsAnchors' and jsonb_typeof(p->'vpsAnchors') is distinct from 'array' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ANCHORS');
  end if;
  update public.vsat_exam_settings set
    mock_test_id = case when p ? 'mockTestId' then nullif(btrim(p->>'mockTestId'),'') else mock_test_id end,
    mock_test_name = case when p ? 'mockTestName' then nullif(btrim(p->>'mockTestName'),'') else mock_test_name end,
    mock_domain_name = case when p ? 'mockDomainName' then nullif(btrim(p->>'mockDomainName'),'') else mock_domain_name end,
    osr_format   = case when p ? 'osrFormat' then coalesce(nullif(btrim(p->>'osrFormat'),''),'o') else osr_format end,
    clickable_lead_minutes = case when jsonb_typeof(p->'leadMinutes') = 'number' then (p->>'leadMinutes')::int else clickable_lead_minutes end,
    pass_vps_cutoff = case when jsonb_typeof(p->'passVpsCutoff') = 'number' then (p->>'passVpsCutoff')::numeric
                           when p ? 'passVpsCutoff' then null else pass_vps_cutoff end,
    vps_anchors = case when p ? 'vpsAnchors' then p->'vpsAnchors' else vps_anchors end,
    updated_by = (select coalesce(nullif(u.raw_user_meta_data->>'full_name',''), u.email) from auth.users u where u.id = auth.uid()),
    updated_at = now()
  where id = 1;
  return jsonb_build_object('ok', true);
end $function$;

-- ── exam date upsert: accept + store testName / domainName ───────────────────────────────────
create or replace function public.vsat_exam_date_upsert(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  k text; v_id uuid; v_start timestamptz; v_end timestamptz; v_who text;
begin
  if not public.vsat_is_staff() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if p is null or jsonb_typeof(p) <> 'object' or octet_length(p::text) > 8000 then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('id','label','testId','testName','domainName','examDate','startAt','endAt','capacity','leadMinutes') then
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
      test_name = case when p ? 'testName' then nullif(btrim(p->>'testName'),'') else test_name end,
      domain_name = case when p ? 'domainName' then nullif(btrim(p->>'domainName'),'') else domain_name end,
      exam_date = (p->>'examDate')::date, start_at = v_start, end_at = v_end,
      capacity = case when jsonb_typeof(p->'capacity') = 'number' then (p->>'capacity')::int else capacity end,
      clickable_lead_minutes = case when jsonb_typeof(p->'leadMinutes') = 'number' then (p->>'leadMinutes')::int else clickable_lead_minutes end,
      updated_at = now()
     where id = v_id;
    if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  else
    insert into public.vsat_exam_dates (label, wheebox_test_id, test_name, domain_name, exam_date, start_at, end_at, capacity, clickable_lead_minutes, created_by)
    values (btrim(p->>'label'), btrim(p->>'testId'),
            nullif(btrim(p->>'testName'),''), nullif(btrim(p->>'domainName'),''),
            (p->>'examDate')::date, v_start, v_end,
            case when jsonb_typeof(p->'capacity') = 'number' then (p->>'capacity')::int end,
            coalesce(case when jsonb_typeof(p->'leadMinutes') = 'number' then (p->>'leadMinutes')::int end, 15), v_who)
    returning id into v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $function$;

-- ── exam date admin list: return testName / domainName ───────────────────────────────────────
create or replace function public.vsat_exam_dates_admin_list()
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare v jsonb;
begin
  if not public.vsat_is_staff() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'label', d.label, 'testId', d.wheebox_test_id,
    'testName', d.test_name, 'domainName', d.domain_name,
    'examDate', d.exam_date, 'startAt', d.start_at, 'endAt', d.end_at, 'leadMinutes', d.clickable_lead_minutes,
    'capacity', d.capacity, 'enabled', d.enabled,
    'picked', (select count(*) from public.application_manager am where am.exam_date_id = d.id)
  ) order by d.start_at), '[]'::jsonb) into v from public.vsat_exam_dates d;
  return jsonb_build_object('ok', true, 'dates', v);
end $function$;