-- 0032 · vsat_payments — the ONLY source of truth for "this user paid the VSAT fee"
--
-- One row per user. A row existing = paid. The VSAT fee is non-refundable, so
-- rows are write-once: never updated, never deleted (trigger below).
--
-- Who writes it: ONLY the future payment webhook (December), using the service
-- role key. Browsers (anon / authenticated) cannot read or write it at all:
-- RLS on, no policies, all privileges revoked. Nothing in /api/vsat/stage or
-- application_manager.payment_stage_* counts as payment any more.
--
-- Staging test exception: rows with provider = 'simulated' may be inserted or
-- deleted only when the session sets vedam.allow_simulated_payments = 'on'
-- (used by scripts/staging/simulate-vsat-payment.sql). The webhook never writes
-- 'simulated', so production never has such rows.
--
-- No foreign key to auth.users on purpose: a payment record must outlive an
-- account (and /api/auth/reclaim deletes auth users, which an FK would block).

create table if not exists public.vsat_payments (
  lead_id           uuid primary key,                         -- = auth.users.id = application_manager.lead_id
  paid_at           timestamptz not null,
  payment_ref       text not null unique check (char_length(payment_ref) between 1 and 200),  -- gateway order id
  provider          text not null check (provider in ('cashfree', 'backfill', 'simulated')),
  provider_event_id text unique check (char_length(provider_event_id) <= 200),                -- webhook event id (idempotency)
  amount            numeric(10, 2) check (amount is null or amount >= 0),
  currency          text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  created_at        timestamptz not null default now()
);

comment on table public.vsat_payments is
  'VSAT fee payments. One row per user, write-once. Written only by the payment webhook (service role).';

alter table public.vsat_payments enable row level security;
revoke all on table public.vsat_payments from public, anon, authenticated;
grant select, insert on table public.vsat_payments to service_role;

create or replace function public.vsat_payments_guard()
returns trigger language plpgsql set search_path to '' as $fn$
declare
  v_sim boolean := coalesce(current_setting('vedam.allow_simulated_payments', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if new.provider = 'simulated' and not v_sim then
      raise exception 'simulated payments are not allowed here' using errcode = '42501';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.provider = 'simulated' and v_sim then
      return old;
    end if;
  end if;
  raise exception 'vsat_payments is write-once (% blocked)', tg_op using errcode = '42501';
end $fn$;

revoke all on function public.vsat_payments_guard() from public, anon, authenticated;

drop trigger if exists vsat_payments_guard_row on public.vsat_payments;
create trigger vsat_payments_guard_row
  before insert or update or delete on public.vsat_payments
  for each row execute function public.vsat_payments_guard();

drop trigger if exists vsat_payments_guard_truncate on public.vsat_payments;
create trigger vsat_payments_guard_truncate
  before truncate on public.vsat_payments
  for each statement execute function public.vsat_payments_guard();
