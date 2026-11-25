-- Rollback for 0169_vsat_admin_tools.sql
drop function if exists public.vsat_application_admin_update(jsonb);
drop function if exists public.vsat_application_admin_get(jsonb);
drop function if exists public.vsat_exam_scores_admin_list(jsonb);
drop function if exists public.vsat_mock_reset(jsonb);
drop function if exists public.vsat__am_writable(text);
drop function if exists public.vsat__am_locked_cols();
drop function if exists public.vsat__admin_audit(text, text, uuid, jsonb);
drop table if exists public.vsat_admin_audit;
