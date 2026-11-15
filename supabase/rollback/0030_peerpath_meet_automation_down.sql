-- ROLLBACK for 0030_peerpath_meet_automation (staging first; production only if told).
-- Puts the database back exactly as it was before 0030:
--   * pp_book, pp_request_ip, pp_senior_me, pp_admin_all → their pre-0030 definitions
--   * pp_book callable by browsers again (as before)
--   * the Meet columns, checks and indexes removed
-- Data note: dropping the columns deletes Meet sync/attendance info on bookings.
-- Bookings themselves (and any status the cron set to 'completed') are kept.
-- App code must be reverted at the same time (the book/cancel routes need 0030).

begin;

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
begin
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

  perform pg_advisory_xact_lock(hashtext('pp_book:' || s.id::text));

  if nullif(p->>'rescheduleOf', '') is not null then
    begin
      select * into v_old from public.pp_bookings where id = (p->>'rescheduleOf')::uuid for update;
    exception when others then
      return jsonb_build_object('ok', false, 'error', 'reschedule_closed');
    end;
    if v_old.id is null or v_old.status <> 'confirmed' or v_old.start_at - now() <= interval '3 hours'
       or not public.pp_owner_ok(v_old, v_email, v_phone) then
      return jsonb_build_object('ok', false, 'error', 'reschedule_closed');
    end if;
  end if;

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

  if v_same = 0 and (
       (select count(distinct b.start_at) from public.pp_bookings b
         where b.senior_id = s.id and b.status in ('confirmed','completed') and b.id is distinct from v_old.id
           and (b.start_at at time zone 'Asia/Kolkata')::date = v_day) >= s.daily_cap
    or (select count(distinct b.start_at) from public.pp_bookings b
         where b.senior_id = s.id and b.status in ('confirmed','completed') and b.id is distinct from v_old.id
           and date_trunc('week', b.start_at at time zone 'Asia/Kolkata') = date_trunc('week', v_local)) >= s.weekly_cap) then
    return jsonb_build_object('ok', false, 'error', 'taken');
  end if;

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

revoke all on function public.pp_book(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.pp_book(jsonb) to public, anon, authenticated, service_role;

create or replace function public.pp_request_ip()
returns text language sql stable set search_path to '' as $fn$
  select split_part(coalesce(nullif(current_setting('request.headers', true),'')::json ->> 'x-forwarded-for',''), ',', 1);
$fn$;

CREATE OR REPLACE FUNCTION public.pp_senior_me(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        'rating', (select f.rating from public.pp_feedback f where f.booking_id = b.id)) order by b.start_at)
      from public.pp_bookings b where b.senior_id = s.id and b.start_at > now() - interval '60 days'), '[]'::jsonb));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pp_admin_all()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        'status', b.status, 'meetUrl', b.meet_url, 'movedFrom', b.moved_from, 'movedTo', b.moved_to, 'createdAt', b.created_at))
      from (select * from public.pp_bookings order by start_at desc limit 2000) b), '[]'::jsonb),
    'feedback', coalesce((select jsonb_object_agg(f.booking_id, jsonb_build_object(
        'rating', f.rating, 'recommend', f.recommend, 'promiseMade', f.promise_made, 'note', f.note, 'createdAt', f.created_at))
      from public.pp_feedback f), '{}'::jsonb));
end;
$function$
;

drop index if exists public.pp_bookings_meet_todo_idx;
drop index if exists public.pp_bookings_attendance_todo_idx;
drop index if exists public.pp_bookings_event_idx;
drop index if exists public.pp_bookings_email_created_idx;

alter table public.pp_bookings
  drop constraint if exists pp_bookings_meet_sync_check,
  drop constraint if exists pp_bookings_auto_result_check,
  drop column if exists calendar_event_id,
  drop column if exists meet_code,
  drop column if exists meet_sync,
  drop column if exists meet_claimed_at,
  drop column if exists meet_attempts,
  drop column if exists meet_error,
  drop column if exists attendance,
  drop column if exists auto_result,
  drop column if exists auto_checked_at,
  drop column if exists auto_check_attempts;

commit;
