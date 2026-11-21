-- Rollback of 0134_growth_telegram_performance.sql — removes the Telegram Performance functions. No table or data changes.

drop function if exists public.growth_tg_perf_students(jsonb);
drop function if exists public.growth_tg_perf(jsonb);
drop function if exists public.growth_tg_perf_meta(jsonb);
drop function if exists public.growth__tgperf_filter(jsonb);
drop function if exists public.growth__tgperf_people(uuid, text);
