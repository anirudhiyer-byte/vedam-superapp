-- Rollback for 0159_vsat_leads_grid.sql
-- Drops the five new, isolated functions. Nothing else was touched (no tables, no changes to the
-- application grid engine or to vsat_leads_list / vsat_leads_export), so this fully reverses 0159.

drop function if exists public.vsat_leads_grid_export(jsonb);
drop function if exists public.vsat_leads_grid_list(jsonb);
drop function if exists public.vsat_leads_grid_columns();
drop function if exists public.vsat__leads_grid(jsonb, int, boolean);
drop function if exists public.vsat__leads_grid_catalog();
