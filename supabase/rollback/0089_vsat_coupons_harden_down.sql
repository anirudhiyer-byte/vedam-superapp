-- Rollback 0089 · restore the pre-migration default table grants on vsat_coupons.
grant all on public.vsat_coupons to anon, authenticated;
