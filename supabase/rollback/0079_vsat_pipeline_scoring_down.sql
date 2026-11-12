-- Rollback for 0079_vsat_pipeline_scoring.sql (STAGING first).
--
-- 0079 only ADDS things, so going down = dropping what it added. Nothing that existed
-- before 0079 is touched. Data typed into the new settings tables (team members, edited
-- bands, weights, campus settings) and the new per-batch columns is lost — export first
-- if anything was entered by hand.
--
-- Run after rolling back any later VSAT pipeline migration that uses these objects.

drop function if exists public.vsat_calc_final_scholarship(numeric, numeric, int, text);
drop function if exists public.vsat_calc_scholarship(jsonb, text, uuid);
drop function if exists public.vsat_calc_interview(numeric, numeric, numeric, numeric, numeric, date);
drop function if exists public.vsat_calc_eligibility(int, int, numeric, numeric, numeric, jsonb);
drop function if exists public.vsat_calc_vps(numeric, jsonb);
drop function if exists public.vsat_my_roles();
drop function if exists public.vsat_has_role(text);

drop table if exists public.vsat_campus_settings;
drop table if exists public.vsat_scholarship_bands;
drop table if exists public.vsat_interview_weights;
drop table if exists public.vsat_team;

alter table public.vsat_exam_settings drop column if exists eligibility;
alter table public.vsat_exam_dates
  drop column if exists vps_anchors,
  drop column if exists cleared_vps_cutoff;
