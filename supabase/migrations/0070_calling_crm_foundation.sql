-- 0070 · Calling CRM — Stage 1 foundation: caller role + calling_leads pool + the
-- secure link / VSAT-payment plumbing.
--
-- SECURITY MODEL (CLAUDE.md + owner's hard requirement — nothing client-writable or
-- hammerable): RLS is ON with NO policies and ALL grants revoked, so browsers / anon
-- get ZERO direct access to calling_leads. Every read/write goes through SECURITY
-- DEFINER RPCs (added in 0071) that check the caller's role. The VSAT-payment back-fill
-- into application_manager lives only in SECURITY DEFINER functions revoked from every
-- client role, so it can never be invoked or bypassed from the client side.

-- 1) caller role — callers may ONLY call, update their own leads, and view dashboards.
alter type public.app_role add value if not exists 'caller';

create or replace function public.is_caller()
returns boolean language sql stable security definer set search_path to ''
as $fn$ select exists (select 1 from public.user_roles where user_id = auth.uid() and role::text = 'caller'); $fn$;
revoke execute on function public.is_caller() from public, anon;
grant execute on function public.is_caller() to authenticated;

-- 2) phone → last 10 digits (immutable; used to match a calling lead to a profile).
create or replace function public.phone10(p text)
returns text language sql immutable set search_path to ''
as $fn$ select right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10); $fn$;

-- 3) the calling pool (phone-keyed; NOT tied to an auth user).
create table if not exists public.calling_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text,
  stream text,
  phone text not null,
  phone10 text generated always as (public.phone10(phone)) stored,
  email text,
  source text not null default 'manual' check (source in ('school_connect','csv','inbound','manual')),
  assigned_to uuid references auth.users(id) on delete set null,
  assigned_at timestamptz,
  assigned_by uuid references auth.users(id) on delete set null,
  call_status text not null default 'not_called' check (call_status in ('not_called','connected','not_connected','disconnected','blocked')),
  interested text check (interested in ('yes','no','undecided')),
  disposition text,
  remarks text,
  follow_up_remarks text,
  next_followup_at timestamptz,
  last_called_at timestamptz,
  call_count int not null default 0,
  linked_profile_id uuid references public.profiles(id) on delete set null,
  vsat_paid boolean not null default false,
  vsat_paid_amount numeric,
  vsat_paid_at timestamptz,
  vsat_payment_applied boolean not null default false,
  utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
  elevate_crm_lead_id text,
  school_connect_lead_id text,
  is_trashed boolean not null default false
);

create index if not exists calling_leads_phone10_idx on public.calling_leads(phone10);
create index if not exists calling_leads_assigned_idx on public.calling_leads(assigned_to) where not is_trashed;
create index if not exists calling_leads_status_idx on public.calling_leads(call_status) where not is_trashed;
create index if not exists calling_leads_linked_idx on public.calling_leads(linked_profile_id);

-- LOCK DOWN: RLS on + no policies + no grants → no client or anon table access at all.
alter table public.calling_leads enable row level security;
revoke all on public.calling_leads from public, anon, authenticated;

create or replace function public.calling_touch_updated()
returns trigger language plpgsql set search_path to ''
as $fn$ begin new.updated_at := now(); return new; end; $fn$;
drop trigger if exists trg_calling_touch on public.calling_leads;
create trigger trg_calling_touch before update on public.calling_leads
  for each row execute function public.calling_touch_updated();

-- 4) VSAT-payment back-fill (service-side only; idempotent): marks the linked
-- application paid + advances to mock_enabled, exactly like the real pay-confirm.
create or replace function public.calling_apply_vsat_payment(p_lead_id uuid)
returns void language plpgsql security definer set search_path to ''
as $fn$
declare v public.calling_leads;
begin
  select * into v from public.calling_leads where id = p_lead_id;
  if not found or not v.vsat_paid or v.vsat_payment_applied or v.linked_profile_id is null then return; end if;
  if not exists (select 1 from public.application_manager where lead_id = v.linked_profile_id) then return; end if;
  update public.application_manager
     set payment_stage_1 = 'payment_approved',
         application_stage_1 = case when application_stage_1 is null or application_stage_1 = 'payment_not_initiated' then 'mock_enabled' else application_stage_1 end,
         payment_amount = coalesce(payment_amount, v.vsat_paid_amount),
         application_fee_amount = coalesce(application_fee_amount, v.vsat_paid_amount),
         discount_source = coalesce(discount_source, 'school_connect_calling'),
         payment_approved_date = coalesce(payment_approved_date, v.vsat_paid_at, now())
   where lead_id = v.linked_profile_id and payment_stage_1 is distinct from 'payment_approved';
  update public.calling_leads set vsat_payment_applied = true where id = p_lead_id;
end; $fn$;
revoke execute on function public.calling_apply_vsat_payment(uuid) from public, anon, authenticated;

-- link a calling lead to a Vedam One profile when one appears with the same phone,
-- and apply any already-paid lead once its application exists.
create or replace function public.calling_link_profile()
returns trigger language plpgsql security definer set search_path to ''
as $fn$
declare p10 text := public.phone10(new.phone); r record;
begin
  if p10 is null or length(p10) < 10 then return new; end if;
  update public.calling_leads set linked_profile_id = new.id where phone10 = p10 and linked_profile_id is null;
  for r in select id from public.calling_leads where phone10 = p10 and vsat_paid and not vsat_payment_applied loop
    perform public.calling_apply_vsat_payment(r.id);
  end loop;
  return new;
end; $fn$;
drop trigger if exists trg_calling_link_profile on public.profiles;
create trigger trg_calling_link_profile after insert or update of phone on public.profiles
  for each row execute function public.calling_link_profile();

-- when an application is created, apply any paid+linked calling lead for that profile.
create or replace function public.calling_apply_on_application()
returns trigger language plpgsql security definer set search_path to ''
as $fn$
declare r record;
begin
  for r in select id from public.calling_leads where linked_profile_id = new.lead_id and vsat_paid and not vsat_payment_applied loop
    perform public.calling_apply_vsat_payment(r.id);
  end loop;
  return new;
end; $fn$;
drop trigger if exists trg_calling_apply_on_app on public.application_manager;
create trigger trg_calling_apply_on_app after insert on public.application_manager
  for each row execute function public.calling_apply_on_application();
