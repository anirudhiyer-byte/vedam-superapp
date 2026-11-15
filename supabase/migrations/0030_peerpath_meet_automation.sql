-- 0030 · PeerPath Meet automation (STAGING FIRST — do not run on production until signed off)
--
-- What it adds
--   * Each booking gets its own Google Calendar event + Meet link, created by the
--     server with ONE organizer account's OAuth token (no domain-wide delegation).
--     The booking itself never waits on Google; the server syncs right after, and
--     the cron retries whatever is left over.
--   * After a chat ends, the cron reads Meet attendance and either marks the chat
--     completed (2+ people together for the minimum time) or flags it as
--     "needs marking" for the senior / admin. A senior no-show is never auto-set.
--   * pp_book: server-only (via /api/peerpath/book), per-IP limit on the trusted IP,
--     and a reschedule must stay with the same senior.
--
-- Security
--   * New columns live on pp_bookings, which stays RLS-on with no policies.
--   * Only the server (service_role) reads/writes them. Browsers see a small, safe
--     subset through pp_senior_me (senior) and pp_admin_all (admin).
--   * No attendee names are stored, only counts and minutes.
--
-- meet_sync states
--   none     not synced yet            syncing  a server run has claimed it (meet_claimed_at)
--   pending  event made, link not yet  ok       event + Meet link in place
--   failed   last try failed (retried up to the attempt cap)
--   moved    a reschedule took over this event     removed  event deleted / guest removed
--   legacy   booked before this feature: keeps the senior's own link, never synced

do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'pp_bookings' and column_name = 'meet_sync') then
    alter table public.pp_bookings
      add column calendar_event_id   text,
      add column meet_code           text,
      add column meet_sync           text not null default 'none',
      add column meet_claimed_at     timestamptz,
      add column meet_attempts       smallint not null default 0,
      add column meet_error          text,
      add column attendance          jsonb,
      add column auto_result         text,
      add column auto_checked_at     timestamptz,
      add column auto_check_attempts smallint not null default 0;
    -- bookings made before this feature keep the senior's link; don't send them a second one
    update public.pp_bookings set meet_sync = 'legacy';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pp_bookings_meet_sync_check') then
    alter table public.pp_bookings add constraint pp_bookings_meet_sync_check
      check (meet_sync in ('none','syncing','pending','ok','failed','moved','removed','legacy'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pp_bookings_auto_result_check') then
    alter table public.pp_bookings add constraint pp_bookings_auto_result_check
      check (auto_result is null or auto_result in ('completed','needs_marking'));
  end if;
end $$;

-- calendar work the cron still has to do
create index if not exists pp_bookings_meet_todo_idx on public.pp_bookings (start_at)
  where meet_sync in ('none','syncing','pending','failed');
-- chats waiting for an attendance check
create index if not exists pp_bookings_attendance_todo_idx on public.pp_bookings (end_at)
  where status = 'confirmed' and meet_sync = 'ok' and auto_result is null;
-- group chats share one calendar event
create index if not exists pp_bookings_event_idx on public.pp_bookings (calendar_event_id)
  where calendar_event_id is not null;
-- per-email invite cap lookups
create index if not exists pp_bookings_email_created_idx on public.pp_bookings (lower(applicant_email), created_at);

-- ── pp_book: same as 0029, plus a per-IP limit and "same senior" on reschedule ──
create or replace function public.pp_book(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s          public.pp_seniors;
  v_start    timestamptz;
  v_type     text := p->>'type';
  v_dur      int;
  v_end      timestamptz;
  v_local    timestamp;
  v_day      date;
  v_today    date := (now() at time zone 'Asia/Kolkata')::date;
  v_name     text := btrim(coalesce(p->>'name', ''));
  v_email    text := lower(btrim(coalesce(p->>'email', '')));
  v_phone    text := regexp_replace(coalesce(p->>'phone', ''), '[\s-]', '', 'g');
  v_q        text := nullif(btrim(coalesce(p->>'question', '')), '');
  v_old      public.pp_bookings;
  v_same     int;
  v_id       uuid;
  v_ip       text := public.pp_request_ip();
begin
  -- each booking now sends real Google Calendar invites, so cap bookings per IP
  if v_ip is not null and v_ip <> '' and not public.rate_limit_hit('pp_book:'||v_ip, 10, 3600) then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  begin
    v_start := (p->>'start')::timestamptz;
    v_dur   := coalesce((p->>'duration')::int, 30);
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end;
  if char_length(v_name) < 2 or char_length(v_name) > 80
     or v_email !~* '^[^\s@]+@[^\s@]+\.[^\s@]+$'
     or v_phone !~ '^\+?[0-9]{10,15}$'
     or char_length(coalesce(v_q, '')) > 500
     or v_type is null or v_type not in ('1:1','Group') then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  begin
    select * into s from public.pp_seniors where id = (p->>'seniorId')::uuid;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end;
  if s.id is null or s.status <> 'active' or s.paused or not (v_type = any (s.session_types)) then
    return jsonb_build_object('ok', false, 'error', 'taken');
  end if;
  if v_type = 'Group' then v_dur := 30; end if;
  if v_dur not in (15, 30) or (v_type = '1:1' and not (v_dur::smallint = any (s.durations))) then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  v_end   := v_start + make_interval(mins => v_dur);
  v_local := v_start at time zone 'Asia/Kolkata';
  v_day   := v_local::date;

  -- one booking at a time per senior (caps, group seats and buffers stay exact)
  perform pg_advisory_xact_lock(hashtext('pp_book:' || s.id::text));

  -- reschedule: the old chat must still be changeable AND must belong to the caller
  -- (same email + phone they are booking with). This closes the IDOR that would
  -- otherwise let anyone with the old UUID move someone else's booking.
  if nullif(p->>'rescheduleOf', '') is not null then
    begin
      select * into v_old from public.pp_bookings where id = (p->>'rescheduleOf')::uuid for update;
    exception when others then
      return jsonb_build_object('ok', false, 'error', 'reschedule_closed');
    end;
    if v_old.id is null or v_old.status <> 'confirmed' or v_old.start_at - now() <= interval '3 hours'
       or not public.pp_owner_ok(v_old, v_email, v_phone)
       or v_old.senior_id <> s.id then  -- a chat can only move to another time with the same senior
      return jsonb_build_object('ok', false, 'error', 'reschedule_closed');
    end if;
  end if;

  -- inside the booking window, on the grid, inside a current weekly time, not a day off
  if v_start < now() + make_interval(hours => greatest(s.min_notice_hours, 12))
     or v_day >= v_today + 14
     or extract(second from v_local) <> 0
     or not public.pp_slot_allowed(s.id, v_type, v_local, v_dur) then
    return jsonb_build_object('ok', false, 'error', 'taken');
  end if;

  if v_type = 'Group' then
    select count(*) into v_same from public.pp_bookings
      where senior_id = s.id and status = 'confirmed' and type = 'Group' and start_at = v_start
        and id is distinct from v_old.id;
    if v_same >= 8 then return jsonb_build_object('ok', false, 'error', 'taken'); end if;
    if exists (select 1 from public.pp_bookings b where b.senior_id = s.id and b.status = 'confirmed' and b.type <> 'Group'
                 and b.id is distinct from v_old.id
                 and b.start_at < v_end + interval '10 minutes' and v_start < b.end_at + interval '10 minutes') then
      return jsonb_build_object('ok', false, 'error', 'taken');
    end if;
  else
    v_same := 0;
    if exists (select 1 from public.pp_bookings b where b.senior_id = s.id and b.status = 'confirmed'
                 and b.id is distinct from v_old.id
                 and b.start_at < v_end + interval '10 minutes' and v_start < b.end_at + interval '10 minutes') then
      return jsonb_build_object('ok', false, 'error', 'taken');
    end if;
  end if;

  -- senior limits (a new group time counts once; joining an existing group doesn't)
  if v_same = 0 and (
       (select count(distinct b.start_at) from public.pp_bookings b
         where b.senior_id = s.id and b.status in ('confirmed','completed') and b.id is distinct from v_old.id
           and (b.start_at at time zone 'Asia/Kolkata')::date = v_day) >= s.daily_cap
    or (select count(distinct b.start_at) from public.pp_bookings b
         where b.senior_id = s.id and b.status in ('confirmed','completed') and b.id is distinct from v_old.id
           and date_trunc('week', b.start_at at time zone 'Asia/Kolkata') = date_trunc('week', v_local)) >= s.weekly_cap) then
    return jsonb_build_object('ok', false, 'error', 'taken');
  end if;

  -- applicant limit: 2 upcoming chats per email
  if (select count(*) from public.pp_bookings b
       where lower(b.applicant_email) = v_email and b.status = 'confirmed' and b.start_at > now()
         and b.id is distinct from v_old.id) >= 2 then
    return jsonb_build_object('ok', false, 'error', 'limit');
  end if;

  if v_old.id is not null then
    update public.pp_bookings set status = 'rescheduled', updated_at = now() where id = v_old.id;
  end if;

  insert into public.pp_bookings (senior_id, start_at, end_at, type, applicant_name, applicant_email,
                                  applicant_phone, question, meet_url, moved_from)
  values (s.id, v_start, v_end, v_type, v_name, v_email, v_phone, v_q, s.meet_link, v_old.id)
  returning id into v_id;

  if v_old.id is not null then
    update public.pp_bookings set moved_to = v_id where id = v_old.id;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
exception
  when exclusion_violation then return jsonb_build_object('ok', false, 'error', 'taken');
end;
$function$;

-- pp_book is now called only by our server route (/api/peerpath/book), which
-- applies a per-IP limit with Vercel's trusted visitor IP and creates the
-- calendar invite. Browsers can no longer call it directly.
revoke all on function public.pp_book(jsonb) from public, anon, authenticated;
grant execute on function public.pp_book(jsonb) to service_role;

-- ── client IP for rate limits ──────────────────────────────────────────────────
-- Supabase does not overwrite X-Forwarded-For: a browser can put its own value
-- first. On SERVICE-ROLE calls (our server) we instead trust x-pp-client-ip, set
-- by the server from Vercel's x-vercel-forwarded-for (which browsers can't fake).
-- Only a service-role key holder can make role = service_role, so a browser
-- can't use this header. Direct browser calls keep the old behaviour.
create or replace function public.pp_request_ip()
 returns text
 language sql
 stable
 set search_path to ''
as $function$
  select case
    when coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '') = 'service_role'
      then nullif(btrim(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-pp-client-ip', '')), '')
    else split_part(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''), ',', 1)
  end;
$function$;

-- ── senior page: per-booking Meet link + "needs marking" hint ──────────────────
create or replace function public.pp_senior_me(p_token uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare s public.pp_seniors;
begin
  select * into s from public.pp_seniors where access_token = p_token;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  update public.pp_seniors set last_active_at = now() where id = s.id;
  return jsonb_build_object(
    'ok', true,
    'senior', public.pp_senior_private_json(s),
    'rules', public.pp_rules_json(s.id),
    'blocks', public.pp_blocks_json(s.id),
    'settings', public.pp_settings_json(s),
    'bookings', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'seniorId', b.senior_id, 'start', b.start_at, 'end', b.end_at, 'type', b.type,
        'name', b.applicant_name, 'question', b.question, 'status', b.status,
        'rating', (select f.rating from public.pp_feedback f where f.booking_id = b.id),
        'meetUrl', case when b.status = 'confirmed' then coalesce(b.meet_url, s.meet_link) end,
        'needsMarking', (b.status = 'confirmed' and b.auto_result is not distinct from 'needs_marking'),
        'markHint', case when b.status = 'confirmed' and b.auto_result is not distinct from 'needs_marking'
                         then b.attendance ->> 'reason' end) order by b.start_at)
      from public.pp_bookings b where b.senior_id = s.id and b.start_at > now() - interval '60 days'), '[]'::jsonb));
end;
$function$;

-- ── admin page: Meet sync + auto-check state per booking ───────────────────────
create or replace function public.pp_admin_all()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
begin
  if not public.pp_is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  return jsonb_build_object(
    'ok', true,
    'seniors', coalesce((select jsonb_agg(public.pp_senior_private_json(s) || jsonb_build_object('token', s.access_token) order by s.created_at desc) from public.pp_seniors s), '[]'::jsonb),
    'rules', coalesce((select jsonb_object_agg(s.id, public.pp_rules_json(s.id)) from public.pp_seniors s), '{}'::jsonb),
    'blocks', coalesce((select jsonb_object_agg(s.id, public.pp_blocks_json(s.id)) from public.pp_seniors s), '{}'::jsonb),
    'settings', coalesce((select jsonb_object_agg(s.id, public.pp_settings_json(s)) from public.pp_seniors s), '{}'::jsonb),
    'bookings', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'seniorId', b.senior_id, 'start', b.start_at, 'end', b.end_at, 'type', b.type,
        'name', b.applicant_name, 'email', b.applicant_email, 'phone', b.applicant_phone, 'question', b.question,
        'status', b.status, 'meetUrl', b.meet_url, 'movedFrom', b.moved_from, 'movedTo', b.moved_to, 'createdAt', b.created_at,
        'meetSync', b.meet_sync, 'meetError', b.meet_error,
        'autoResult', b.auto_result, 'attendance', b.attendance))
      from (select * from public.pp_bookings order by start_at desc limit 2000) b), '[]'::jsonb),
    'feedback', coalesce((select jsonb_object_agg(f.booking_id, jsonb_build_object(
        'rating', f.rating, 'recommend', f.recommend, 'promiseMade', f.promise_made, 'note', f.note, 'createdAt', f.created_at))
      from public.pp_feedback f), '{}'::jsonb));
end;
$function$;

-- grants unchanged: create or replace keeps each function's existing ACL
