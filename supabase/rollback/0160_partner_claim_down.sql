-- Rollback for 0160_partner_claim.sql
-- Drops the claim function and restores the original vsat_payments provider set.
-- NOTE: restoring the provider CHECK fails if any 'partner' rows already exist — delete/convert
-- those first (they would only exist if a pre-paid partner lead was claimed). Safe before any run.

drop function if exists public.partner_claim(uuid, text, text);

alter table public.vsat_payments drop constraint if exists vsat_payments_provider_check;
alter table public.vsat_payments add constraint vsat_payments_provider_check
  check (provider in ('cashfree', 'backfill', 'simulated'));
