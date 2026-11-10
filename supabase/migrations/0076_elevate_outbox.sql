-- 0076 · Elevate outbound webhook — outbox + enqueue triggers.
--
-- STABILITY: triggers only INSERT a row into an outbox (no network in the
-- transaction), so they can never block or break the funnel flows they hang off.
-- The actual signed POST to Elevate is done by the drain cron (Node) with retries.
-- INERT BY DEFAULT: everything is gated by app_flags.elevate_webhook = 'off'. Until
-- someone flips it to 'on' AND the ELEVATE_WEBHOOK_* env vars are set, nothing is
-- enqueued and nothing is sent. Scope: only partner-credited leads (calling_leads
-- with a utm_medium) ever produce events.

insert into public.app_flags(key, value) values ('elevate_webhook','off')
  on conflict (key) do nothing;

-- outbox — one row per event to send. RLS locked; only service_role / postgres.
create table if not exists public.elevate_outbox (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  event_id text not null unique,                 -- idempotency: stable per lead + status
  calling_lead_id uuid references public.calling_leads(id) on delete set null,
  crm_lead_id text not null,
  status text not null,
  occurred_at timestamptz not null default now(),
  payload jsonb not null,                        -- exact event object to send
  is_test boolean not null default false,
  state text not null default 'pending' check (state in ('pending','sent','held','rejected','dead')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_outcome text,
  last_error text,
  last_response jsonb
);
create index if not exists elevate_outbox_due_idx on public.elevate_outbox(next_attempt_at) where state='pending';
create index if not exists elevate_outbox_state_idx on public.elevate_outbox(state);
alter table public.elevate_outbox enable row level security;
revoke all on public.elevate_outbox from public, anon, authenticated;

create or replace function public.elevate_touch_updated()
returns trigger language plpgsql set search_path to '' as $fn$
begin new.updated_at := now(); return new; end; $fn$;
drop trigger if exists trg_elevate_touch on public.elevate_outbox;
create trigger trg_elevate_touch before update on public.elevate_outbox
  for each row execute function public.elevate_touch_updated();

-- is the webhook live? (flag on)
create or replace function public.elevate_live()
returns boolean language sql stable security definer set search_path to ''
as $fn$ select coalesce((select value from public.app_flags where key='elevate_webhook'),'off') = 'on'; $fn$;
revoke execute on function public.elevate_live() from public, anon, authenticated;

-- enqueue one event for a partner-credited calling lead. Idempotent via event_id.
create or replace function public.elevate_enqueue(p_lead public.calling_leads, p_status text, p_occurred timestamptz, p_extra jsonb)
returns void language plpgsql security definer set search_path to '' as $fn$
declare v_event_id text; v_payload jsonb;
begin
  if not public.elevate_live() then return; end if;
  if p_lead.utm_medium is null or p_lead.is_trashed then return; end if;       -- partner-credited only
  v_event_id := p_lead.id::text || ':' || lower(regexp_replace(p_status, '\s+', '_', 'g'));
  v_payload := jsonb_strip_nulls(jsonb_build_object(
      'event_id', v_event_id,
      'crm_lead_id', p_lead.id::text,
      'mobile', p_lead.phone,
      'email', p_lead.email,
      'name', p_lead.name,
      'status', p_status,
      'occurred_at', to_char(coalesce(p_occurred, now()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'utm_source', p_lead.utm_source,
      'utm_medium', p_lead.utm_medium,
      'utm_campaign', p_lead.utm_campaign
    ) || coalesce(p_extra, '{}'::jsonb));
  insert into public.elevate_outbox(event_id, calling_lead_id, crm_lead_id, status, occurred_at, payload)
  values (v_event_id, p_lead.id, p_lead.id::text, p_status, coalesce(p_occurred, now()), v_payload)
  on conflict (event_id) do nothing;
end; $fn$;
revoke execute on function public.elevate_enqueue(public.calling_leads, text, timestamptz, jsonb) from public, anon, authenticated;

-- T1: a new partner-credited calling lead → "Lead" (sign-up, with created_at + utm tags).
create or replace function public.elevate_on_calling_lead()
returns trigger language plpgsql security definer set search_path to '' as $fn$
begin
  if not public.elevate_live() then return new; end if;
  if new.utm_medium is not null and not new.is_trashed then
    perform public.elevate_enqueue(new, 'Lead', new.created_at,
      jsonb_build_object('created_at', to_char(new.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  end if;
  return new;
end; $fn$;
drop trigger if exists trg_elevate_calling_lead on public.calling_leads;
create trigger trg_elevate_calling_lead after insert on public.calling_leads
  for each row execute function public.elevate_on_calling_lead();

-- T2: application milestones → Elevate statuses, for the linked partner-credited lead.
-- Each enqueue dedups by event_id, so re-firing on any update is a safe no-op.
-- (Rejections / not-cleared / cancelled map to NO status; Dropped Out is not emitted.)
create or replace function public.elevate_on_application()
returns trigger language plpgsql security definer set search_path to '' as $fn$
declare v_lead public.calling_leads; v_campus jsonb; v_slot jsonb;
begin
  if not public.elevate_live() then return new; end if;
  select * into v_lead from public.calling_leads
    where linked_profile_id = new.lead_id and utm_medium is not null and not is_trashed
    order by created_at limit 1;
  if not found then return new; end if;

  v_campus := case when new.campus_applied is not null then jsonb_build_object('campus', new.campus_applied) else '{}'::jsonb end;
  v_slot := case when new.vsat_slot_datetime_1 is not null
                 then jsonb_build_object('test_at', to_char(new.vsat_slot_datetime_1 at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')) else '{}'::jsonb end;

  if new.form_stage_1 is not null and new.form_stage_1::text <> 'not_started' then
    perform public.elevate_enqueue(v_lead, 'Form Started', new.payment_start_date, '{}'::jsonb);
  end if;
  if new.form_stage_1::text = 'form_submitted' then
    perform public.elevate_enqueue(v_lead, 'Form Completed', now(), '{}'::jsonb);
  end if;
  if new.payment_stage_1::text = 'payment_approved' or new.application_stage_1::text = 'payment_approved' then
    perform public.elevate_enqueue(v_lead, 'Form Paid', new.payment_approved_date, '{}'::jsonb);
  end if;
  if new.application_stage_1::text = 'slot_selected' or new.vsat_slot_datetime_1 is not null then
    perform public.elevate_enqueue(v_lead, 'Test Booked', new.vsat_slot_datetime_1, v_slot);
  end if;
  if coalesce(new.exam_given, false) then
    perform public.elevate_enqueue(v_lead, 'Test Done', now(), '{}'::jsonb);
  end if;
  if new.application_stage_1::text = 'vsat_cleared' then
    perform public.elevate_enqueue(v_lead, 'Test Cleared', now(), '{}'::jsonb);
  end if;
  if new.application_stage_1::text = 'interview_selected' then
    perform public.elevate_enqueue(v_lead, 'PI Booked', now(), '{}'::jsonb);
  end if;
  if new.application_stage_1::text = 'counselling_done' then
    perform public.elevate_enqueue(v_lead, 'PI Done', now(), '{}'::jsonb);
  end if;
  if new.application_stage_1::text = 'offer_released' then
    perform public.elevate_enqueue(v_lead, 'Offer Letter Released', now(), '{}'::jsonb);
  end if;
  if new.application_stage_1::text = 'enrolled' then
    perform public.elevate_enqueue(v_lead, 'Seat Booked', now(), v_campus);
  end if;
  return new;
end; $fn$;
drop trigger if exists trg_elevate_application on public.application_manager;
create trigger trg_elevate_application after insert or update on public.application_manager
  for each row execute function public.elevate_on_application();

-- admin queue stats for the Elevate panel.
create or replace function public.elevate_outbox_stats()
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  return jsonb_build_object(
    'flag', coalesce((select value from public.app_flags where key='elevate_webhook'),'off'),
    'total', (select count(*) from public.elevate_outbox),
    'by_state', (select coalesce(jsonb_object_agg(state, c),'{}') from (select state, count(*) c from public.elevate_outbox group by state) s),
    'oldest_pending', (select min(next_attempt_at) from public.elevate_outbox where state='pending'),
    'recent_problems', (select coalesce(jsonb_agg(jsonb_build_object('status',status,'state',state,'error',last_error,'at',updated_at) order by updated_at desc),'[]')
                        from (select status,state,last_error,updated_at from public.elevate_outbox where state in ('rejected','dead') order by updated_at desc limit 10) r)
  );
end; $fn$;
revoke execute on function public.elevate_outbox_stats() from public, anon;
grant execute on function public.elevate_outbox_stats() to authenticated;
