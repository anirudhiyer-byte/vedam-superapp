-- Rollback 0047 · restore the exam-date RPCs to the is_admin-only / paid-only
-- checks and drop the vsat_is_staff() helper. Restore the functions FIRST (so they
-- no longer reference the helper), then drop it.

-- ── restore: open dates (is_admin only) ─────────────────────────────────────
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

-- ── restore: select date (paid only) ────────────────────────────────────────
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
    exam_date_id = d.id, application_stage_1 = 'slot_selected', vsat_slot_datetime_1 = d.start_at, last_updated_date = now()
  where lead_id = u;
  insert into public.crm_activity_log (entity_type, application_id, lead_id, action, stage_type, to_value, metadata, actor, path)
  values ('application', v_app.application_id, u, 'stage_change', 'application', 'slot_selected',
          jsonb_build_object('exam_date_id', d.id, 'test_id', d.wheebox_test_id), 'applicant', '/vsat/dashboard');
  return jsonb_build_object('ok', true, 'testId', d.wheebox_test_id, 'startAt', d.start_at, 'endAt', d.end_at);
end $fn$;

drop function if exists public.vsat_is_staff();
