-- 0037 · vsat_payment_orders — server-side order ledger for the VSAT fee
--
-- The missing piece for wiring Cashfree to VSAT. One row per Cashfree order we
-- create for a VSAT applicant. It is how the webhook knows WHOSE payment an
-- order is and WHAT it should cost — never trusting the webhook payload (see
-- docs/peerpath/vsat-payment-webhook.md, rules 3 & 4). Mirrors event_payments.
--
-- Who writes it: ONLY our server (service role) — the create-order route inserts
-- a 'created' row, the webhook/status route flips it to 'paid'/'failed'. Browsers
-- (anon / authenticated) cannot read or write it at all: RLS on, no policies,
-- all privileges revoked. The actual "has paid" source of truth stays
-- vsat_payments (0032); this ledger is the order bookkeeping around it.
--
-- amount = base_amount - discount (the net the student is charged). Stored so
-- the webhook can enforce "the amount Cashfree reports must equal our DB amount".
--
-- Also seeds the two server-authoritative money flags (fee + 24h discount) so the
-- amount never comes from the client.

create table if not exists public.vsat_payment_orders (
  cf_order_id           text primary key check (char_length(cf_order_id) between 1 and 120),
  lead_id               uuid not null,                           -- = auth.users.id = application_manager.lead_id
  user_email            text,
  attempt               integer not null default 1 check (attempt between 1 and 10),
  base_amount           numeric(10, 2) not null check (base_amount >= 0),
  discount              numeric(10, 2) not null default 0 check (discount >= 0),
  discount_coupon       text check (discount_coupon is null or char_length(discount_coupon) <= 120),
  amount                numeric(10, 2) not null check (amount >= 0),   -- net = base_amount - discount
  currency              text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  status                text not null default 'created' check (status in ('created', 'paid', 'failed')),
  cf_payment_session_id text,
  cf_payment_id         text,
  cf_payment_method     text,
  raw                   jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.vsat_payment_orders is
  'Server-side Cashfree order ledger for VSAT fee payments. Service-role only. amount = base_amount - discount (net charged). vsat_payments stays the source of truth for "paid".';

create index if not exists vsat_payment_orders_lead_idx on public.vsat_payment_orders (lead_id);
create index if not exists vsat_payment_orders_status_idx on public.vsat_payment_orders (status);

alter table public.vsat_payment_orders enable row level security;
revoke all on table public.vsat_payment_orders from public, anon, authenticated;
grant select, insert, update on table public.vsat_payment_orders to service_role;

-- keep updated_at honest
create or replace function public.vsat_payment_orders_touch()
returns trigger language plpgsql set search_path to '' as $fn$
begin
  new.updated_at := now();
  return new;
end $fn$;

revoke all on function public.vsat_payment_orders_touch() from public, anon, authenticated;

drop trigger if exists vsat_payment_orders_touch_row on public.vsat_payment_orders;
create trigger vsat_payment_orders_touch_row
  before update on public.vsat_payment_orders
  for each row execute function public.vsat_payment_orders_touch();

-- server-authoritative money flags (the client never sends the amount).
-- idempotent: re-running the migration or running it on a seeded DB is a no-op.
insert into public.app_flags (key, value, updated_by) values
  ('vsat_fee', '1000', '0037_migration'),
  ('vsat_discount_24h', '200', '0037_migration')
on conflict (key) do nothing;
