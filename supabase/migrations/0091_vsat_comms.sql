-- 0091 · VSAT stage-driven communications (email + WhatsApp).
--
-- Config the admin edits (per funnel step) + an idempotency log so each step fires once
-- per applicant. The actual sends are done by the app (SMTP2GO email + TrustSignal
-- WhatsApp utility templates) through the service role; browsers never touch these tables.
--
-- Steps: first_half (lead created) · application_started (application created) ·
--        payment_reminder_24h (unpaid ~20h in, cron) · payment_confirmed (paid, + receipt).
--
-- WhatsApp content lives in the APPROVED TrustSignal template (wa_template_id); only the
-- EMAIL subject/body are free-text editable here. test_mode routes sends to the test
-- recipient (app_flags) instead of the real lead until the admin flips a step live.
-- Rollback: supabase/rollback/0091_vsat_comms_down.sql. Never touches production.

-- ── config: one row per step ────────────────────────────────────────────────
create table if not exists public.vsat_comm_steps (
  step_key      text primary key
    check (step_key in ('first_half','application_started','payment_reminder_24h','payment_confirmed')),
  title         text not null,
  enabled       boolean not null default false,   -- master on/off for this step
  test_mode     boolean not null default true,    -- true = send only to the test recipient
  email_enabled boolean not null default true,
  email_subject text not null default '',
  email_body    text not null default '',         -- HTML; placeholders {{name}} {{amount}} {{apply_link}} {{dashboard_link}} {{receipt_link}}
  wa_enabled    boolean not null default true,
  wa_template_id text,                            -- TrustSignal template id (set once approved)
  wa_waba_id    text,
  sort          integer not null default 0,
  updated_at    timestamptz not null default now(),
  updated_by    text
);

comment on table public.vsat_comm_steps is
  'Admin-editable config for VSAT stage comms. Email subject/body are free text; WhatsApp uses an approved TrustSignal utility template. test_mode routes to the test recipient.';

alter table public.vsat_comm_steps enable row level security;
revoke all on table public.vsat_comm_steps from public, anon, authenticated;
grant select, update on table public.vsat_comm_steps to service_role;

-- ── idempotency log: one send per (lead, step, channel) ─────────────────────
create table if not exists public.vsat_comm_sends (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null,
  step_key   text not null,
  channel    text not null check (channel in ('email','whatsapp')),
  status     text not null default 'sent',
  test       boolean not null default false,
  detail     text,
  sent_at    timestamptz not null default now()
);
-- a real (non-test) send happens at most once per lead/step/channel
create unique index if not exists vsat_comm_sends_once
  on public.vsat_comm_sends (lead_id, step_key, channel) where test = false;
create index if not exists vsat_comm_sends_lead_idx on public.vsat_comm_sends (lead_id);

alter table public.vsat_comm_sends enable row level security;
revoke all on table public.vsat_comm_sends from public, anon, authenticated;
grant select, insert on table public.vsat_comm_sends to service_role;

-- ── global settings (single row): master switch + where test_mode sends go ──
create table if not exists public.vsat_comm_settings (
  id         boolean primary key default true check (id),   -- enforces a single row
  master     boolean not null default false,                -- global kill-switch
  test_email text not null default '',
  test_phone text not null default '',
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into public.vsat_comm_settings (id) values (true) on conflict (id) do nothing;

alter table public.vsat_comm_settings enable row level security;
revoke all on table public.vsat_comm_settings from public, anon, authenticated;
grant select on table public.vsat_comm_settings to service_role;

-- ── seed the 4 steps with the approved copy (disabled + test_mode on) ────────
insert into public.vsat_comm_steps (step_key, title, sort, email_subject, email_body) values
  ('first_half', 'First half filled → account + lead', 1,
   'Your VSAT journey has begun 🎉',
   '<p>Hi {{name}},</p><p>Welcome to Vedam! Your Vedam One account is ready and your VSAT journey has begun. You''re just one step away — complete the second half of your form to continue your application.</p><p><a href="{{apply_link}}">Continue your application →</a></p><p>Warmly,<br>Team Vedam</p>'),
  ('application_started', 'Second half filled → application started', 2,
   'Pay your VSAT fee to unlock the exam',
   '<p>Hi {{name}},</p><p>Wonderful news — your VSAT application has started! To unlock your exam, a fee of ₹{{amount}} is needed, and your early-bird price stays open for the next 24 hours.</p><p><a href="{{dashboard_link}}">Complete your payment →</a></p><p>Cheering you on,<br>Team Vedam</p>'),
  ('payment_reminder_24h', 'Unpaid ~20h in → early-bird reminder', 3,
   'Your VSAT fee is pending — early-bird closing soon',
   '<p>Hi {{name}},</p><p>A gentle reminder — your VSAT fee of ₹{{amount}} is still pending and your early-bird window is closing soon. Secure your seat whenever you''re ready.</p><p><a href="{{dashboard_link}}">Complete your payment →</a></p><p>Warm wishes,<br>Team Vedam</p>'),
  ('payment_confirmed', 'Payment successful → receipt + next steps', 4,
   'Payment received — your VSAT receipt',
   '<p>Hi {{name}},</p><p>Thank you so much! We''ve received your VSAT fee of ₹{{amount}}. Your receipt is attached, and you can also view it <a href="{{receipt_link}}">here</a>.</p><p>You''re all set — next, fill your application form, take your mock test, and pick your exam date on your dashboard.</p><p><a href="{{dashboard_link}}">Go to your dashboard →</a></p><p>Warmly,<br>Team Vedam</p>')
on conflict (step_key) do nothing;

-- ── admin RPCs ──────────────────────────────────────────────────────────────
create or replace function public.vsat_comm_steps_get()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare v_rows jsonb;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.sort), '[]'::jsonb) into v_rows
  from public.vsat_comm_steps s;
  return jsonb_build_object('ok', true, 'steps', v_rows,
    'settings', (select to_jsonb(g) from public.vsat_comm_settings g limit 1));
end;
$fn$;

revoke all on function public.vsat_comm_steps_get() from public, anon;
grant execute on function public.vsat_comm_steps_get() to authenticated;

create or replace function public.vsat_comm_step_update(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_key text := p->>'step_key';
  v_admin text := coalesce((select email from auth.users where id = auth.uid()), auth.uid()::text);
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  -- global settings (test recipient + master switch) travel on the same call
  update public.vsat_comm_settings g set
    master     = coalesce((p->>'master')::boolean, g.master),
    test_email = coalesce(p->>'test_email', g.test_email),
    test_phone = coalesce(p->>'test_phone', g.test_phone),
    updated_at = now(),
    updated_by = v_admin
  where g.id = true and (p ? 'master' or p ? 'test_email' or p ? 'test_phone');

  if v_key is not null then
    update public.vsat_comm_steps s set
      enabled       = coalesce((p->>'enabled')::boolean, s.enabled),
      test_mode     = coalesce((p->>'test_mode')::boolean, s.test_mode),
      email_enabled = coalesce((p->>'email_enabled')::boolean, s.email_enabled),
      email_subject = coalesce(p->>'email_subject', s.email_subject),
      email_body    = coalesce(p->>'email_body', s.email_body),
      wa_enabled    = coalesce((p->>'wa_enabled')::boolean, s.wa_enabled),
      wa_template_id = case when p ? 'wa_template_id' then nullif(p->>'wa_template_id','') else s.wa_template_id end,
      wa_waba_id    = case when p ? 'wa_waba_id' then nullif(p->>'wa_waba_id','') else s.wa_waba_id end,
      updated_at    = now(),
      updated_by    = v_admin
    where s.step_key = v_key;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
    end if;
  end if;

  return public.vsat_comm_steps_get();
end;
$fn$;

revoke all on function public.vsat_comm_step_update(jsonb) from public, anon;
grant execute on function public.vsat_comm_step_update(jsonb) to authenticated;
