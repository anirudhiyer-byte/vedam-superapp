-- 0178 · lock down vsat__app_prepaid_reflect (staging first; production too — 0172 is there).
--
-- 0172 created the BEFORE INSERT trigger function public.vsat__app_prepaid_reflect() without revoking EXECUTE,
-- so PUBLIC / anon / authenticated kept the default grant. It is a trigger function (it cannot run as an RPC), but
-- every private vsat__ helper must be unreachable from a browser (vsat_pipeline_stage_engine.test.sql, test J).
-- Postgres checks EXECUTE on a trigger function only when the trigger is created, not when it fires, so the
-- trigger keeps working.
--
-- Rollback: supabase/rollback/0178_vsat_prepaid_reflect_grant_down.sql

revoke all on function public.vsat__app_prepaid_reflect() from public, anon, authenticated;
grant execute on function public.vsat__app_prepaid_reflect() to service_role;
