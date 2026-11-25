-- Rollback 0179 · remove counselling mode (the drawer field, the RPC, the columns).

do $$
declare o oid; d text;
  added constant text := ' ''counselling_mode'', am.counselling_mode,';
begin
  select p.oid into strict o from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'vsat_student';
  d := pg_get_functiondef(o);
  if position(added in d) > 0 then execute replace(d, added, ''); end if;
end $$;

drop function if exists public.vsat_set_counselling_mode(jsonb);

alter table public.application_manager drop constraint if exists application_manager_counselling_mode_check;
alter table public.application_manager
  drop column if exists counselling_mode_at,
  drop column if exists counselling_mode;
