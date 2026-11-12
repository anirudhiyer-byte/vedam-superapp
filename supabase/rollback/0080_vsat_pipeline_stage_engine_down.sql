-- Rollback for 0080_vsat_pipeline_stage_engine.sql (STAGING first).
--
-- 0080 only ADDS things (tables, functions, one trigger on application_manager), so going
-- down = dropping them. Lost on the way down: pipeline stages, stage history and overrides.
-- NOT undone: values the engine already copied into application_manager.application_stage_1/2
-- and lead_manager.lead_stage (they are ordinary stage values and stay as they are).
-- Run before rolling back 0079.

drop trigger if exists trg_vsat_pipeline_sync on public.application_manager;

drop function if exists public.vsat_clear_override(jsonb);
drop function if exists public.vsat_set_override(jsonb);
drop function if exists public.vsat_stage_history_for(text);
drop function if exists public.vsat_pipeline_list(jsonb);
drop function if exists public.vsat_move_bulk(jsonb);
drop function if exists public.vsat_move_stage(jsonb);
drop function if exists public.vsat__on_application();
drop function if exists public.vsat__check_keys(jsonb, text[]);
drop function if exists public.vsat__move_checked(text, text, text, text, text, text);
drop function if exists public.vsat__move(text, text, text, text, text, uuid, text);
drop function if exists public.vsat__effective(text);
drop function if exists public.vsat__can_view(text);
drop function if exists public.vsat__is_assigned(text, text, int);
drop function if exists public.vsat__can_manage(text);
drop function if exists public.vsat__legacy_stage(text, text);
drop function if exists public.vsat__campus_key(text);
drop function if exists public.vsat__stage_order(text);

drop table if exists public.vsat_overrides;
drop table if exists public.vsat_stage_history;
drop table if exists public.vsat_pipeline;
