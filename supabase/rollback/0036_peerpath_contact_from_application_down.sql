-- Rollback of 0036 · exact restore of the 0035 pp_contact_for / pp_book_core and the
-- 0030 pp_booking_json (bodies copied verbatim).
-- Revert the app code first: the 0035 core answers EMAIL_NOT_VERIFIED, not EMAIL_MISSING
-- (the app still understands EMAIL_NOT_VERIFIED, so an older DB with newer app also works).
-- Effect: phone-OTP users without a verified login email get EMAIL_NOT_VERIFIED again.

create or replace function public.pp_contact_for(p_uid uuid)
returns jsonb language plpgsql stable set search_path to '' as $fn$
declare
  c_email constant text := '^[^\s@]+@[^\s@]+\.[^\s@]+$';
  c_phone constant text := '^\+?[0-9]{10,15}$';
  am_name text; pr_name text; au_name text;
  au_email text; au_phone text; au_email_at timestamptz; au_phone_at timestamptz;
  v_name text; v_email text; v_phone text;
begin
  if p_uid is null then return null; end if;
  select am.registered_name into am_name
    from public.application_manager am where am.lead_id = p_uid
    order by am.created_at desc nulls last limit 1;
  select pr.full_name into pr_name from public.profiles pr where pr.id = p_uid;
  select u.email, u.email_confirmed_at, u.phone, u.phone_confirmed_at, u.raw_user_meta_data ->> 'full_name'
    into au_email, au_email_at, au_phone, au_phone_at, au_name
    from auth.users u where u.id = p_uid;

  -- only what Supabase Auth has verified by OTP
  v_email := case when au_email_at is not null and lower(btrim(au_email)) ~* c_email then lower(btrim(au_email)) end;
  v_phone := regexp_replace(coalesce(au_phone, ''), '[\s-]', '', 'g');
  v_phone := case when au_phone_at is not null and v_phone ~ c_phone
                  then case when left(v_phone, 1) = '+' then v_phone else '+' || v_phone end end;
  v_name := left(coalesce(nullif(btrim(am_name), ''), nullif(btrim(pr_name), ''), nullif(btrim(au_name), ''), 'Applicant'), 80);
  if char_length(v_name) < 2 then v_name := 'Applicant'; end if;
  return jsonb_build_object('name', v_name, 'email', v_email, 'phone', v_phone);
end $fn$;

create or replace function public.pp_book_core(p_uid uuid, p jsonb)
returns jsonb language plpgsql set search_path to '' as $fn$
declare
  c_uuid     constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
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
  v_contact  jsonb;
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

  -- ── contact details: VERIFIED login email (required) + phone (optional) — see pp_contact_for ──
  v_contact := public.pp_contact_for(p_uid);
  v_email := v_contact->>'email';
  v_phone := v_contact->>'phone';   -- NULL when the login has no OTP-verified phone
  v_name  := v_contact->>'name';
  if v_email is null then
    return jsonb_build_object('ok', false, 'code', 'EMAIL_NOT_VERIFIED');
  end if;

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
    -- a move onto a time you already hold is not a success (the move was rolled back)
    if v_resched is not null then
      return jsonb_build_object('ok', false, 'code', 'RESCHEDULE_CLOSED');
    end if;
    -- a parallel identical request won the race: hand back its booking
    select b.id into v_id from public.pp_bookings b
     where b.applicant_user_id = p_uid and b.senior_id = v_senior and b.start_at = v_start and b.status = 'confirmed'
     limit 1;
    if v_id is not null then
      return jsonb_build_object('ok', true, 'code', 'OK', 'id', v_id, 'repeat', true);
    end if;
    return jsonb_build_object('ok', false, 'code', 'SLOT_UNAVAILABLE');
end $fn$;


create or replace function public.pp_booking_json(b public.pp_bookings)
returns jsonb language sql stable set search_path to '' as $fn$
  select jsonb_build_object(
    'id', b.id, 'seniorId', b.senior_id, 'start', b.start_at, 'end', b.end_at, 'type', b.type,
    'name', b.applicant_name, 'email', b.applicant_email, 'phone', b.applicant_phone,
    'question', b.question, 'status', b.status,
    'meetUrl', case when b.status = 'confirmed' then coalesce(b.meet_url, s.meet_link) end,
    'movedFrom', b.moved_from, 'movedTo', b.moved_to, 'createdAt', b.created_at,
    'feedbackGiven', exists (select 1 from public.pp_feedback f where f.booking_id = b.id),
    'senior', jsonb_build_object('id', s.id, 'firstName', s.first_name, 'campus', s.campus,
                                 'year', s.year, 'status', s.status)
  )
  from public.pp_seniors s where s.id = b.senior_id;
$fn$;

revoke all on function public.pp_contact_for(uuid) from public, anon, authenticated, service_role;
revoke all on function public.pp_book_core(uuid, jsonb) from public, anon, authenticated, service_role;
