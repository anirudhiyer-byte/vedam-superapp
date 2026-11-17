-- Rollback for 0097_vsat_grid.sql
-- Removes the grid RPCs, the private engine / catalogue and the audit log. Nothing else was
-- changed by 0097 (vsat_pipeline_list and the other panel RPCs are untouched).

drop function if exists public.vsat_grid_export(jsonb);
drop function if exists public.vsat_grid_list(jsonb);
drop function if exists public.vsat_grid_columns();
drop function if exists public.vsat__grid(jsonb, int, boolean, boolean);
drop function if exists public.vsat__grid_may_see(text, boolean);
drop function if exists public.vsat__grid_catalog();
drop table if exists public.vsat_grid_audit;
