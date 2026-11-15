-- 0088 · VSAT landing-page visibility toggles (admin-controlled).
--
-- Two independent flags drive who can see each landing page:
--   vsat_public         → the NEW VSAT signup landing at /apply   (on = everyone, off = admins only)
--   vsat_legacy_public  → the OLD early-registration form at /vsat (on = everyone, off = admins only)
--
-- Defaults keep production safe on deploy: vsat_public starts 'off' (0087) and
-- vsat_legacy_public starts 'on', so the early-reg stays publicly reachable until
-- go-live, when an admin flips vsat_public → on and vsat_legacy_public → off.
--
-- Admin-only SECURITY DEFINER RPCs power the toggle buttons (no raw SQL needed).

insert into public.app_flags (key, value, updated_at, updated_by)
select 'vsat_legacy_public', 'on', now(), '0088_migration'
where not exists (select 1 from public.app_flags where key = 'vsat_legacy_public');

create or replace function public.vsat_landing_flags_get()
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  return coalesce(
    (select jsonb_object_agg(key, value) from public.app_flags where key in ('vsat_public','vsat_legacy_public')),
    '{}'::jsonb);
end; $fn$;
revoke execute on function public.vsat_landing_flags_get() from public, anon;
grant execute on function public.vsat_landing_flags_get() to authenticated;

create or replace function public.vsat_landing_flag_set(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
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
end; $fn$;
revoke execute on function public.vsat_landing_flag_set(jsonb) from public, anon;
grant execute on function public.vsat_landing_flag_set(jsonb) to authenticated;
