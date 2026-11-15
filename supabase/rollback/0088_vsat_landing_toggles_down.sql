-- Rollback 0088 · remove the VSAT landing toggle RPCs + the legacy flag.
drop function if exists public.vsat_landing_flags_get();
drop function if exists public.vsat_landing_flag_set(jsonb);
delete from public.app_flags where key = 'vsat_legacy_public';
