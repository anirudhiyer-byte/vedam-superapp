-- 0047 · VSAT exam — admin/staff payment bypass (for internal demos)
--
-- Staff = the is_admin() role OR a confirmed @vedam.org login (the SAME definition
-- the /vsat/dashboard and /admin/vsat pages already use). Staff can list and select
-- exam dates WITHOUT a vsat_payments row, so an admin can walk the full exam demo
-- (apply -> mock -> select date -> start exam) without paying. Real students are
-- unaffected: they still need a vsat_payments row.
--
-- Only the two student-facing exam-date RPCs change; the launch API route already
-- bypasses the paid check for @vedam.org logins, and the dashboard treats an admin
-- as paid client-side. vsat_payments stays write-once (webhook/service-role only).
--
-- Rollback: supabase/rollback/0047_vsat_exam_admin_bypass_down.sql

-- ── staff check (is_admin role OR confirmed @vedam.org email) ────────────────
create or replace function public.vsat_is_staff()
returns boolean language sql stable security definer set search_path to '' as $fn$
  select public.is_admin()
      or exists (select 1 from auth.users u
                 where u.id = auth.uid()
                   and lower(u.email) like '%@vedam.org'
                   and u.email_confirmed_at is not null);
$fn$;
revoke all on function public.vsat_is_staff() from public, anon, authenticated, service_role;
grant execute on function public.vsat_is_staff() to authenticated;

-- ── student: enabled exam dates (staff may list without paying) ──────────────
create or replace function public.vsat_exam_open_dates()
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare u uuid := auth.uid(); v jsonb; v_paid boolean;
begin
  if u is null then return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED'); end if;
  v_paid := exists (select 1 from public.vsat_payments vp where vp.lead_id = u);
  if not v_paid and not public.vsat_is_staff() then return jsonb_build_object('ok', false, 'code', 'NOT_PAID'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'label', d.label, 'examDate', d.exam_date, 'startAt', d.start_at, 'endAt', d.end_at,
    'clickableFrom', d.start_at - make_interval(mins => d.clickable_lead_minutes)
  ) order by d.start_at), '[]'::jsonb) into v
  from public.vsat_exam_dates d where d.enabled = true;
  return jsonb_build_object('ok', true, 'dates', v);
end $fn$;

-- ── student: select an exam date (staff may select without paying) ───────────
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
  if not public.vsat_is_staff() and not exists (select 1 from public.vsat_payments vp where vp.lead_id = u) then return jsonb_build_object('ok', false, 'code', 'NOT_PAID'); end if;
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
