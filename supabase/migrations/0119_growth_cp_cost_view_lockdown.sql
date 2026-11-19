-- 0119 · Hotfix: lock down growth_cp_cost_view (College Predictor cost) on production
--
-- The view was a SECURITY DEFINER view with ALL privileges for anon + authenticated, so anyone with
-- the public API key could read (and through the view possibly write) the College Predictor cost rows
-- via /rest/v1/growth_cp_cost_view, bypassing RLS. Found by the Supabase security advisor on staging
-- (19 Nov 2026) and fixed there by step 1 of 0111_growth_security_hardening.
--
-- This file is ONLY that step, so it can ship to production on its own: the rest of 0111 (audit
-- triggers on the 0105 Ads / Influencers tables) needs tables production does not have yet.
-- Both statements are idempotent, so running 0111 later on production is still safe.
--
-- The app reads the view only with the service role (src/app/api/growth/predictor/cost/route.ts →
-- svc()), which bypasses RLS, so nothing in the app changes. No other view or function uses it.
--
-- Rollback: supabase/rollback/0119_growth_cp_cost_view_lockdown_down.sql

alter view public.growth_cp_cost_view set (security_invoker = on);
revoke all on table public.growth_cp_cost_view from public, anon, authenticated;
