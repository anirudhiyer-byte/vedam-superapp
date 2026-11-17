-- Rollback for 0101 — drop the two added columns.
alter table public.application_manager
  drop column if exists jee_percentile,
  drop column if exists olympiad1_year;
