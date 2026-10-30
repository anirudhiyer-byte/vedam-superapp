-- 0031 · app_flags — server-side feature switches
--
-- First flag: peerpath_eligibility decides who may confirm a PeerPath booking.
--   off        → bookings closed for everyone (kill switch, fails safe)
--   registered → user must have a VSAT application (application_manager row)
--   paid       → user must also have a VSAT payment (vsat_payments row)
--
-- Only admins (SQL editor) and the service role can change flags. Browsers
-- (anon / authenticated) cannot read or write this table: RLS is on with no
-- policies and every table privilege is revoked from them.
--
-- Switch the flag (one command; staging first, production only when approved):
--   update public.app_flags set value = 'paid', updated_at = now(), updated_by = '<your name>'
--   where key = 'peerpath_eligibility';

create table if not exists public.app_flags (
  key        text primary key check (key ~ '^[a-z0-9_]{1,64}$'),
  value      text not null check (char_length(value) between 1 and 200),
  updated_at timestamptz not null default now(),
  updated_by text check (char_length(updated_by) <= 120),
  constraint app_flags_peerpath_eligibility_mode
    check (key <> 'peerpath_eligibility' or value in ('off', 'registered', 'paid'))
);

comment on table public.app_flags is
  'Server-side feature switches. Admin/service role only. peerpath_eligibility = off | registered | paid.';

alter table public.app_flags enable row level security;
revoke all on table public.app_flags from public, anon, authenticated;
grant select, insert, update, delete on table public.app_flags to service_role;

-- Starts CLOSED ('off') on any database this runs on for the first time (e.g. production,
-- when the owner approves), so nobody can book before launch. Open it with the one-line
-- update above. (Staging was set to 'registered' by hand on 30 Oct 2026 for testing.)
insert into public.app_flags (key, value, updated_by)
values ('peerpath_eligibility', 'off', 'migration 0031')
on conflict (key) do nothing;
