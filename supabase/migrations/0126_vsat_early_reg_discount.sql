-- 0126 · VSAT early-registration discount floor.
--
-- Applicants who early-registered (a vsat_registrations row with registered = true) get AT LEAST
-- this much off the form fee, merged (never stacked) with the 24h early-bird discount and any
-- coupon — the student always gets the best of the three. Server-authoritative, read from
-- app_flags by src/lib/payments/vsat-fee.ts (readVsatMoneyFlags → computeVsatFee).
--
-- Seeds ₹500 only if the flag is absent, so an admin who already set a different value keeps it.
-- Change later with:  update public.app_flags set value = '<amount>', updated_at = now(),
--                     updated_by = '<name>' where key = 'vsat_early_reg_discount';
-- Rollback: supabase/rollback/0126_vsat_early_reg_discount_down.sql

insert into public.app_flags (key, value, updated_by)
values ('vsat_early_reg_discount', '500', 'migration-0126')
on conflict (key) do nothing;
