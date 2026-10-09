-- 0008_low_polish_pg_trgm.sql
-- LOW-severity hardening: move pg_trgm out of the public schema into `extensions`
-- (Supabase advisor "extension_in_public"). Idempotent + guarded.
--
-- Safety notes (verified against prod 2026-10-09):
--   * Only one trigram index exists (idx_city_name_trgm on city_database); it
--     references gin_trgm_ops by OID, so it keeps working after the move.
--   * No SECURITY DEFINER function with search_path='' uses trigram funcs/ops.
--   * App code never calls similarity()/% directly (only ILIKE, a core operator),
--     so the move has no application impact.

do $$
begin
  if exists (
    select 1 from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pg_trgm' and n.nspname = 'public'
  ) and exists (
    select 1 from pg_namespace where nspname = 'extensions'
  ) then
    execute 'alter extension pg_trgm set schema extensions';
    raise notice 'pg_trgm moved to extensions schema';
  else
    raise notice 'pg_trgm not in public or extensions schema missing — no-op';
  end if;
end $$;
