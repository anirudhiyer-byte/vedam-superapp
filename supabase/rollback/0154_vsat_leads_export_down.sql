-- Rollback 0154 · drop the leads export RPC.
drop function if exists public.vsat_leads_export(jsonb);