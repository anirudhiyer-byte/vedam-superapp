-- 0163 · VSAT exam admin toggles — mock + real-exam on/off (Exam Center).
--
-- Adds two student-facing master switches, flipped by admins exactly like the landing toggles:
--   vsat_mock_enabled  — ON: students see a working "Start mock"; OFF: mock is hidden/coming-soon.
--   vsat_exam_enabled  — ON: the real-exam Start works inside the date window; OFF: disabled for students.
-- Admins always bypass these (and the date window) in /api/vsat/exam/launch. Seeded mock=off, exam=on.
--
-- Extends the existing admin RPCs vsat_landing_flag_set / vsat_landing_flags_get to cover the new keys,
-- and adds vsat_exam_flags_get() so the student dashboard can read just these two (no admin gate).
-- Rollback: supabase/rollback/0163_vsat_exam_toggles_down.sql

insert into public.app_flags(key, value) values ('vsat_mock_enabled','off'), ('vsat_exam_enabled','on')
  on conflict (key) do nothing;

create or replace function public.vsat_landing_flag_set(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare v_key text := p->>'key'; v_val text := lower(nullif(btrim(p->>'value'),''));
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  if v_key not in ('vsat_public','vsat_legacy_public','vsat_mock_enabled','vsat_exam_enabled') then return jsonb_build_object('ok',false,'error','bad_key'); end if;
  if v_val not in ('on','off') then return jsonb_build_object('ok',false,'error','bad_value'); end if;
  update public.app_flags set value = v_val, updated_at = now(), updated_by = coalesce(auth.uid()::text,'admin') where key = v_key;
  if not found then
    insert into public.app_flags(key, value, updated_at, updated_by) values (v_key, v_val, now(), coalesce(auth.uid()::text,'admin'));
  end if;
  return jsonb_build_object('ok', true, 'key', v_key, 'value', v_val);
end; $function$;

create or replace function public.vsat_landing_flags_get()
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  return coalesce(
    (select jsonb_object_agg(key, value) from public.app_flags
      where key in ('vsat_public','vsat_legacy_public','vsat_mock_enabled','vsat_exam_enabled')),
    '{}'::jsonb);
end; $function$;

-- student-readable (no admin gate): just the two exam switches, so the dashboard can show/hide Start.
create or replace function public.vsat_exam_flags_get()
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
begin
  return jsonb_build_object(
    'mock', coalesce((select value from public.app_flags where key='vsat_mock_enabled'),'off'),
    'exam', coalesce((select value from public.app_flags where key='vsat_exam_enabled'),'on'));
end; $function$;
revoke all on function public.vsat_exam_flags_get() from public, anon;
grant execute on function public.vsat_exam_flags_get() to authenticated;
