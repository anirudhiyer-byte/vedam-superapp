-- Rollback of 0119_growth_cp_cost_view_lockdown.sql: puts back exactly what was there before.
-- WARNING: this re-opens growth_cp_cost_view to anon / authenticated (the hole 0119 closed). Only roll back for a reason.
alter view public.growth_cp_cost_view reset (security_invoker);
grant all on table public.growth_cp_cost_view to anon, authenticated;
