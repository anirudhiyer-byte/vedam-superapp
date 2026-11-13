-- Rollback for 0085_vsat_profile_analyser.sql
-- Removes the three functions and the run log. counselling_assignments.profile_analysis existed
-- before 0085 (jsonb) and is left as it is; briefings saved there stay (no function writes them
-- once 0085 is rolled back).

drop function if exists public.vsat_profile_fail(uuid, text);
drop function if exists public.vsat_profile_save(uuid, text, text);
drop function if exists public.vsat_profile_start(text);
drop table if exists public.vsat_profile_runs;
