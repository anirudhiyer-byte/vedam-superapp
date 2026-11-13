-- Rollback for 0085_vsat_profile_analyser.sql
-- Removes the three functions, the run log and the four profile columns 0085 added to
-- counselling_assignments (none of them existed before 0085 — checked on staging before applying).
-- Saved briefings are lost; regenerate them after re-applying 0085.

drop function if exists public.vsat_profile_fail(uuid, text);
drop function if exists public.vsat_profile_save(uuid, text, text);
drop function if exists public.vsat_profile_start(text);
drop table if exists public.vsat_profile_runs;
alter table public.counselling_assignments
  drop column if exists profile_model,
  drop column if exists profile_generated_by,
  drop column if exists profile_generated_at,
  drop column if exists profile_analysis;
