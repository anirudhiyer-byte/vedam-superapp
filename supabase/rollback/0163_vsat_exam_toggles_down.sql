-- Rollback for 0163_vsat_exam_toggles.sql — restores the 2-key allowed set, drops the student getter.
-- (Leaves the app_flags rows in place; they are inert once the code no longer reads them.)

drop function if exists public.vsat_exam_flags_get();

create or replace function public.vsat_landing_flag_set(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare v_key text := p->>'key'; v_val text := lower(nullif(btrim(p->>'value'),''));
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  if v_key not in ('vsat_public','vsat_legacy_public') then return jsonb_build_object('ok',false,'error','bad_key'); end if;
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
    (select jsonb_object_agg(key, value) from public.app_flags where key in ('vsat_public','vsat_legacy_public')),
    '{}'::jsonb);
end; $function$;
