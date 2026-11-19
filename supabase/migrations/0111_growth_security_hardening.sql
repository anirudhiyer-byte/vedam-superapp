-- 0111 · Growth security hardening (found by the Supabase security advisor on staging, 19 Nov 2026)
--
-- 1. public.growth_cp_cost_view (College Predictor cost, from 0012/0020/0021/0044) was a SECURITY DEFINER view
--    with ALL privileges for anon + authenticated: anyone with the public API key could read every cost row
--    (spend, CPL, UTM links, created_by) through /rest/v1/growth_cp_cost_view, bypassing RLS.
--    The app reads it only with the service role (src/app/api/growth/predictor/cost/route.ts → svc()),
--    so the browser roles lose access and the view now runs with the caller's rights. No other view or
--    function depends on it.
-- 2. Audit history for the Ads / Influencers tables of 0105, same trigger as every other admin table.
--
-- Rollback: supabase/rollback/0111_growth_security_hardening_down.sql

alter view public.growth_cp_cost_view set (security_invoker = on);
revoke all on table public.growth_cp_cost_view from public, anon, authenticated;

create trigger trg_audit_growth_custom_columns
  after insert or update or delete on public.growth_custom_columns
  for each row execute function public.audit_trigger();
create trigger trg_audit_growth_ad_rows
  after insert or update or delete on public.growth_ad_rows
  for each row execute function public.audit_trigger();
create trigger trg_audit_growth_influencers
  after insert or update or delete on public.growth_influencers
  for each row execute function public.audit_trigger();
create trigger trg_audit_growth_infl_posts
  after insert or update or delete on public.growth_infl_posts
  for each row execute function public.audit_trigger();
