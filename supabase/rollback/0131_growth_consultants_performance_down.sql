-- Rollback of 0131_growth_consultants_performance.sql — removes everything 0131 added. Nothing else was changed by 0131
-- (0130 and the Ads / Influencers / Overview pages are untouched), so after this file the database is exactly as before it.
-- WARNING: drops the city targets (growth_cons_city_targets) for good. Export them first if they hold real data.

drop function if exists public.growth_cons_city_target_set(jsonb);
drop function if exists public.growth_cons_city_targets_get(jsonb);
drop function if exists public.growth_cons_perf_students(jsonb);
drop function if exists public.growth_cons_perf(jsonb);

drop function if exists public.growth__cons_window(jsonb);
drop function if exists public.growth__cons_people(text);
drop function if exists public.growth__cons_stage(uuid);
drop function if exists public.growth__cons_in(date, date, date);

drop trigger if exists trg_audit_growth_cons_city_targets on public.growth_cons_city_targets;
drop table if exists public.growth_cons_city_targets;
