-- 0147 · Calling CRM — TeleCMI telephony (click-to-call + call-event ingest).
--
-- Adds click-to-call and call recordings to the Calling CRM (0070–0073) via TeleCMI
-- (doc.telecmi.com). The caller taps "Call" on a lead; a server route (which holds the
-- app secret — never the DB) POSTs TeleCMI's click2call so the caller's own phone/softphone
-- rings first, then the lead. When the call ends TeleCMI POSTs a CDR to our webhook, which
-- we ingest here: recording, duration and outcome land on a call-events row + the lead.
--
-- Per-caller mode (owner's choice): each caller is either 'mobile' (click2call followme to
-- their phone) or 'softphone' (TeleCMI browser SDK) — stored in calling_telecmi_agents.
--
-- OFF BY DEFAULT: app_flags.telecmi_enabled = 'off'. Credentials (app id, app secret, the
-- webhook secret, default caller id) live ONLY in environment variables, never in the DB.
--
-- SECURITY (CLAUDE.md): RLS on, NO policies, ALL grants revoked — browsers get zero table
-- access. Caller-facing RPCs check is_caller() + that the lead is assigned to auth.uid().
-- The ingest function is revoked from every client role (service key only), so a browser can
-- never fabricate a call record. SECURITY DEFINER + set search_path to '' throughout.
-- Rollback: supabase/rollback/0147_calling_telecmi_down.sql  Tests: supabase/tests/calling_telecmi.test.sql

-- ── flag (seed off; production stays closed until the owner flips it) ──
insert into public.app_flags (key, value)
  values ('telecmi_enabled', 'off')
  on conflict (key) do nothing;

-- ── a lead's phone as a dialable number (91 + last 10 digits for Indian leads) ──
create or replace function public.calling_dial(p text)
returns text language sql immutable set search_path to '' as $fn$
  select case when length(public.phone10(p)) = 10 then '91' || public.phone10(p) else nullif(regexp_replace(coalesce(p,''), '\D', '', 'g'), '') end;
$fn$;

-- ── per-caller TeleCMI mapping (admin-managed) ──
create table if not exists public.calling_telecmi_agents (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  telecmi_user_id text not null check (char_length(telecmi_user_id) between 1 and 64),
  call_mode       text not null default 'mobile' check (call_mode in ('mobile', 'softphone')),
  callerid        text check (callerid is null or callerid ~ '^[0-9]{6,15}$'),
  active          boolean not null default true,
  updated_at      timestamptz not null default now(),
  updated_by      uuid
);
alter table public.calling_telecmi_agents enable row level security;
revoke all on public.calling_telecmi_agents from public, anon, authenticated;

-- ── one row per TeleCMI call (outbound attempt, then reconciled by the CDR) ──
create table if not exists public.calling_call_events (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid references public.calling_leads(id) on delete set null,
  caller_id       uuid references auth.users(id) on delete set null,
  direction       text not null default 'outbound' check (direction in ('outbound', 'inbound')),
  to_phone        text,
  to_phone10      text generated always as (public.phone10(to_phone)) stored,
  from_did        text,
  telecmi_agent   text,          -- the TeleCMI user id that handled the call (CDR `agent`)
  telecmi_cmiuid  text,          -- TeleCMI unique call id (CDR `cmiuid`)
  request_id      text,          -- click2call request id
  status          text not null default 'initiated' check (status in ('initiated', 'ringing', 'answered', 'completed', 'missed', 'failed')),
  duration        int,
  billedsec       int,
  recording_file  text,
  recording_url   text,
  answered_at     timestamptz,
  raw             jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists calling_call_events_cmiuid on public.calling_call_events(telecmi_cmiuid) where telecmi_cmiuid is not null;
create index if not exists calling_call_events_lead on public.calling_call_events(lead_id, created_at desc);
create index if not exists calling_call_events_caller on public.calling_call_events(caller_id, created_at desc);
create index if not exists calling_call_events_match on public.calling_call_events(to_phone10, created_at desc) where status = 'initiated';
alter table public.calling_call_events enable row level security;
revoke all on public.calling_call_events from public, anon, authenticated;

create trigger trg_calling_call_events_touch before update on public.calling_call_events
  for each row execute function public.calling_touch_updated();

-- ═══════════════════════════════ caller RPCs ═══════════════════════════════

-- is TeleCMI switched on? (any client may ask; no data leaks)
create or replace function public.calling_telecmi_on()
returns boolean language sql stable security definer set search_path to '' as $fn$
  select coalesce((select value = 'on' from public.app_flags where key = 'telecmi_enabled'), false);
$fn$;
revoke all on function public.calling_telecmi_on() from public, anon;
grant execute on function public.calling_telecmi_on() to authenticated;

-- Authorise a click-to-call and return what the ROUTE needs to place it (never the secret).
-- Caller must own the lead (admins may call any). Returns the lead's dial number + the
-- caller's TeleCMI user + mode + caller id. { lead_id }
create or replace function public.calling_telecmi_prepare(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare v_lead public.calling_leads; v_agent public.calling_telecmi_agents; v_admin boolean := public.is_admin(); v_to text;
begin
  if not (v_admin or public.is_caller()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not public.calling_telecmi_on() then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  select * into v_lead from public.calling_leads where id = nullif(p->>'lead_id','')::uuid and not is_trashed;
  if not found then return jsonb_build_object('ok', false, 'error', 'lead_not_found'); end if;
  if not v_admin and v_lead.assigned_to is distinct from auth.uid() then return jsonb_build_object('ok', false, 'error', 'not_your_lead'); end if;
  select * into v_agent from public.calling_telecmi_agents where user_id = auth.uid() and active;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_agent'); end if;
  v_to := public.calling_dial(v_lead.phone);
  if v_to is null then return jsonb_build_object('ok', false, 'error', 'bad_number'); end if;
  return jsonb_build_object('ok', true, 'lead_id', v_lead.id, 'caller_id', auth.uid(),
    'to', v_to, 'telecmi_user_id', v_agent.telecmi_user_id, 'call_mode', v_agent.call_mode, 'callerid', v_agent.callerid);
end; $fn$;
revoke all on function public.calling_telecmi_prepare(jsonb) from public, anon;
grant execute on function public.calling_telecmi_prepare(jsonb) to authenticated;

-- Record a placed attempt (the route calls this AFTER TeleCMI accepts the click2call).
-- Same ownership check; bumps the lead's call_count / last_called_at. { lead_id, request_id, to }
create or replace function public.calling_telecmi_log_attempt(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_lead public.calling_leads; v_admin boolean := public.is_admin(); v_id uuid; v_agent text;
begin
  if not (v_admin or public.is_caller()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_lead from public.calling_leads where id = nullif(p->>'lead_id','')::uuid and not is_trashed;
  if not found then return jsonb_build_object('ok', false, 'error', 'lead_not_found'); end if;
  if not v_admin and v_lead.assigned_to is distinct from auth.uid() then return jsonb_build_object('ok', false, 'error', 'not_your_lead'); end if;
  select telecmi_user_id into v_agent from public.calling_telecmi_agents where user_id = auth.uid();
  insert into public.calling_call_events (lead_id, caller_id, direction, to_phone, telecmi_agent, request_id, status)
    values (v_lead.id, auth.uid(), 'outbound', public.calling_dial(v_lead.phone), v_agent, nullif(p->>'request_id',''), 'initiated')
    returning id into v_id;
  update public.calling_leads set call_count = call_count + 1, last_called_at = now() where id = v_lead.id;
  return jsonb_build_object('ok', true, 'event_id', v_id);
end; $fn$;
revoke all on function public.calling_telecmi_log_attempt(jsonb) from public, anon;
grant execute on function public.calling_telecmi_log_attempt(jsonb) to authenticated;

-- A caller's call history for one of their leads (recordings + outcomes). { lead_id }
create or replace function public.calling_lead_calls(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare v_lead public.calling_leads; v_admin boolean := public.is_admin();
begin
  if not (v_admin or public.is_caller()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_lead from public.calling_leads where id = nullif(p->>'lead_id','')::uuid;
  if not found then return jsonb_build_object('ok', false, 'error', 'lead_not_found'); end if;
  if not v_admin and v_lead.assigned_to is distinct from auth.uid() then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object('ok', true, 'calls', coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'direction', e.direction, 'status', e.status,
      'duration', e.duration, 'billedsec', e.billedsec, 'recording_url', e.recording_url,
      'answered_at', e.answered_at, 'created_at', e.created_at) order by e.created_at desc)
    from public.calling_call_events e where e.lead_id = v_lead.id), '[]'::jsonb));
end; $fn$;
revoke all on function public.calling_lead_calls(jsonb) from public, anon;
grant execute on function public.calling_lead_calls(jsonb) to authenticated;

-- May the signed-in caller/admin hear this recording file? (ownership check for the proxy). { file }
create or replace function public.calling_recording_ok(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare v_file text := nullif(btrim(p->>'file'),''); v_admin boolean := public.is_admin(); v_ok boolean;
begin
  if not (v_admin or public.is_caller()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_file is null then return jsonb_build_object('ok', false); end if;
  select exists (
    select 1 from public.calling_call_events e
    left join public.calling_leads l on l.id = e.lead_id
    where e.recording_file = v_file
      and (v_admin or e.caller_id = auth.uid() or l.assigned_to = auth.uid())
  ) into v_ok;
  return jsonb_build_object('ok', v_ok, 'file', v_file);
end; $fn$;
revoke all on function public.calling_recording_ok(jsonb) from public, anon;
grant execute on function public.calling_recording_ok(jsonb) to authenticated;

-- ═══════════════════════════════ admin RPCs ═══════════════════════════════

-- Callers + their TeleCMI mapping (admin Callers page).
create or replace function public.calling_telecmi_roster()
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', ur.user_id, 'email', au.email,
      'telecmi_user_id', a.telecmi_user_id, 'call_mode', coalesce(a.call_mode, 'mobile'),
      'callerid', a.callerid, 'active', coalesce(a.active, false), 'mapped', a.user_id is not null)
      order by au.email)
    from public.user_roles ur
    join auth.users au on au.id = ur.user_id
    left join public.calling_telecmi_agents a on a.user_id = ur.user_id
    where ur.role::text = 'caller'), '[]'::jsonb);
end; $fn$;
revoke all on function public.calling_telecmi_roster() from public, anon;
grant execute on function public.calling_telecmi_roster() to authenticated;

-- Set / update one caller's TeleCMI mapping. { user_id, telecmi_user_id, call_mode, callerid, active }
create or replace function public.calling_set_telecmi_agent(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_uid uuid := nullif(p->>'user_id','')::uuid; v_tid text := nullif(btrim(p->>'telecmi_user_id'),'');
        v_mode text := coalesce(nullif(p->>'call_mode',''), 'mobile'); v_cid text := nullif(btrim(p->>'callerid'),'');
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'missing_user_id'); end if;
  if not exists (select 1 from public.user_roles where user_id = v_uid and role::text = 'caller') then
    return jsonb_build_object('ok', false, 'error', 'not_a_caller');
  end if;
  if v_tid is null then return jsonb_build_object('ok', false, 'error', 'missing_telecmi_user_id'); end if;
  if v_mode not in ('mobile', 'softphone') then return jsonb_build_object('ok', false, 'error', 'bad_call_mode'); end if;
  if v_cid is not null and v_cid !~ '^[0-9]{6,15}$' then return jsonb_build_object('ok', false, 'error', 'bad_callerid'); end if;
  insert into public.calling_telecmi_agents (user_id, telecmi_user_id, call_mode, callerid, active, updated_by)
    values (v_uid, v_tid, v_mode, v_cid, coalesce((p->>'active')::boolean, true), auth.uid())
    on conflict (user_id) do update set telecmi_user_id = excluded.telecmi_user_id, call_mode = excluded.call_mode,
      callerid = excluded.callerid, active = excluded.active, updated_at = now(), updated_by = auth.uid();
  return jsonb_build_object('ok', true);
end; $fn$;
revoke all on function public.calling_set_telecmi_agent(jsonb) from public, anon;
grant execute on function public.calling_set_telecmi_agent(jsonb) to authenticated;

-- ═══════════════════════════════ webhook ingest (service role only) ═══════════════════════════════

-- Ingest one TeleCMI CDR / live event. Revoked from EVERY client role — only the service key
-- (the webhook route) can call it, so a browser can never fabricate a call record. Tolerant:
-- an unmatched call is still stored (lead_id null) and never throws.
-- p = the raw TeleCMI payload (cmiuid, agent, to, from, duration, billedsec, filename, record, time, status …)
create or replace function public.calling_telecmi_ingest(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare
  v_cmiuid text := nullif(p->>'cmiuid',''); v_agent text := nullif(p->>'agent','');
  v_to text := nullif(regexp_replace(coalesce(p->>'to',''), '\D', '', 'g'), '');
  v_to10 text := public.phone10(coalesce(p->>'to','')); v_from text := nullif(p->>'from','');
  v_dur int := nullif(p->>'duration','')::int; v_billed int := nullif(p->>'billedsec','')::int;
  v_file text := nullif(p->>'filename',''); v_rec boolean := coalesce((p->>'record') = 'true', false);
  v_ans timestamptz := case when (p->>'time') ~ '^[0-9]+$' then to_timestamp((p->>'time')::bigint / 1000.0) else null end;
  v_status text := case when coalesce(v_billed,0) > 0 then 'completed' when v_dur is not null then 'missed' else 'completed' end;
  v_recurl text := case when v_rec and v_file is not null then '/api/calling/recording/' || v_file else null end;
  v_lead uuid; v_caller uuid; v_id uuid;
begin
  -- map the TeleCMI agent back to our caller
  select user_id into v_caller from public.calling_telecmi_agents where telecmi_user_id = v_agent;
  -- match the lead by phone — prefer one assigned to the caller, else most recent
  select id into v_lead from public.calling_leads
    where v_to10 is not null and length(v_to10) = 10 and phone10 = v_to10
    order by (assigned_to is not distinct from v_caller) desc, updated_at desc limit 1;

  -- already have this call id? update it. else try to adopt a recent 'initiated' attempt, else insert.
  if v_cmiuid is not null then
    update public.calling_call_events set status = v_status, duration = coalesce(v_dur, duration), billedsec = coalesce(v_billed, billedsec),
        recording_file = coalesce(v_file, recording_file), recording_url = coalesce(v_recurl, recording_url), answered_at = coalesce(v_ans, answered_at),
        from_did = coalesce(v_from, from_did), telecmi_agent = coalesce(v_agent, telecmi_agent),
        lead_id = coalesce(lead_id, v_lead), caller_id = coalesce(caller_id, v_caller), raw = p
      where telecmi_cmiuid = v_cmiuid returning id into v_id;
  end if;
  if v_id is null then
    update public.calling_call_events set telecmi_cmiuid = v_cmiuid, status = v_status, duration = v_dur, billedsec = v_billed,
        recording_file = v_file, recording_url = v_recurl, answered_at = v_ans, from_did = v_from,
        lead_id = coalesce(lead_id, v_lead), caller_id = coalesce(caller_id, v_caller), raw = p
      where id = (select e.id from public.calling_call_events e
                   where e.status = 'initiated' and e.to_phone10 = v_to10
                     and (v_caller is null or e.caller_id is not distinct from v_caller)
                     and e.created_at > now() - interval '6 hours'
                   order by e.created_at desc limit 1)
      returning id into v_id;
  end if;
  if v_id is null then
    insert into public.calling_call_events (lead_id, caller_id, direction, to_phone, from_did, telecmi_agent,
        telecmi_cmiuid, status, duration, billedsec, recording_file, recording_url, answered_at, raw)
      values (v_lead, v_caller, 'outbound', v_to, v_from, v_agent, v_cmiuid, v_status, v_dur, v_billed, v_file, v_recurl, v_ans, p)
      returning id into v_id;
  end if;

  if v_lead is not null then
    update public.calling_leads set last_called_at = greatest(coalesce(last_called_at, v_ans, now()), coalesce(v_ans, now())) where id = v_lead;
  end if;
  return jsonb_build_object('ok', true, 'event_id', v_id, 'matched_lead', v_lead is not null, 'matched_caller', v_caller is not null);
end; $fn$;
revoke all on function public.calling_telecmi_ingest(jsonb) from public, anon, authenticated;
