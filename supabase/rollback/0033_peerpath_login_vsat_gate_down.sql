-- Rollback for 0033_peerpath_login_vsat_gate.sql (run 0034's rollback first)
-- Restores PeerPath exactly as it was after 0030 (email + phone ownership, pp_book
-- callable only by the service role) and removes everything 0033 added.
-- Function bodies below are copied verbatim from what was actually applied on
-- staging (0029 / 0030 / the live pp_find_bookings), so pg_get_functiondef md5s
-- match the pre-0033 snapshot. (The applied pp_booking_by_id has no trailing
-- comment on "return null;", unlike the 0029 file — the as-applied text wins.)
-- Note: bookings made while 0033 was live keep their applicant email + phone, so
-- they become owner-provable again by email + phone.
--
-- BEFORE RUNNING: also revert the app code to the pre-0033 commit. The current code
-- calls pp_rate_hit, pp_my_bookings and the login-only functions, which this drops.
--
-- The login owner of each booking is copied to pp_bookings_owner_backup before the
-- column is dropped, so re-applying 0033 can restore it:
--   update public.pp_bookings b set applicant_user_id = k.applicant_user_id
--   from public.pp_bookings_owner_backup k where k.id = b.id;
--
-- The attempt log pp_book_attempts is DROPPED (not backed up). Export it first if needed,
-- e.g. download `select * from public.pp_book_attempts` as CSV from the SQL editor.
--
-- Runs as ONE transaction: if any step fails, nothing changes.
begin;

-- 1. remove 0033 functions
drop function if exists public.pp_my_bookings();
drop function if exists public.pp_booking_by_id(uuid);
drop function if exists public.pp_cancel(uuid);
drop function if exists public.pp_give_feedback(uuid, integer, boolean, boolean, text);
drop function if exists public.pp_book_core(uuid, jsonb);
drop function if exists public.pp_vsat_eligible(uuid);

-- 2. restore 0029 ownership functions
create or replace function public.pp_owner_ok(b public.pp_bookings, p_email text, p_phone text)
returns boolean language sql immutable set search_path to '' as $fn$
  select b.applicant_email is not null
     and lower(b.applicant_email) = lower(btrim(coalesce(p_email,'')))
     and char_length(regexp_replace(coalesce(p_phone,''),'\D','','g')) >= 10
     and right(regexp_replace(b.applicant_phone,'\D','','g'),10)
       = right(regexp_replace(coalesce(p_phone,''),'\D','','g'),10);
$fn$;

create or replace function public.pp_booking_by_id(p_id uuid, p_email text, p_phone text)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare b public.pp_bookings; v_ip text := public.pp_request_ip();
begin
  if v_ip is not null and v_ip <> '' and not public.rate_limit_hit('pp_view:'||v_ip, 40, 900) then
    return null;
  end if;
  select * into b from public.pp_bookings where id = p_id;
  if not found then return null; end if;
  if public.pp_is_admin() or public.pp_owner_ok(b, p_email, p_phone) then
    return public.pp_booking_json(b);
  end if;
  return null;
end; $fn$;

create or replace function public.pp_cancel(p_id uuid, p_email text, p_phone text)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare b public.pp_bookings; v_ip text := public.pp_request_ip();
begin
  if v_ip is not null and v_ip <> '' and not public.rate_limit_hit('pp_cancel:'||v_ip, 20, 900) then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  select * into b from public.pp_bookings where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not (public.pp_is_admin() or public.pp_owner_ok(b, p_email, p_phone)) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if b.status <> 'confirmed' or b.start_at - now() <= interval '3 hours' then
    return jsonb_build_object('ok', false, 'error', 'too_late');
  end if;
  update public.pp_bookings set status = 'cancelled', updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
end; $fn$;

create or replace function public.pp_give_feedback(p_id uuid, p_email text, p_phone text, p_rating integer, p_recommend boolean, p_promise boolean, p_note text)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare b public.pp_bookings; v_ip text := public.pp_request_ip();
begin
  if v_ip is not null and v_ip <> '' and not public.rate_limit_hit('pp_fb:'||v_ip, 20, 900) then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  select * into b from public.pp_bookings where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not (public.pp_is_admin() or public.pp_owner_ok(b, p_email, p_phone)) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if not (b.status = 'completed' or (b.status = 'confirmed' and b.start_at < now())) then
    return jsonb_build_object('ok', false, 'error', 'not_yet');
  end if;
  if p_rating not between 1 and 5 or p_recommend is null or p_promise is null then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  insert into public.pp_feedback (booking_id, rating, recommend, promise_made, note)
  values (p_id, p_rating, p_recommend, p_promise, left(nullif(btrim(coalesce(p_note, '')), ''), 600))
  on conflict (booking_id) do nothing;
  return jsonb_build_object('ok', true);
end; $fn$;

-- 3. restore pp_find_bookings (as it was live before 0033)
CREATE OR REPLACE FUNCTION public.pp_find_bookings(p_email text, p_phone text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(public.pp_booking_json(b) order by b.start_at desc), '[]'::jsonb)
  from (select * from public.pp_bookings
        where lower(applicant_email) = lower(btrim(p_email))
          and right(regexp_replace(applicant_phone, '\D', '', 'g'), 10) = right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10)
          and char_length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 10
        order by start_at desc limit 50) b;
$function$;

-- 4. restore pp_book from 0030
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

-- 5. privileges exactly as before 0033
revoke all on function public.pp_owner_ok(public.pp_bookings, text, text) from public, anon, authenticated;
grant execute on function public.pp_owner_ok(public.pp_bookings, text, text) to service_role;

revoke all on function public.pp_booking_by_id(uuid, text, text) from public;
revoke all on function public.pp_cancel(uuid, text, text) from public;
revoke all on function public.pp_give_feedback(uuid, text, text, integer, boolean, boolean, text) from public;
grant execute on function public.pp_booking_by_id(uuid, text, text) to anon, authenticated, service_role;
grant execute on function public.pp_cancel(uuid, text, text) to anon, authenticated, service_role;
grant execute on function public.pp_give_feedback(uuid, text, text, integer, boolean, boolean, text) to anon, authenticated, service_role;

grant execute on function public.pp_find_bookings(text, text) to public, anon, authenticated, service_role;

revoke all on function public.pp_book(jsonb) from public, anon, authenticated;
grant execute on function public.pp_book(jsonb) to service_role;

-- 6. keep a private copy of who owns which booking, then drop 0033 tables, limiter, indexes and column
create table if not exists public.pp_bookings_owner_backup (
  id uuid primary key, applicant_user_id uuid not null, saved_at timestamptz not null default now()
);
alter table public.pp_bookings_owner_backup enable row level security;
revoke all on table public.pp_bookings_owner_backup from public, anon, authenticated, service_role;
insert into public.pp_bookings_owner_backup (id, applicant_user_id)
select id, applicant_user_id from public.pp_bookings where applicant_user_id is not null
on conflict (id) do update set applicant_user_id = excluded.applicant_user_id, saved_at = now();

drop function if exists public.pp_rate_hit(text, integer, integer);
drop table if exists public.pp_book_attempts;
drop table if exists public.pp_rate_limits;
drop index if exists public.pp_bookings_user_slot_uniq;
drop index if exists public.pp_bookings_user_idx;
alter table public.pp_bookings drop column if exists applicant_user_id;

commit;
