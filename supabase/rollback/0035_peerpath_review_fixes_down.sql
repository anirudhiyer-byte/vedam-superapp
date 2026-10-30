-- Rollback for 0035_peerpath_review_fixes.sql (run before 0034's rollback)
-- Puts pp_book_core (0033), pp_my_contact (0034) and vsat_payments_guard (0032) back
-- exactly as they were, restores the earlier service_role / sequence grants, removes
-- the cleanup job and the helper functions, and makes pp_bookings.applicant_phone
-- NOT NULL again (refuses if a booking has no phone). Runs as ONE transaction.
-- Revert the app code first: the 0033 core answers PHONE_MISSING, not EMAIL_NOT_VERIFIED.
-- Read before using on production: this is an EXACT restore, so it brings back the pre-review
-- contact rule (application / profile values used for contact) and the sequence grant to
-- anon/authenticated. Prefer fixing forward with a new migration.
begin;

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

create or replace function public.pp_my_contact()
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare
  c_email constant text := '^[^\s@]+@[^\s@]+\.[^\s@]+$';
  c_phone constant text := '^\+?[0-9]{10,15}$';
  v_uid uuid := auth.uid();
  am_name text; am_email text; am_phone text;
  pr_name text; pr_email text; pr_phone text;
  au_email text; au_phone text;
  v_name text; v_email text; v_phone text;
begin
  if v_uid is null then return null; end if;
  select am.registered_name, am.registered_email, am.registered_mobile
    into am_name, am_email, am_phone
    from public.application_manager am where am.lead_id = v_uid
    order by am.created_at desc nulls last limit 1;
  select pr.full_name, pr.email, pr.phone into pr_name, pr_email, pr_phone
    from public.profiles pr where pr.id = v_uid;
  select u.email, u.phone into au_email, au_phone from auth.users u where u.id = v_uid;

  v_email := case
    when lower(btrim(am_email)) ~* c_email then lower(btrim(am_email))
    when lower(btrim(pr_email)) ~* c_email then lower(btrim(pr_email))
    when lower(btrim(au_email)) ~* c_email then lower(btrim(au_email)) end;
  v_phone := case
    when regexp_replace(coalesce(am_phone, ''), '[\s-]', '', 'g') ~ c_phone then regexp_replace(am_phone, '[\s-]', '', 'g')
    when regexp_replace(coalesce(pr_phone, ''), '[\s-]', '', 'g') ~ c_phone then regexp_replace(pr_phone, '[\s-]', '', 'g')
    when regexp_replace(coalesce(au_phone, ''), '[\s-]', '', 'g') ~ c_phone then regexp_replace(au_phone, '[\s-]', '', 'g') end;
  v_name := left(coalesce(nullif(btrim(am_name), ''), nullif(btrim(pr_name), ''), 'Applicant'), 80);
  if char_length(v_name) < 2 then v_name := 'Applicant'; end if;

  return jsonb_build_object('name', v_name, 'email', v_email, 'phone', v_phone,
                            'complete', v_email is not null and v_phone is not null);
end $fn$;

create or replace function public.vsat_payments_guard()
returns trigger language plpgsql set search_path to '' as $fn$
declare
  v_sim boolean := coalesce(current_setting('vedam.allow_simulated_payments', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if new.provider = 'simulated' and not v_sim then
      raise exception 'simulated payments are not allowed here' using errcode = '42501';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.provider = 'simulated' and v_sim then
      return old;
    end if;
  end if;
  raise exception 'vsat_payments is write-once (% blocked)', tg_op using errcode = '42501';
end $fn$;

revoke all on function public.pp_book_core(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.pp_my_contact() from public, anon;
grant execute on function public.pp_my_contact() to authenticated;
revoke all on function public.vsat_payments_guard() from public, anon, authenticated;

grant all on table public.app_flags to service_role;
grant all on table public.vsat_payments to service_role;
grant all on table public.pp_book_attempts to service_role;
grant all on table public.pp_rate_limits to service_role;
grant select, update, usage on sequence public.pp_book_attempts_id_seq to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'peerpath-log-cleanup') then
    perform cron.unschedule('peerpath-log-cleanup');
  end if;
end $$;
drop function if exists public.pp_cleanup_logs();
drop function if exists public.pp_contact_for(uuid);

-- phone back to NOT NULL. Bookings made without a phone (allowed since 0035) would break
-- that, so the rollback stops instead of guessing a value; nothing above is kept either
-- (one transaction). Handle those rows first (they are listed by this query):
--   select id, applicant_email, start_at, status from public.pp_bookings where applicant_phone is null;
do $$
declare n int;
begin
  select count(*) into n from public.pp_bookings where applicant_phone is null;
  if n > 0 then
    raise exception 'rollback 0035 stopped: % booking(s) have no phone (made after 0035). Handle them first, then re-run.', n;
  end if;
end $$;
alter table public.pp_bookings alter column applicant_phone set not null;

commit;
