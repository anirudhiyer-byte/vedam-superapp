-- Rollback for 0093_vsat_admin_lists.sql
drop function if exists public.vsat_applications_list(jsonb);
drop function if exists public.vsat_leads_list(jsonb);
