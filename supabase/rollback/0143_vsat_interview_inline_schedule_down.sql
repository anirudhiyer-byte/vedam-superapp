-- Rollback for 0143_vsat_interview_inline_schedule.sql (staging first).
-- Drops the row-booking functions, the trigger and the typed-values table. Nothing else changes: interviews
-- already booked from the panel stay booked (they are ordinary 0140 interviews). Typed, not-sent values are lost.

drop function if exists public.vsat_interview_drafts_send(jsonb);
drop function if exists public.vsat_interview_drafts_fill(jsonb);
drop function if exists public.vsat_interview_draft_set(jsonb);
drop function if exists public.vsat_interview_plan(jsonb);

drop trigger if exists vsat_interview_drafts_clear on public.interview_assignments;
drop function if exists public.vsat__iv_drafts_clear();
drop function if exists public.vsat__iv_eff_busy(uuid, timestamptz, int, text[]);
drop function if exists public.vsat__iv_ids(jsonb, int);

drop table if exists public.vsat_interview_drafts;
