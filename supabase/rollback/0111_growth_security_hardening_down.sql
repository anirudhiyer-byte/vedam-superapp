-- Rollback of 0111_growth_security_hardening.sql — puts back exactly what was there before.
-- NOTE: step 1 re-opens growth_cp_cost_view to anon/authenticated (the state 0111 fixed). Only roll back for a reason.

drop trigger if exists trg_audit_growth_infl_posts on public.growth_infl_posts;
drop trigger if exists trg_audit_growth_influencers on public.growth_influencers;
drop trigger if exists trg_audit_growth_ad_rows on public.growth_ad_rows;
drop trigger if exists trg_audit_growth_custom_columns on public.growth_custom_columns;

alter view public.growth_cp_cost_view reset (security_invoker);
grant all on table public.growth_cp_cost_view to anon, authenticated;
