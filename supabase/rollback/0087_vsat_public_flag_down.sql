-- Rollback 0087 · remove the VSAT public go-live flag.
delete from public.app_flags where key = 'vsat_public';
