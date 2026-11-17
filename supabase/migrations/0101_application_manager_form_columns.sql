-- 0101 · application_manager — two columns the VSAT form maps to that didn't exist yet.
--   • jee_percentile    — overall JEE Mains percentile (the maths-specific one already
--                         exists as jee_main_maths_percentile).
--   • olympiad1_year    — year the olympiad was given (we store the year as a number,
--                         not a date; olympiad1_date stays for anyone who wants a date).
-- Additive, nullable — safe on a live table.

alter table public.application_manager
  add column if not exists jee_percentile numeric,
  add column if not exists olympiad1_year integer;
