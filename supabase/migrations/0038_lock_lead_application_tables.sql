-- 0038: lock application_manager + lead_manager down to the service role only.
--
-- Posture (CLAUDE.md): browsers never get table access — RLS on, no policies,
-- everything goes through SECURITY DEFINER functions / the service role in /api
-- routes. These two tables still carried leftover blanket privileges granted to
-- anon + authenticated (from an old `grant all on all tables`). RLS (enabled, no
-- policy) already denied every browser row, so this was not exploitable, but the
-- grants are unnecessary public surface — revoke them so there is no latent
-- exposure if a permissive policy is ever added later.
--
-- service_role and postgres keep their full privileges (verified before writing),
-- so the API (service-role client, bypasses RLS) is unaffected. profiles is NOT
-- touched here — it intentionally keeps its own RLS policies + grants for prefill.

revoke all on table public.application_manager from anon, authenticated, public;
revoke all on table public.lead_manager      from anon, authenticated, public;
