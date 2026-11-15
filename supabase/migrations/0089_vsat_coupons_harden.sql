-- 0089 · defense-in-depth hardening for public.vsat_coupons.
--
-- RLS is already ON with no policies, so browser roles (anon/authenticated) can't
-- read or write any row today. This revokes the latent table-level grants too, so the
-- table matches the 0038 hardening of application_manager/lead_manager: browsers reach
-- coupons ONLY through the admin-gated SECURITY DEFINER RPCs (vsat_coupon_*). No
-- functional change — purely removes a dormant grant.
revoke all on public.vsat_coupons from anon, authenticated;
