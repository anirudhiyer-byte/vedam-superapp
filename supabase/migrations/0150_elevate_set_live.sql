-- 0150 · Admin RPC to flip the Elevate webhook flag from the UI (Growth → Calling → Elevate).
-- Security in the DB (CLAUDE.md): SECURITY DEFINER, is_admin() gate, set search_path to ''.
-- The browser never writes app_flags directly — it calls this, which re-checks admin.
-- Rollback: supabase/rollback/0150_elevate_set_live_down.sql

create or replace function public.elevate_set_live(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_on boolean;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  v_on := coalesce((p->>'on')::boolean, false);
  insert into public.app_flags (key, value, updated_at, updated_by)
    values ('elevate_webhook', case when v_on then 'on' else 'off' end, now(), auth.uid()::text)
    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid()::text;
  return jsonb_build_object('ok', true, 'flag', case when v_on then 'on' else 'off' end);
end $fn$;
revoke all on function public.elevate_set_live(jsonb) from public, anon;
grant execute on function public.elevate_set_live(jsonb) to authenticated;
