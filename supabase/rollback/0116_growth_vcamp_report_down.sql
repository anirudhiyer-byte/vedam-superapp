-- Rollback of 0116 · Growth · VSAT Campaign Report.
-- 0116 only added functions (no table, column, RLS or existing function changed), so dropping them restores the
-- state before 0116. Drop order: the public function first, then the helpers it calls.

drop function if exists public.growth_vcamp_report(jsonb);
drop function if exists public.growth__vcamp_data(uuid, date);
drop function if exists public.growth__vcamp_default(date);
drop function if exists public.growth__paid_rows(date, date);
drop function if exists public.growth__lead_rows(date, date);
drop function if exists public.growth__campus(text);
