-- Rollback for 0170_vsat_app_bulk_update.sql
drop function if exists public.vsat_app_bulk_update(jsonb);
