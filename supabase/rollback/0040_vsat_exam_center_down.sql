-- Rollback 0040 · VSAT Exam Center
-- Drops the rpcs, the exam columns on application_manager, and the exam tables.
-- NOTE: the enum value vm_app_stage.'mock_enabled' is left in place — PostgreSQL
-- cannot drop an enum value; it is harmless when unused.
-- Destructive: stored exam results, dates, settings and per-applicant exam data.

drop function if exists public.vsat_exam_bulk_result(jsonb);
drop function if exists public.vsat_exam_select_date(jsonb);
drop function if exists public.vsat_exam_open_dates();
drop function if exists public.vsat_exam_settings_set(jsonb);
drop function if exists public.vsat_exam_settings_get();
drop function if exists public.vsat_exam_dates_admin_list();
drop function if exists public.vsat_exam_date_set_enabled(jsonb);
drop function if exists public.vsat_exam_date_upsert(jsonb);

alter table public.application_manager
  drop column if exists wheebox_login_id,
  drop column if exists wheebox_registered,
  drop column if exists exam_date_id,
  drop column if exists exam_assigned,
  drop column if exists exam_given,
  drop column if exists mock_assigned,
  drop column if exists mock_given,
  drop column if exists mock_result,
  drop column if exists exam_overall,
  drop column if exists exam_sections,
  drop column if exists exam_obtained_marks,
  drop column if exists exam_max_marks,
  drop column if exists exam_percentile,
  drop column if exists vps_score;

drop table if exists public.vsat_exam_results;
drop table if exists public.vsat_exam_settings;
drop table if exists public.vsat_exam_dates;
