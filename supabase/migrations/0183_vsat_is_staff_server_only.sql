-- 0183 · vsat__is_staff: server only (staging first).
--
-- 0104 granted it to authenticated, so any signed-in browser could call it. Nothing in the app calls it from a
-- browser and no table policy uses it: only the SECURITY DEFINER form functions (vsat_form_active_for_fill,
-- vsat_form_autosave_category, vsat_form_save_category) call it, and they run as the owner, so they keep working.
-- Same rule as every other vsat__ helper: revoke from public, anon, authenticated; service_role only.
--
-- Rollback: supabase/rollback/0183_vsat_is_staff_server_only_down.sql
-- Tests:    supabase/tests/vsat_is_staff_server_only.test.sql (and vsat_pipeline_stage_engine.test.sql, which checks it)

revoke all on function public.vsat__is_staff() from public, anon, authenticated;
grant execute on function public.vsat__is_staff() to service_role;
