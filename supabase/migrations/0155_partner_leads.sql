-- 0155 · Partner lead intake (Elevate / School Connect BDM leads) — staging table.
--
-- A partner (Elevate) pushes leads to us BEFORE the student has a Vedam login. We can't write
-- lead_manager/profiles yet (those are keyed to an auth user that doesn't exist), so a pushed
-- lead is parked here, keyed by partner + phone. When the student later logs in (phone OTP or
-- email), the claim step (migration 0156) matches a pending row by phone/email and materialises
-- it into profiles + lead_manager, carrying name/email/phone/campus + the UTM (source=schoolconnect,
-- medium=offline, campaign=<BDM name>) and, when the push says so, a pre-paid VSAT fee.
--
-- RLS locked: service-role only (the inbound API uses the service key; no browser access).
-- Rollback: supabase/rollback/0155_partner_leads_down.sql

create table if not exists public.partner_leads (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  partner       text not null default 'elevate',
  external_id   text,                                   -- partner's own id (optional, for their reference)
  name          text,
  email         text,
  phone         text not null,
  phone_norm    text generated always as (regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) stored,
  campus        text,                                   -- free text; validated/normalised at claim
  utm_source    text not null default 'schoolconnect',
  utm_medium    text not null default 'offline',
  utm_campaign  text,                                   -- the BDM name attached to this lead
  prepaid       boolean not null default false,
  prepaid_amount numeric check (prepaid_amount is null or prepaid_amount >= 0),
  extra         jsonb not null default '{}'::jsonb,     -- any extra first-half fields the partner sends
  status        text not null default 'pending' check (status in ('pending', 'claimed', 'superseded')),
  claimed_by    uuid,                                   -- the auth user who claimed it
  claimed_at    timestamptz
);

-- idempotency: at most one PENDING lead per (partner, phone). A re-push updates that row.
create unique index if not exists partner_leads_pending_uq
  on public.partner_leads (partner, phone_norm) where status = 'pending';
-- claim lookups by phone / email
create index if not exists partner_leads_phone_idx on public.partner_leads (phone_norm) where status = 'pending';
create index if not exists partner_leads_email_idx on public.partner_leads (lower(email)) where status = 'pending';

alter table public.partner_leads enable row level security;
revoke all on public.partner_leads from public, anon, authenticated;

create or replace function public.partner_leads_touch()
returns trigger language plpgsql set search_path to '' as $fn$
begin new.updated_at := now(); return new; end; $fn$;
drop trigger if exists trg_partner_leads_touch on public.partner_leads;
create trigger trg_partner_leads_touch before update on public.partner_leads
  for each row execute function public.partner_leads_touch();