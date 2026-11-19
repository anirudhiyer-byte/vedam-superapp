-- Rollback of 0117 · Growth · Payment Cohort.
-- 0117 only added two functions (no table, column, RLS or existing function changed), so dropping them restores the
-- state before 0117. Drop order: the public function first, then the helper it calls.

drop function if exists public.growth_cohort_report(jsonb);
drop function if exists public.growth__cohort_data(jsonb, date);
