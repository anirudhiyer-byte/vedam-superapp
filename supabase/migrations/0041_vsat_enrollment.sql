-- 0041 · VSAT Enrollment payment (the ₹50,000 seat-blocking fee) — 1 Nov 2026
--
-- Enrollment is a SEPARATE payment from the VSAT fee (which never exceeds ₹1000):
-- a flat ₹50,000, no coupon, no 24h discount. It only becomes available after the
-- applicant's counselling is done and an offer letter (with a scholarship %) has
-- been issued and is still valid (not expired, not cancelled). Paying it moves the
-- application to `enrolled`.
--
-- Per the owner's rule, all per-student enrollment data lives on application_manager
-- (not a separate table). The existing vsat_payment_orders ledger carries the order
-- too, tagged by `kind`.
--
-- Rollback: supabase/rollback/0041_vsat_enrollment_down.sql

-- order ledger learns to carry enrollment orders alongside the VSAT-fee orders
alter table public.vsat_payment_orders
  add column if not exists kind text not null default 'vsat_fee'
  check (kind in ('vsat_fee','enrollment'));

-- enrollment + offer fields on the application
alter table public.application_manager
  add column if not exists enrollment_stage text not null default 'not_initiated'
    check (enrollment_stage in ('not_initiated','initiated','approved','failed')),
  add column if not exists enrollment_amount     numeric,
  add column if not exists enrollment_order_id    text,
  add column if not exists enrollment_txn_id      text,
  add column if not exists enrollment_paid_at      timestamptz,
  add column if not exists scholarship_percentage  numeric
    check (scholarship_percentage is null or (scholarship_percentage >= 0 and scholarship_percentage <= 100)),
  add column if not exists offer_released_at        timestamptz,
  add column if not exists offer_expires_at         timestamptz,
  add column if not exists offer_cancelled          boolean not null default false;

-- the flat enrollment fee (server-authoritative, like vsat_fee)
insert into public.app_flags (key, value) values ('enrollment_fee', '50000')
  on conflict (key) do nothing;
