-- 0013_peerpath_talk_to_senior.sql
-- PeerPath · Talk to a Senior: applicants book free Google Meet chats with current
-- Vedam students ("seniors"). Seniors set their own weekly times, days off and limits.
--
-- ALREADY APPLIED ON STAGING (kyhakenhbgcissmaacws) as migrations 0013a…0013g on
-- 2026-10-14. This file is the same schema in one place, for promoting to prod later.
-- Do not run on prod until the staging test is signed off.
--
-- Security model
--   * pp_* tables: RLS on, NO policies, no anon/authenticated grants → unreadable directly.
--   * Every read/write goes through SECURITY DEFINER functions below, which validate input.
--   * Applicants: no login. A booking id (uuid) is the key to its page; "My bookings"
--     looks up by email + last 10 digits of phone.
--   * Seniors: no login. pp_seniors.access_token (uuid) in their personal link.
--   * Admin: pp_is_admin() = is_admin() or a confirmed @vedam.org account (auth.uid()).
--   * Double booking: per-senior advisory lock + EXCLUDE constraint for 1:1 chats.

create extension if not exists btree_gist with schema extensions;

-- 1) Tables ----------------------------------------------------------------------

create table if not exists public.pp_seniors (
  id               uuid primary key default gen_random_uuid(),
  first_name       text not null check (char_length(btrim(first_name)) between 1 and 40),
  photo_url        text,
  campus           text not null check (campus in ('Pune','Gurugram')),
  year             smallint not null check (year between 1 and 4),
  home_city        text check (char_length(home_city) <= 60),
  home_state       text check (char_length(home_state) <= 60),
  residence        text check (residence in ('Hostel','Day scholar')),
  languages        text[] not null default '{}',
  topics           text[] not null default '{}',
  ask_me_about     text[] not null default '{}',
  clubs            text[] not null default '{}',
  bio              text not null default '' check (char_length(bio) <= 500),
  session_types    text[] not null default '{1:1}',
  durations        smallint[] not null default '{30}',
  meet_link        text check (meet_link is null or meet_link ~ '^https://meet\.google\.com/[a-z0-9-]+$'),
  contact_email    text not null check (contact_email ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  status           text not null default 'pending' check (status in ('pending','active','paused')),
  access_token     uuid not null default gen_random_uuid() unique,
  daily_cap        smallint not null default 2 check (daily_cap between 1 and 10),
  weekly_cap       smallint not null default 4 check (weekly_cap between 1 and 20),
  min_notice_hours smallint not null default 12 check (min_notice_hours between 12 and 72),
  paused           boolean not null default false,
  last_active_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  times_version    integer not null default 0
);
create unique index if not exists pp_seniors_contact_email_key on public.pp_seniors (lower(contact_email));
create index if not exists pp_seniors_status_idx on public.pp_seniors (status);

-- Weekly times (IST). Saving times writes a new version; only the current version counts.
create table if not exists public.pp_availability (
  id        uuid primary key default gen_random_uuid(),
  senior_id uuid not null references public.pp_seniors(id) on delete cascade,
  weekday   smallint not null check (weekday between 0 and 6),
  from_time time not null,
  to_time   time not null,
  type      text not null default '1:1' check (type in ('1:1','Group')),
  version   integer not null default 0,
  check (to_time > from_time)
);
create index if not exists pp_availability_senior_idx on public.pp_availability (senior_id);
create index if not exists pp_availability_senior_version_idx on public.pp_availability (senior_id, version);

create table if not exists public.pp_days_off (
  id        uuid primary key default gen_random_uuid(),
  senior_id uuid not null references public.pp_seniors(id) on delete cascade,
  from_date date not null,
  to_date   date not null,
  reason    text check (char_length(reason) <= 80),
  version   integer not null default 0,
  check (to_date >= from_date)
);
create index if not exists pp_days_off_senior_idx on public.pp_days_off (senior_id);
create index if not exists pp_days_off_senior_version_idx on public.pp_days_off (senior_id, version);

create table if not exists public.pp_bookings (
  id              uuid primary key default gen_random_uuid(),
  senior_id       uuid not null references public.pp_seniors(id) on delete cascade,
  start_at        timestamptz not null,
  end_at          timestamptz not null,
  type            text not null check (type in ('1:1','Group')),
  applicant_name  text not null check (char_length(btrim(applicant_name)) between 2 and 80),
  applicant_email text not null check (applicant_email ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  applicant_phone text not null check (applicant_phone ~ '^\+?[0-9]{10,15}$'),
  question        text check (char_length(question) <= 500),
  status          text not null default 'confirmed'
                  check (status in ('confirmed','completed','cancelled','rescheduled','no_show_applicant')),
  meet_url        text,
  moved_from      uuid references public.pp_bookings(id) on delete set null,
  moved_to        uuid references public.pp_bookings(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (end_at > start_at)
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pp_no_overlap_1to1') then
    alter table public.pp_bookings add constraint pp_no_overlap_1to1
      exclude using gist (senior_id with =, tstzrange(start_at, end_at) with &&)
      where (status = 'confirmed' and type = '1:1');
  end if;
end $$;
create index if not exists pp_bookings_senior_start_idx on public.pp_bookings (senior_id, start_at);
create index if not exists pp_bookings_email_idx on public.pp_bookings (lower(applicant_email));
create index if not exists pp_bookings_start_idx on public.pp_bookings (start_at desc);

create table if not exists public.pp_feedback (
  booking_id   uuid primary key references public.pp_bookings(id) on delete cascade,
  rating       smallint not null check (rating between 1 and 5),
  recommend    boolean not null,
  promise_made boolean not null,
  note         text check (char_length(note) <= 600),
  created_at   timestamptz not null default now()
);

alter table public.pp_seniors      enable row level security;
alter table public.pp_availability enable row level security;
alter table public.pp_days_off     enable row level security;
alter table public.pp_bookings     enable row level security;
alter table public.pp_feedback     enable row level security;
revoke all on public.pp_seniors, public.pp_availability, public.pp_days_off, public.pp_bookings, public.pp_feedback from anon, authenticated;
grant  all on public.pp_seniors, public.pp_availability, public.pp_days_off, public.pp_bookings, public.pp_feedback to service_role;

-- 2) Helper functions (not callable from the browser) ------------------------------

CREATE OR REPLACE FUNCTION public.pp_hhmm(t time without time zone)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$ select to_char(t, 'HH24:MI') $function$
;

CREATE OR REPLACE FUNCTION public.pp_is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(public.is_admin(), false)
      or exists (select 1 from auth.users u
                 where u.id = auth.uid()
                   and lower(u.email) like '%@vedam.org'
                   and u.email_confirmed_at is not null);
$function$
;

CREATE OR REPLACE FUNCTION public.pp_senior_public_json(s pp_seniors)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id', s.id, 'firstName', s.first_name, 'photoUrl', s.photo_url, 'campus', s.campus, 'year', s.year,
    'homeCity', s.home_city, 'homeState', s.home_state, 'residence', s.residence,
    'languages', to_jsonb(s.languages), 'topics', to_jsonb(s.topics), 'askMeAbout', to_jsonb(s.ask_me_about),
    'clubs', to_jsonb(s.clubs), 'bio', s.bio, 'sessionTypes', to_jsonb(s.session_types),
    'durations', to_jsonb(s.durations), 'status', s.status,
    'rating', (select round(avg(f.rating)::numeric, 1) from public.pp_feedback f join public.pp_bookings b on b.id = f.booking_id where b.senior_id = s.id),
    'ratingCount', (select count(*) from public.pp_feedback f join public.pp_bookings b on b.id = f.booking_id where b.senior_id = s.id),
    'sessionsDone', (select count(*) from public.pp_bookings b where b.senior_id = s.id
                       and (b.status = 'completed' or (b.status = 'confirmed' and b.end_at < now())))
  );
$function$
;

CREATE OR REPLACE FUNCTION public.pp_senior_private_json(s pp_seniors)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select public.pp_senior_public_json(s) || jsonb_build_object(
    'meetLink', s.meet_link, 'contactEmail', s.contact_email, 'createdAt', s.created_at,
    'lastActiveAt', s.last_active_at);
$function$
;

CREATE OR REPLACE FUNCTION public.pp_settings_json(s pp_seniors)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object('dailyCap', s.daily_cap, 'weeklyCap', s.weekly_cap,
                            'minNoticeHours', s.min_notice_hours, 'paused', s.paused);
$function$
;

CREATE OR REPLACE FUNCTION public.pp_rules_json(p_senior uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('weekday', a.weekday, 'from', public.pp_hhmm(a.from_time),
                                               'to', public.pp_hhmm(a.to_time), 'type', a.type)
                            order by a.weekday, a.from_time), '[]'::jsonb)
  from public.pp_availability a join public.pp_seniors s on s.id = a.senior_id and a.version = s.times_version
  where a.senior_id = p_senior;
$function$
;

CREATE OR REPLACE FUNCTION public.pp_blocks_json(p_senior uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('from', d.from_date, 'to', d.to_date, 'reason', d.reason)
                            order by d.from_date), '[]'::jsonb)
  from public.pp_days_off d join public.pp_seniors s on s.id = d.senior_id and d.version = s.times_version
  where d.senior_id = p_senior and d.to_date >= (now() at time zone 'Asia/Kolkata')::date - 1;
$function$
;

CREATE OR REPLACE FUNCTION public.pp_slot_allowed(p_senior uuid, p_type text, p_local timestamp without time zone, p_dur integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select exists (
           select 1 from public.pp_availability a join public.pp_seniors s on s.id = a.senior_id and a.version = s.times_version
           where a.senior_id = p_senior and a.type = p_type
             and a.weekday = extract(dow from p_local)::int
             and p_local::time >= a.from_time
             and (p_local + make_interval(mins => p_dur))::time <= a.to_time
             and (p_local + make_interval(mins => p_dur))::date = p_local::date
             and ((extract(epoch from (p_local::time - a.from_time)) / 60)::int % 30) = 0)
     and not exists (
           select 1 from public.pp_days_off d join public.pp_seniors s on s.id = d.senior_id and d.version = s.times_version
           where d.senior_id = p_senior and p_local::date between d.from_date and d.to_date);
$function$
;

CREATE OR REPLACE FUNCTION public.pp_booking_json(b pp_bookings)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.pp_clean_profile(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  topics   text[] := array['VSAT prep','Interview prep','Curriculum','Campus life','Hackathons','Open source','Internships','Placements','Hostel & mess','Moving to a new city'];
  langs    text[] := array['English','Hindi','Marathi','Bengali','Gujarati','Punjabi','Tamil','Telugu','Kannada','Malayalam','Odia','Assamese'];
  clubs    text[] := array['Competitive Coding','ICPC','Open Source','Entrepreneurship','Cultural'];
  o jsonb;
  a_topics text[]; a_langs text[]; a_clubs text[]; a_types text[]; a_durs smallint[]; a_ask text[];
  v_meet text := nullif(btrim(coalesce(p->>'meetLink', '')), '');
begin
  select coalesce(array_agg(x), '{}') into a_topics from jsonb_array_elements_text(coalesce(p->'topics', '[]')) x where x = any (topics);
  select coalesce(array_agg(x), '{}') into a_langs  from jsonb_array_elements_text(coalesce(p->'languages', '[]')) x where x = any (langs);
  select coalesce(array_agg(x), '{}') into a_clubs  from jsonb_array_elements_text(coalesce(p->'clubs', '[]')) x where x = any (clubs);
  select coalesce(array_agg(x), '{}') into a_types  from jsonb_array_elements_text(coalesce(p->'sessionTypes', '[]')) x where x in ('1:1','Group');
  select coalesce(array_agg(x::smallint), '{}') into a_durs from jsonb_array_elements_text(coalesce(p->'durations', '[]')) x where x in ('15','30');
  select coalesce(array_agg(left(btrim(x), 40)), '{}') into a_ask
    from (select x from jsonb_array_elements_text(coalesce(p->'askMeAbout', '[]')) x where btrim(x) <> '' limit 6) t;
  if v_meet is not null and v_meet !~ '^https://meet\.google\.com/[a-z0-9-]+$' then
    v_meet := 'https://' || regexp_replace(v_meet, '^(https?://)?', '');
  end if;
  if char_length(btrim(coalesce(p->>'firstName', ''))) not between 1 and 40
     or coalesce(p->>'campus', '') not in ('Pune','Gurugram')
     or coalesce((p->>'year')::int, 0) not between 1 and 4
     or cardinality(a_topics) = 0 or cardinality(a_langs) = 0 or cardinality(a_types) = 0 or cardinality(a_durs) = 0
     or (v_meet is not null and v_meet !~ '^https://meet\.google\.com/[a-z0-9-]+$') then
    raise exception 'invalid_profile';
  end if;
  o := jsonb_build_object(
    'first_name', btrim(p->>'firstName'), 'campus', p->>'campus', 'year', (p->>'year')::int,
    'home_city', left(nullif(btrim(coalesce(p->>'homeCity', '')), ''), 60),
    'home_state', left(nullif(btrim(coalesce(p->>'homeState', '')), ''), 60),
    'residence', case when p->>'residence' in ('Hostel','Day scholar') then p->>'residence' end,
    'languages', to_jsonb(a_langs), 'topics', to_jsonb(a_topics), 'ask_me_about', to_jsonb(a_ask),
    'clubs', to_jsonb(a_clubs), 'bio', left(btrim(coalesce(p->>'bio', '')), 500),
    'session_types', to_jsonb(a_types), 'durations', to_jsonb(a_durs), 'meet_link', v_meet);
  return o;
end;
$function$
;

-- 3) Public API (called from the app with the anon key / user session) -------------

CREATE OR REPLACE FUNCTION public.pp_public()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'seniors',  coalesce((select jsonb_agg(public.pp_senior_public_json(l) order by l.created_at) from public.pp_seniors l where l.status = 'active'), '[]'::jsonb),
    'rules',    coalesce((select jsonb_object_agg(l.id, public.pp_rules_json(l.id)) from public.pp_seniors l where l.status = 'active'), '{}'::jsonb),
    'blocks',   coalesce((select jsonb_object_agg(l.id, public.pp_blocks_json(l.id)) from public.pp_seniors l where l.status = 'active'), '{}'::jsonb),
    'settings', coalesce((select jsonb_object_agg(l.id, public.pp_settings_json(l)) from public.pp_seniors l where l.status = 'active'), '{}'::jsonb),
    'busy',     coalesce((select jsonb_agg(jsonb_build_object('seniorId', b.senior_id, 'start', b.start_at, 'end', b.end_at, 'type', b.type))
                          from public.pp_bookings b join public.pp_seniors l on l.id = b.senior_id and l.status = 'active'
                          where b.status in ('confirmed','completed') and b.end_at > now() - interval '7 days'), '[]'::jsonb),
    'now', now()
  );
$function$
;

CREATE OR REPLACE FUNCTION public.pp_book(p jsonb)
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

  -- one booking at a time per senior (caps, group seats and buffers stay exact)
  perform pg_advisory_xact_lock(hashtext('pp_book:' || s.id::text));

  -- reschedule: the old chat must still be changeable
  if nullif(p->>'rescheduleOf', '') is not null then
    begin
      select * into v_old from public.pp_bookings where id = (p->>'rescheduleOf')::uuid for update;
    exception when others then
      return jsonb_build_object('ok', false, 'error', 'reschedule_closed');
    end;
    if v_old.id is null or v_old.status <> 'confirmed' or v_old.start_at - now() <= interval '3 hours' then
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
$function$
;

CREATE OR REPLACE FUNCTION public.pp_cancel(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.pp_bookings;
begin
  select * into b from public.pp_bookings where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if b.status <> 'confirmed' or b.start_at - now() <= interval '3 hours' then
    return jsonb_build_object('ok', false, 'error', 'too_late');
  end if;
  update public.pp_bookings set status = 'cancelled', updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pp_bookings_by_ids(p_ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(public.pp_booking_json(b) order by b.start_at desc), '[]'::jsonb)
  from (select * from public.pp_bookings where id = any (p_ids[1:50])) b;
$function$
;

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
$function$
;

CREATE OR REPLACE FUNCTION public.pp_give_feedback(p_id uuid, p_rating integer, p_recommend boolean, p_promise boolean, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.pp_bookings;
begin
  select * into b from public.pp_bookings where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
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
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pp_senior_create(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c jsonb; v_email text := lower(btrim(coalesce(p->>'contactEmail', ''))); r public.pp_seniors;
begin
  if v_email !~* '^[^\s@]+@[^\s@]+\.[^\s@]+$' then return jsonb_build_object('ok', false, 'error', 'email'); end if;
  begin c := public.pp_clean_profile(p);
  exception when others then return jsonb_build_object('ok', false, 'error', 'invalid'); end;
  if exists (select 1 from public.pp_seniors where lower(contact_email) = v_email) then
    return jsonb_build_object('ok', false, 'error', 'exists');
  end if;
  if (select count(*) from public.pp_seniors where created_at > now() - interval '1 hour') >= 20 then
    return jsonb_build_object('ok', false, 'error', 'busy');
  end if;
  insert into public.pp_seniors (first_name, campus, year, home_city, home_state, residence, languages, topics,
                                 ask_me_about, clubs, bio, session_types, durations, meet_link, contact_email, last_active_at)
  values (c->>'first_name', c->>'campus', (c->>'year')::smallint, c->>'home_city', c->>'home_state', c->>'residence',
          array(select jsonb_array_elements_text(c->'languages')), array(select jsonb_array_elements_text(c->'topics')),
          array(select jsonb_array_elements_text(c->'ask_me_about')), array(select jsonb_array_elements_text(c->'clubs')),
          c->>'bio', array(select jsonb_array_elements_text(c->'session_types')),
          array(select (jsonb_array_elements_text(c->'durations'))::smallint), c->>'meet_link', v_email, now())
  returning * into r;
  return jsonb_build_object('ok', true, 'id', r.id, 'token', r.access_token);
end;
$function$
;

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

CREATE OR REPLACE FUNCTION public.pp_senior_save_profile(p_token uuid, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c jsonb; v_email text := lower(btrim(coalesce(p->>'contactEmail', ''))); v_id uuid;
begin
  select id into v_id from public.pp_seniors where access_token = p_token;
  if v_id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if v_email !~* '^[^\s@]+@[^\s@]+\.[^\s@]+$' then return jsonb_build_object('ok', false, 'error', 'email'); end if;
  if exists (select 1 from public.pp_seniors where lower(contact_email) = v_email and id <> v_id) then
    return jsonb_build_object('ok', false, 'error', 'exists');
  end if;
  begin c := public.pp_clean_profile(p);
  exception when others then return jsonb_build_object('ok', false, 'error', 'invalid'); end;
  update public.pp_seniors set
    first_name = c->>'first_name', campus = c->>'campus', year = (c->>'year')::smallint,
    home_city = c->>'home_city', home_state = c->>'home_state', residence = c->>'residence',
    languages = array(select jsonb_array_elements_text(c->'languages')),
    topics = array(select jsonb_array_elements_text(c->'topics')),
    ask_me_about = array(select jsonb_array_elements_text(c->'ask_me_about')),
    clubs = array(select jsonb_array_elements_text(c->'clubs')), bio = c->>'bio',
    session_types = array(select jsonb_array_elements_text(c->'session_types')),
    durations = array(select (jsonb_array_elements_text(c->'durations'))::smallint),
    meet_link = c->>'meet_link', contact_email = v_email, updated_at = now(), last_active_at = now()
  where id = v_id;
  return jsonb_build_object('ok', true);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pp_senior_save_times(p_token uuid, p_rules jsonb, p_blocks jsonb, p_settings jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid; v_ver int;
begin
  select id, times_version + 1 into v_id, v_ver from public.pp_seniors where access_token = p_token for update;
  if v_id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if jsonb_typeof(p_rules) <> 'array' or jsonb_array_length(p_rules) > 40
     or jsonb_typeof(p_blocks) <> 'array' or jsonb_array_length(p_blocks) > 50 then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  begin
    insert into public.pp_availability (senior_id, version, weekday, from_time, to_time, type)
      select v_id, v_ver, (r->>'weekday')::smallint, (r->>'from')::time, (r->>'to')::time, coalesce(r->>'type', '1:1')
      from jsonb_array_elements(p_rules) r;
    insert into public.pp_days_off (senior_id, version, from_date, to_date, reason)
      select v_id, v_ver, (d->>'from')::date, coalesce(nullif(d->>'to', ''), d->>'from')::date,
             left(nullif(btrim(coalesce(d->>'reason', '')), ''), 80)
      from jsonb_array_elements(p_blocks) d;
    update public.pp_seniors set
      times_version = v_ver,
      daily_cap = least(greatest(coalesce((p_settings->>'dailyCap')::int, daily_cap), 1), 10),
      weekly_cap = least(greatest(coalesce((p_settings->>'weeklyCap')::int, weekly_cap), 1), 20),
      min_notice_hours = least(greatest(coalesce((p_settings->>'minNoticeHours')::int, min_notice_hours), 12), 72),
      paused = coalesce((p_settings->>'paused')::boolean, paused),
      updated_at = now(), last_active_at = now()
    where id = v_id;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end;
  return jsonb_build_object('ok', true);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pp_senior_mark(p_token uuid, p_booking uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;
begin
  select id into v_id from public.pp_seniors where access_token = p_token;
  if v_id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if p_status not in ('completed','no_show_applicant','confirmed') then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  update public.pp_bookings set status = p_status, updated_at = now()
  where id = p_booking and senior_id = v_id and start_at < now()
    and status in ('confirmed','completed','no_show_applicant');
  if not found then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  return jsonb_build_object('ok', true);
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

CREATE OR REPLACE FUNCTION public.pp_admin_set_status(p_senior uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.pp_is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_status not in ('pending','active','paused') then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  update public.pp_seniors set status = p_status, updated_at = now() where id = p_senior;
  return jsonb_build_object('ok', found);
end;
$function$
;

-- 4) Privileges: helpers are internal; the API functions are callable from the app ----

revoke all on function public.pp_hhmm(time) from public, anon, authenticated;
revoke all on function public.pp_senior_public_json(public.pp_seniors) from public, anon, authenticated;
revoke all on function public.pp_senior_private_json(public.pp_seniors) from public, anon, authenticated;
revoke all on function public.pp_settings_json(public.pp_seniors) from public, anon, authenticated;
revoke all on function public.pp_rules_json(uuid) from public, anon, authenticated;
revoke all on function public.pp_blocks_json(uuid) from public, anon, authenticated;
revoke all on function public.pp_slot_allowed(uuid, text, timestamp, integer) from public, anon, authenticated;
revoke all on function public.pp_booking_json(public.pp_bookings) from public, anon, authenticated;
revoke all on function public.pp_clean_profile(jsonb) from public, anon, authenticated;

revoke all on function public.pp_is_admin() from public;
revoke all on function public.pp_public() from public;
revoke all on function public.pp_book(jsonb) from public;
revoke all on function public.pp_cancel(uuid) from public;
revoke all on function public.pp_bookings_by_ids(uuid[]) from public;
revoke all on function public.pp_find_bookings(text, text) from public;
revoke all on function public.pp_give_feedback(uuid, integer, boolean, boolean, text) from public;
revoke all on function public.pp_senior_create(jsonb) from public;
revoke all on function public.pp_senior_me(uuid) from public;
revoke all on function public.pp_senior_save_profile(uuid, jsonb) from public;
revoke all on function public.pp_senior_save_times(uuid, jsonb, jsonb, jsonb) from public;
revoke all on function public.pp_senior_mark(uuid, uuid, text) from public;
revoke all on function public.pp_admin_all() from public;
revoke all on function public.pp_admin_set_status(uuid, text) from public;

grant execute on function public.pp_is_admin() to anon, authenticated;
grant execute on function public.pp_public() to anon, authenticated;
grant execute on function public.pp_book(jsonb) to anon, authenticated;
grant execute on function public.pp_cancel(uuid) to anon, authenticated;
grant execute on function public.pp_bookings_by_ids(uuid[]) to anon, authenticated;
grant execute on function public.pp_find_bookings(text, text) to anon, authenticated;
grant execute on function public.pp_give_feedback(uuid, integer, boolean, boolean, text) to anon, authenticated;
grant execute on function public.pp_senior_create(jsonb) to anon, authenticated;
grant execute on function public.pp_senior_me(uuid) to anon, authenticated;
grant execute on function public.pp_senior_save_profile(uuid, jsonb) to anon, authenticated;
grant execute on function public.pp_senior_save_times(uuid, jsonb, jsonb, jsonb) to anon, authenticated;
grant execute on function public.pp_senior_mark(uuid, uuid, text) to anon, authenticated;
grant execute on function public.pp_admin_all() to anon, authenticated;
grant execute on function public.pp_admin_set_status(uuid, text) to anon, authenticated;
