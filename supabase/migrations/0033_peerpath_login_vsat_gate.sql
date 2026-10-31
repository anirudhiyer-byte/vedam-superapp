-- 0033 · PeerPath: login-only ownership + VSAT eligibility gate
--
-- What changes
--  1. A booking belongs to a LOGIN (pp_bookings.applicant_user_id = auth.uid()).
--     The old email + phone proof (0029) is removed. View / cancel / feedback /
--     my-bookings all check auth.uid(). Old no-login bookings become admin-only.
--  2. pp_book decides everything server-side from auth.uid() ONLY:
--       login → per-user rate limit → input shape → eligibility (flag + VSAT)
--       → contact details (read from the DB, never from the request) → slot.
--     Name / email / phone stored on the booking come from application_manager,
--     then profiles, then the auth account. The request can no longer carry them.
--  3. pp_vsat_eligible(uid): app_flags.peerpath_eligibility = off | registered | paid.
--       off → BOOKING_CLOSED (everyone, admins too: it is the kill switch)
--       registered → needs an application_manager row
--       paid → also needs a vsat_payments row
--     Admins (same rule as pp_is_admin) skip the VSAT part.
--  4. Private PeerPath rate limiter (pp_rate_limits / pp_rate_hit): nobody outside
--     the database can call it, so nobody can fill up another user's limit.
--  5. Every booking attempt, allowed or blocked, is logged in pp_book_attempts.
--  6. Double-click safety: a repeat of the same booking returns the same id, and a
--     unique index makes a second confirmed row for the same user+senior+time impossible.
--
-- pp_book result: { ok, code, id? }
--   OK · NOT_LOGGED_IN · RATE_LIMITED · INVALID · BOOKING_CLOSED · NOT_REGISTERED ·
--   PAYMENT_PENDING · PHONE_MISSING (no usable phone OR email) · SLOT_UNAVAILABLE ·
--   RESCHEDULE_CLOSED · LIMIT_REACHED · SERVER
--
-- Rollback: supabase/rollback/0033_peerpath_login_vsat_gate_down.sql

-- ── 1. ownership column + double-booking guard ────────────────────────────────
alter table public.pp_bookings
  add column if not exists applicant_user_id uuid references auth.users (id) on delete set null;

create index if not exists pp_bookings_user_idx
  on public.pp_bookings (applicant_user_id, start_at desc) where applicant_user_id is not null;

create unique index if not exists pp_bookings_user_slot_uniq
  on public.pp_bookings (applicant_user_id, senior_id, start_at)
  where status = 'confirmed' and applicant_user_id is not null;

-- ── 2. private rate limiter ───────────────────────────────────────────────────
create table if not exists public.pp_rate_limits (
  key          text primary key check (char_length(key) <= 200),
  window_start timestamptz not null,
  count        integer not null
);
alter table public.pp_rate_limits enable row level security;
revoke all on table public.pp_rate_limits from public, anon, authenticated;

create or replace function public.pp_rate_hit(p_key text, p_max integer, p_window integer)
returns boolean language plpgsql security definer set search_path to '' as $fn$
declare
  v_epoch bigint := floor(extract(epoch from now()))::bigint;
  v_start timestamptz := to_timestamp(v_epoch - (v_epoch % greatest(p_window, 1)));
  v_count int;
begin
  insert into public.pp_rate_limits (key, window_start, count)
  values (left(p_key, 200), v_start, 1)
  on conflict (key) do update
    set count = case when public.pp_rate_limits.window_start = excluded.window_start
                     then public.pp_rate_limits.count + 1 else 1 end,
        window_start = excluded.window_start
  returning count into v_count;
  return v_count <= p_max;
end $fn$;

-- ── 3. attempt log ────────────────────────────────────────────────────────────
create table if not exists public.pp_book_attempts (
  id         bigint generated always as identity primary key,
  user_id    uuid,                 -- auth.uid() of the caller (null = not logged in)
  ip         text,                 -- as reported in request headers; for forensics only, never trusted
  code       text not null,
  senior_id  uuid,
  start_at   timestamptz,
  booking_id uuid,
  source     text not null default 'db' check (source in ('db', 'route')),
  created_at timestamptz not null default now()
);
create index if not exists pp_book_attempts_created_idx on public.pp_book_attempts (created_at desc);
create index if not exists pp_book_attempts_user_idx on public.pp_book_attempts (user_id, created_at desc);
alter table public.pp_book_attempts enable row level security;
revoke all on table public.pp_book_attempts from public, anon, authenticated;
grant select, insert on table public.pp_book_attempts to service_role;
comment on table public.pp_book_attempts is
  'Every PeerPath booking attempt, allowed or blocked. source=route rows are per-IP blocks logged by /api/peerpath/book.';

-- ── 4. eligibility ────────────────────────────────────────────────────────────
create or replace function public.pp_vsat_eligible(p_uid uuid)
returns text language plpgsql stable security definer set search_path to '' as $fn$
declare v_mode text;
begin
  if p_uid is null then return 'NOT_LOGGED_IN'; end if;

  select f.value into v_mode from public.app_flags f where f.key = 'peerpath_eligibility';
  if v_mode is null or v_mode not in ('registered', 'paid') then
    return 'BOOKING_CLOSED';                         -- off, missing or unknown → closed (fail safe)
  end if;

  -- admins skip the VSAT check (same rule as pp_is_admin, evaluated for p_uid)
  if public.has_role(p_uid, 'admin'::public.app_role)
     or exists (select 1 from auth.users u
                where u.id = p_uid and lower(u.email) like '%@vedam.org' and u.email_confirmed_at is not null) then
    return 'OK';
  end if;

  if not exists (select 1 from public.application_manager am where am.lead_id = p_uid) then
    return 'NOT_REGISTERED';
  end if;
  if v_mode = 'paid' and not exists (select 1 from public.vsat_payments vp where vp.lead_id = p_uid) then
    return 'PAYMENT_PENDING';
  end if;
  return 'OK';
end $fn$;

-- ── 5. booking core (internal: only pp_book calls it) ─────────────────────────
create or replace function public.pp_book_core(p_uid uuid, p jsonb)
returns jsonb language plpgsql set search_path to '' as $fn$
declare
  c_uuid     constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  c_email    constant text := '^[^\s@]+@[^\s@]+\.[^\s@]+$';
  c_phone    constant text := '^\+?[0-9]{10,15}$';
  k          text;
  s          public.pp_seniors;
  v_senior   uuid;
  v_start    timestamptz;
  v_type     text;
  v_dur      int := 30;
  v_end      timestamptz;
  v_local    timestamp;
  v_day      date;
  v_today    date := (now() at time zone 'Asia/Kolkata')::date;
  v_q        text;
  v_resched  uuid;
  v_old      public.pp_bookings;
  v_same     int;
  v_id       uuid;
  v_elig     text;
  am_name text; am_email text; am_phone text;
  pr_name text; pr_email text; pr_phone text;
  au_email text; au_phone text;
  v_name     text;
  v_email    text;
  v_phone    text;
begin
  -- ── input shape: an object, small, only known keys, right types ──
  if p is null or jsonb_typeof(p) <> 'object' or octet_length(p::text) > 4096 then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('seniorId', 'start', 'type', 'duration', 'question', 'rescheduleOf') then
      return jsonb_build_object('ok', false, 'code', 'INVALID');
    end if;
  end loop;

  if jsonb_typeof(p->'seniorId') is distinct from 'string' or lower(p->>'seniorId') !~ c_uuid then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;
  v_senior := (p->>'seniorId')::uuid;

  if jsonb_typeof(p->'start') is distinct from 'string' then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;
  begin
    v_start := (p->>'start')::timestamptz;
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end;

  if jsonb_typeof(p->'type') is distinct from 'string' or (p->>'type') not in ('1:1', 'Group') then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;
  v_type := p->>'type';

  if p ? 'duration' and jsonb_typeof(p->'duration') <> 'null' then
    if jsonb_typeof(p->'duration') <> 'number' or (p->>'duration') not in ('15', '30') then
      return jsonb_build_object('ok', false, 'code', 'INVALID');
    end if;
    v_dur := (p->>'duration')::int;
  end if;

  if p ? 'question' and jsonb_typeof(p->'question') not in ('string', 'null') then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;
  v_q := nullif(btrim(coalesce(p->>'question', '')), '');
  if char_length(coalesce(v_q, '')) > 500 then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;

  if p ? 'rescheduleOf' and jsonb_typeof(p->'rescheduleOf') <> 'null' then
    if jsonb_typeof(p->'rescheduleOf') <> 'string' or lower(p->>'rescheduleOf') !~ c_uuid then
      return jsonb_build_object('ok', false, 'code', 'INVALID');
    end if;
    v_resched := (p->>'rescheduleOf')::uuid;
  end if;

  -- ── eligibility (flag + VSAT registration/payment; admins skip VSAT) ──
  v_elig := public.pp_vsat_eligible(p_uid);
  if v_elig <> 'OK' then
    return jsonb_build_object('ok', false, 'code', v_elig);
  end if;

  -- ── contact details from the DB only: application → profile → auth account ──
  select am.registered_name, am.registered_email, am.registered_mobile
    into am_name, am_email, am_phone
    from public.application_manager am where am.lead_id = p_uid
    order by am.created_at desc nulls last limit 1;
  select pr.full_name, pr.email, pr.phone into pr_name, pr_email, pr_phone
    from public.profiles pr where pr.id = p_uid;
  select u.email, u.phone into au_email, au_phone from auth.users u where u.id = p_uid;

  v_email := case
    when lower(btrim(am_email)) ~* c_email then lower(btrim(am_email))
    when lower(btrim(pr_email)) ~* c_email then lower(btrim(pr_email))
    when lower(btrim(au_email)) ~* c_email then lower(btrim(au_email)) end;
  v_phone := case
    when regexp_replace(coalesce(am_phone, ''), '[\s-]', '', 'g') ~ c_phone then regexp_replace(am_phone, '[\s-]', '', 'g')
    when regexp_replace(coalesce(pr_phone, ''), '[\s-]', '', 'g') ~ c_phone then regexp_replace(pr_phone, '[\s-]', '', 'g')
    when regexp_replace(coalesce(au_phone, ''), '[\s-]', '', 'g') ~ c_phone then regexp_replace(au_phone, '[\s-]', '', 'g') end;
  if v_email is null or v_phone is null then
    return jsonb_build_object('ok', false, 'code', 'PHONE_MISSING');
  end if;
  v_name := left(coalesce(nullif(btrim(am_name), ''), nullif(btrim(pr_name), ''), 'Applicant'), 80);
  if char_length(v_name) < 2 then v_name := 'Applicant'; end if;

  -- ── senior + duration ──
  select * into s from public.pp_seniors where id = v_senior;
  if s.id is null or s.status <> 'active' or s.paused or not (v_type = any (s.session_types)) then
    return jsonb_build_object('ok', false, 'code', 'SLOT_UNAVAILABLE');
  end if;
  if v_type = 'Group' then v_dur := 30; end if;
  if v_type = '1:1' and not (v_dur::smallint = any (s.durations)) then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;
  v_end   := v_start + make_interval(mins => v_dur);
  v_local := v_start at time zone 'Asia/Kolkata';
  v_day   := v_local::date;

  -- one booking at a time per applicant, then per senior (always this order: no deadlocks)
  perform pg_advisory_xact_lock(hashtext('pp_book_u:' || p_uid::text));
  perform pg_advisory_xact_lock(hashtext('pp_book:' || s.id::text));

  -- double-click / retry: the same booking again returns the same id, no new row
  if v_resched is null then
    select b.id into v_id from public.pp_bookings b
     where b.applicant_user_id = p_uid and b.senior_id = s.id and b.start_at = v_start and b.status = 'confirmed'
     limit 1;
    if v_id is not null then
      return jsonb_build_object('ok', true, 'code', 'OK', 'id', v_id, 'repeat', true);
    end if;
  end if;

  -- reschedule: the old chat must belong to THIS login, be changeable, and be with the same senior
  if v_resched is not null then
    select * into v_old from public.pp_bookings where id = v_resched for update;
    if v_old.id is null or v_old.status <> 'confirmed' or v_old.start_at - now() <= interval '3 hours'
       or v_old.applicant_user_id is distinct from p_uid
       or v_old.senior_id <> s.id then
      return jsonb_build_object('ok', false, 'code', 'RESCHEDULE_CLOSED');
    end if;
  end if;

  -- slot re-check at confirm time (no holds): window, grid, weekly times, days off
  if v_start < now() + make_interval(hours => greatest(s.min_notice_hours, 12))
     or v_day >= v_today + 14
     or extract(second from v_local) <> 0
     or not public.pp_slot_allowed(s.id, v_type, v_local, v_dur) then
    return jsonb_build_object('ok', false, 'code', 'SLOT_UNAVAILABLE');
  end if;

  if v_type = 'Group' then
    select count(*) into v_same from public.pp_bookings
      where senior_id = s.id and status = 'confirmed' and type = 'Group' and start_at = v_start
        and id is distinct from v_old.id;
    if v_same >= 8 then return jsonb_build_object('ok', false, 'code', 'SLOT_UNAVAILABLE'); end if;
    if exists (select 1 from public.pp_bookings b where b.senior_id = s.id and b.status = 'confirmed' and b.type <> 'Group'
                 and b.id is distinct from v_old.id
                 and b.start_at < v_end + interval '10 minutes' and v_start < b.end_at + interval '10 minutes') then
      return jsonb_build_object('ok', false, 'code', 'SLOT_UNAVAILABLE');
    end if;
  else
    v_same := 0;
    if exists (select 1 from public.pp_bookings b where b.senior_id = s.id and b.status = 'confirmed'
                 and b.id is distinct from v_old.id
                 and b.start_at < v_end + interval '10 minutes' and v_start < b.end_at + interval '10 minutes') then
      return jsonb_build_object('ok', false, 'code', 'SLOT_UNAVAILABLE');
    end if;
  end if;

  -- senior limits (a new group time counts once; joining an existing group doesn't)
  if v_same = 0 and (
       (select count(distinct b.start_at) from public.pp_bookings b
         where b.senior_id = s.id and b.status in ('confirmed', 'completed') and b.id is distinct from v_old.id
           and (b.start_at at time zone 'Asia/Kolkata')::date = v_day) >= s.daily_cap
    or (select count(distinct b.start_at) from public.pp_bookings b
         where b.senior_id = s.id and b.status in ('confirmed', 'completed') and b.id is distinct from v_old.id
           and date_trunc('week', b.start_at at time zone 'Asia/Kolkata') = date_trunc('week', v_local)) >= s.weekly_cap) then
    return jsonb_build_object('ok', false, 'code', 'SLOT_UNAVAILABLE');
  end if;

  -- applicant limit: 2 upcoming chats per login
  if (select count(*) from public.pp_bookings b
       where b.applicant_user_id = p_uid and b.status = 'confirmed' and b.start_at > now()
         and b.id is distinct from v_old.id) >= 2 then
    return jsonb_build_object('ok', false, 'code', 'LIMIT_REACHED');
  end if;

  if v_old.id is not null then
    update public.pp_bookings set status = 'rescheduled', updated_at = now() where id = v_old.id;
  end if;

  insert into public.pp_bookings (senior_id, start_at, end_at, type, applicant_name, applicant_email,
                                  applicant_phone, question, meet_url, moved_from, applicant_user_id)
  values (s.id, v_start, v_end, v_type, v_name, v_email, v_phone, v_q, s.meet_link, v_old.id, p_uid)
  returning id into v_id;

  if v_old.id is not null then
    update public.pp_bookings set moved_to = v_id where id = v_old.id;
  end if;

  return jsonb_build_object('ok', true, 'code', 'OK', 'id', v_id);
exception
  when exclusion_violation then
    return jsonb_build_object('ok', false, 'code', 'SLOT_UNAVAILABLE');
  when unique_violation then
    -- a parallel identical request won the race: hand back its booking
    select b.id into v_id from public.pp_bookings b
     where b.applicant_user_id = p_uid and b.senior_id = v_senior and b.start_at = v_start and b.status = 'confirmed'
     limit 1;
    if v_id is not null then
      return jsonb_build_object('ok', true, 'code', 'OK', 'id', v_id, 'repeat', true);
    end if;
    return jsonb_build_object('ok', false, 'code', 'SLOT_UNAVAILABLE');
end $fn$;

-- ── 6. pp_book: the only entry point (logged-in users) ────────────────────────
create or replace function public.pp_book(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare
  v_uid    uuid := auth.uid();
  v_res    jsonb;
  v_senior uuid;
  v_start  timestamptz;
begin
  if v_uid is null then
    v_res := jsonb_build_object('ok', false, 'code', 'NOT_LOGGED_IN');
  elsif not public.pp_rate_hit('pp_book:u:' || v_uid::text, 20, 3600) then
    v_res := jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
  else
    begin
      v_res := public.pp_book_core(v_uid, p);
    exception when others then
      raise warning 'pp_book: unexpected error for %: % %', v_uid, sqlstate, sqlerrm;  -- server log only
      v_res := jsonb_build_object('ok', false, 'code', 'SERVER');
    end;
  end if;

  -- log every attempt (allowed or blocked); request fields are context only
  begin
    if jsonb_typeof(p) = 'object' then
      if lower(p->>'seniorId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        v_senior := (p->>'seniorId')::uuid;
      end if;
      v_start := (p->>'start')::timestamptz;
    end if;
  exception when others then null;
  end;
  insert into public.pp_book_attempts (user_id, ip, code, senior_id, start_at, booking_id)
  values (v_uid, left(nullif(public.pp_request_ip(), ''), 64), coalesce(v_res->>'code', 'SERVER'), v_senior, v_start,
          case when (v_res->>'ok')::boolean then (v_res->>'id')::uuid end);
  return v_res;
end $fn$;

-- ── 7. login-only ownership for view / cancel / feedback / my bookings ────────
drop function if exists public.pp_booking_by_id(uuid, text, text);
drop function if exists public.pp_cancel(uuid, text, text);
drop function if exists public.pp_give_feedback(uuid, text, text, integer, boolean, boolean, text);
drop function if exists public.pp_find_bookings(text, text);
drop function if exists public.pp_owner_ok(public.pp_bookings, text, text);

create or replace function public.pp_booking_by_id(p_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare b public.pp_bookings; v_uid uuid := auth.uid();
begin
  if v_uid is null then return null; end if;
  if not public.pp_rate_hit('pp_view:u:' || v_uid::text, 120, 900) then return null; end if;
  select * into b from public.pp_bookings where id = p_id;
  if not found then return null; end if;
  if coalesce(b.applicant_user_id = v_uid, false) or public.pp_is_admin() then
    return public.pp_booking_json(b);
  end if;
  return null;   -- not yours: looks exactly like "not found"
end $fn$;

create or replace function public.pp_cancel(p_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare b public.pp_bookings; v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.pp_rate_hit('pp_cancel:u:' || v_uid::text, 20, 900) then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  select * into b from public.pp_bookings where id = p_id for update;
  if not found or not (coalesce(b.applicant_user_id = v_uid, false) or public.pp_is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if b.status <> 'confirmed' or b.start_at - now() <= interval '3 hours' then
    return jsonb_build_object('ok', false, 'error', 'too_late');
  end if;
  update public.pp_bookings set status = 'cancelled', updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $fn$;

create or replace function public.pp_give_feedback(p_id uuid, p_rating integer, p_recommend boolean, p_promise boolean, p_note text)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare b public.pp_bookings; v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.pp_rate_hit('pp_fb:u:' || v_uid::text, 20, 900) then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  select * into b from public.pp_bookings where id = p_id;
  if not found or not (coalesce(b.applicant_user_id = v_uid, false) or public.pp_is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if not (b.status = 'completed' or (b.status = 'confirmed' and b.start_at < now())) then
    return jsonb_build_object('ok', false, 'error', 'not_yet');
  end if;
  if p_rating is null or p_rating not between 1 and 5 or p_recommend is null or p_promise is null then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  insert into public.pp_feedback (booking_id, rating, recommend, promise_made, note)
  values (p_id, p_rating, p_recommend, p_promise, left(nullif(btrim(coalesce(p_note, '')), ''), 600))
  on conflict (booking_id) do nothing;
  return jsonb_build_object('ok', true);
end $fn$;

create or replace function public.pp_my_bookings()
returns jsonb language sql stable security definer set search_path to '' as $fn$
  select coalesce(jsonb_agg(public.pp_booking_json(b) order by b.start_at desc), '[]'::jsonb)
  from (select * from public.pp_bookings
        where auth.uid() is not null and applicant_user_id = auth.uid()
        order by start_at desc limit 50) b;
$fn$;

-- ── 8. privileges ─────────────────────────────────────────────────────────────
-- Supabase's default privileges grant EXECUTE on new functions to anon and
-- authenticated, so every function is set explicitly here.
revoke all on function public.pp_rate_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.pp_rate_hit(text, integer, integer) to service_role;   -- per-IP limit in the server route

revoke all on function public.pp_vsat_eligible(uuid) from public, anon, authenticated, service_role;
revoke all on function public.pp_book_core(uuid, jsonb) from public, anon, authenticated, service_role;

revoke all on function public.pp_book(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.pp_book(jsonb) to authenticated;

revoke all on function public.pp_booking_by_id(uuid) from public, anon;
revoke all on function public.pp_cancel(uuid) from public, anon;
revoke all on function public.pp_give_feedback(uuid, integer, boolean, boolean, text) from public, anon;
revoke all on function public.pp_my_bookings() from public, anon;
grant execute on function public.pp_booking_by_id(uuid) to authenticated;
grant execute on function public.pp_cancel(uuid) to authenticated;
grant execute on function public.pp_give_feedback(uuid, integer, boolean, boolean, text) to authenticated;
grant execute on function public.pp_my_bookings() to authenticated;
