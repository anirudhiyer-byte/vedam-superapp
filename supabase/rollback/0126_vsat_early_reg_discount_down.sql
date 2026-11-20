-- Rollback for 0126 — remove the early-registration discount flag (turns the floor off:
-- readVsatMoneyFlags defaults it to 0 when the flag is absent, so fees revert to 24h + coupon only).
delete from public.app_flags where key = 'vsat_early_reg_discount';
