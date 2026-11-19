-- Rollback of 0118_growth_lead_timing.sql: removes the read-only RPC. Nothing else depended on it.
drop function if exists public.growth_lead_timing(jsonb);
