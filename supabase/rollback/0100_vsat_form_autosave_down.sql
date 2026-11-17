-- Rollback for 0100_vsat_form_autosave.sql — drop the autosave RPC.
-- (The fill UI falls back to per-stage "Save & next" persistence only.)
drop function if exists public.vsat_form_autosave_category(jsonb);
