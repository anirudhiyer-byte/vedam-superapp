-- Rollback 0150 · drop the admin flag-toggle RPC.
drop function if exists public.elevate_set_live(jsonb);
