-- Rollback 0041 · VSAT Enrollment payment
-- Drops the enrollment/offer columns, the order `kind` column and the fee flag.
-- Destructive: per-applicant enrollment + offer data is removed.

alter table public.application_manager
  drop column if exists enrollment_stage,
  drop column if exists enrollment_amount,
  drop column if exists enrollment_order_id,
  drop column if exists enrollment_txn_id,
  drop column if exists enrollment_paid_at,
  drop column if exists scholarship_percentage,
  drop column if exists offer_released_at,
  drop column if exists offer_expires_at,
  drop column if exists offer_cancelled;

alter table public.vsat_payment_orders drop column if exists kind;

delete from public.app_flags where key = 'enrollment_fee';
