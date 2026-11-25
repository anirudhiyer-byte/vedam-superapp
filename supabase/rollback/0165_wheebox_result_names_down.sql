-- Rollback for 0165_wheebox_result_names.sql.
-- Restores the 4 RPCs to their pre-0165 bodies and drops the 4 columns.
-- (Run the function restores first, then drop the columns they no longer reference.)

create or replace function public.vsat_exam_settings_get()
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare s public.vsat_exam_settings;
begin
  if not public.vsat_is_staff() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  select * into s from public.vsat_exam_settings where id = 1;
  return jsonb_build_object('ok', true, 'settings', jsonb_build_object(
    'mockTestId', s.mock_test_id, 'osrFormat', s.osr_format, 'leadMinutes', s.clickable_lead_minutes,
    'passVpsCutoff', s.pass_vps_cutoff, 'vpsAnchors', s.vps_anchors));
end $function$;

create or replace function public.vsat_exam_settings_set(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare k text;
begin
  if not public.vsat_is_staff() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
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
end $function$;

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
            coalesce(case when jsonb_typeof(p->'leadMinutes') = 'number' then (p->>'leadMinutes')::int end, 15), v_who)
    returning id into v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $function$;

create or replace function public.vsat_exam_dates_admin_list()
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare v jsonb;
begin
  if not public.vsat_is_staff() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'label', d.label, 'testId', d.wheebox_test_id, 'examDate', d.exam_date,
    'startAt', d.start_at, 'endAt', d.end_at, 'leadMinutes', d.clickable_lead_minutes,
    'capacity', d.capacity, 'enabled', d.enabled,
    'picked', (select count(*) from public.application_manager am where am.exam_date_id = d.id)
  ) order by d.start_at), '[]'::jsonb) into v from public.vsat_exam_dates d;
  return jsonb_build_object('ok', true, 'dates', v);
end $function$;

alter table public.vsat_exam_dates    drop column if exists domain_name;
alter table public.vsat_exam_dates    drop column if exists test_name;
alter table public.vsat_exam_settings drop column if exists mock_domain_name;
alter table public.vsat_exam_settings drop column if exists mock_test_name;