-- 0087 · VSAT public go-live flag.
--
-- Seeds app_flags.vsat_public = 'off'. While 'off' (and not the staging env), /apply
-- keeps serving the existing early-registration form and /vsat stays admin-only — so
-- production is unchanged until someone flips this to 'on' at go-live, which turns
-- /apply into the public VSAT signup landing. Staging is always treated as live via
-- the environment flag, so this stays 'off' on a fresh DB (production safe by default).

insert into public.app_flags (key, value, updated_at, updated_by)
select 'vsat_public', 'off', now(), '0087_migration'
where not exists (select 1 from public.app_flags where key = 'vsat_public');
