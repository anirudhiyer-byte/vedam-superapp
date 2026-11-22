-- Rollback of 0137_growth_vedantu_performance.sql — removes the Vedantu Performance drill. No data is stored by 0137.
drop function if exists public.growth_vd_perf_drill(jsonb);
drop function if exists public.growth__vdperf_people(date, date, text, text);
