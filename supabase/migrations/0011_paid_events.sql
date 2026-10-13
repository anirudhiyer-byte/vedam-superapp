-- 0011_paid_events.sql
-- Paid events: per-event price, a server-authoritative payments ledger, and a hard
-- guardrail so a paid-event registration can ONLY be created by the server (service
-- role) after a verified Cashfree payment — never directly from the browser.
--
-- Free events are completely unaffected (is_paid defaults false; the trigger only
-- gates events where is_paid = true).

-- 1) event pricing (amount is the server-side source of truth; client never sends it)
alter table public.events add column if not exists is_paid      boolean not null default false;
alter table public.events add column if not exists price_amount numeric;            -- INR, per-event
alter table public.events add column if not exists currency     text not null default 'INR';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'events_paid_price_chk') then
    -- a paid event must carry a positive price
    alter table public.events add constraint events_paid_price_chk
      check (not is_paid or (price_amount is not null and price_amount > 0));
  end if;
end $$;

-- 2) payments ledger — one row per order attempt. Service-role writes only.
create table if not exists public.event_payments (
  id                    uuid primary key default gen_random_uuid(),
  cf_order_id           text unique not null,            -- our generated order id (VEDPAY_...)
  event_id              uuid not null references public.events(id) on delete cascade,
  user_id               uuid not null references auth.users(id) on delete cascade,
  user_email            text,
  amount                numeric not null,
  currency              text not null default 'INR',
  status                text not null default 'created', -- created | paid | failed | expired
  cf_payment_session_id text,
  cf_payment_id         text,
  cf_payment_method     text,
  answers_snapshot      jsonb,                           -- registration form answers, materialised on PAID
  registration_id       uuid references public.event_registrations(id) on delete set null,
  paid_at               timestamptz,
  raw                   jsonb,                           -- last order/webhook payload (audit)
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'event_payments_status_chk') then
    alter table public.event_payments add constraint event_payments_status_chk
      check (status in ('created','paid','failed','expired'));
  end if;
end $$;

create index if not exists idx_event_payments_event on public.event_payments(event_id);
create index if not exists idx_event_payments_user  on public.event_payments(user_id);
create index if not exists idx_event_payments_status on public.event_payments(status);

alter table public.event_payments enable row level security;

-- a user may READ their own payment rows (for the status screen / receipt); nobody but
-- the service role may insert/update/delete (all writes go through the server routes).
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='event_payments' and policyname='event_payments_select_own') then
    create policy event_payments_select_own on public.event_payments
      for select to authenticated using (user_id = (select auth.uid()));
  end if;
end $$;

-- keep updated_at fresh
create or replace trigger trg_event_payments_updated before update on public.event_payments
  for each row execute function public.set_updated_at();

-- 3) GUARDRAIL: block a direct (client) registration insert for a PAID event.
--    Only the service role (the payment webhook/confirm path) may create it.
create or replace function public.trg_block_unpaid_event_reg()
returns trigger language plpgsql security definer set search_path to '' as $fn$
declare v_paid boolean;
begin
  select is_paid into v_paid from public.events where id = new.event_id;
  -- block ONLY the browser-facing roles for a paid event; the service role (payment
  -- webhook/confirm), admin and migration contexts always pass. This can never
  -- accidentally block the server's own confirmed-payment insert.
  if coalesce(v_paid, false) and auth.role() in ('authenticated','anon') then
    raise exception 'This event requires a completed payment to register.'
      using errcode = 'check_violation';
  end if;
  return new;
end
$fn$;

create or replace trigger trg_block_unpaid_event_reg
  before insert on public.event_registrations
  for each row execute function public.trg_block_unpaid_event_reg();
