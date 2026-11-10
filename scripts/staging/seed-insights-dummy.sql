-- STAGING ONLY · seed ~5,000 FAKE users with product activity, to test /admin/insights at scale.
--
-- How: run each PART below, in order, in the STAGING SQL editor (project kyhakenhbgcissmaacws).
--      Each part is self-contained (run it as one block). Remove everything again with
--      scripts/staging/cleanup-insights-dummy.sql.
--
-- What it creates (all tagged so the cleanup can find every row):
--   * auth.users: email zzdummy-NNNNN@example.invalid, raw_user_meta_data.dummy_seed = 'insights-scale-v1'
--     (no password, no phone, .invalid email domain → nobody can log in and nothing can be delivered)
--     → the normal sign-up trigger creates their profiles / leads rows, exactly like a real sign-up
--   * 5 bootcamps: event_code ZZDUMMY-BC1..5, status 'draft', visibility 'private' (hidden from /events)
--   * CodeSprint enrolments + lessons, bootcamp registrations (+ Zoom attendance), PYQ attempts,
--     College Predictor runs, VSAT early registrations (+ a few 'simulated' fee payments),
--     traffic sessions (session_id 'zzdummy-…') and daily active time.
--
-- Safety (checked before seeding, 2026-11-06):
--   * no trigger on these tables calls the network (no pg_net / http / webhook in any of them),
--     no Supabase database webhooks, the only pg_cron job is peerpath-log-cleanup
--   * staging has 0 WhatsApp automations and 0 comms journeys; Vercel crons run only on production
--   * every part refuses to run unless app_flags.environment = 'staging'
--
-- Randomness is deterministic (md5 of the user number), so a re-seed gives the same data.

-- ════════════════════════════════════════════════════════════════════════════════
-- PART 1 · bootcamps + users + profile details
-- ════════════════════════════════════════════════════════════════════════════════
do $$ begin
  if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
    raise exception 'Refusing to run: this is not the staging database (app_flags.environment <> staging).';
  end if;
  if exists (select 1 from auth.users where raw_user_meta_data->>'dummy_seed' = 'insights-scale-v1') then
    raise exception 'Dummy data is already seeded. Run cleanup-insights-dummy.sql first.';
  end if;
end $$;

create or replace function pg_temp.zr(n int, k int) returns float8 language sql immutable
as $$ select (('x' || substr(md5(n::text || ':' || k::text), 1, 8))::bit(32)::bigint)::float8 / 4294967296 $$;

insert into public.events (event_code, slug, category, name, mode, starts_at, duration_minutes, status, visibility, is_paid, require_signin)
select 'ZZDUMMY-BC' || k, 'zzdummy-bootcamp-' || k, 'Bootcamp', 'ZZ Dummy Bootcamp ' || k || ' (insights test data)', 'online',
       date_trunc('day', now()) - make_interval(days => d) + interval '13 hours 30 minutes', 120, 'draft', 'private', false, true
from (values (1, 95), (2, 62), (3, 30), (4, 3), (5, -6)) v(k, d);

insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, raw_app_meta_data,
                        created_at, updated_at, email_confirmed_at, is_sso_user, is_anonymous)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       'zzdummy-' || lpad(s.n::text, 5, '0') || '@example.invalid',
       jsonb_strip_nulls(jsonb_build_object(
         'dummy_seed', 'insights-scale-v1', 'dummy_n', s.n,
         'full_name', 'ZZ Dummy ' || lpad(s.n::text, 5, '0'),
         'stream', s.stream, 'stream_other', case when s.stream = 'Others' then 'Commerce' end,
         'grad_year', s.grad_year::text,
         'utm_source', s.src, 'utm_medium', case when s.src is not null then 'dummy' end,
         'utm_campaign', case when s.src is not null then 'zz_dummy_campaign' end,
         'landing_path', s.landing, 'consent_given', 'true')),
       '{"provider":"email","providers":["email"]}'::jsonb,
       s.signup, s.signup, case when pg_temp.zr(s.n, 11) < 0.78 then s.signup end, false, false
from (
  select n,
    now() - interval '120 days' * power(pg_temp.zr(n, 1), 1.4) - interval '2 minutes' as signup,
    case when pg_temp.zr(n, 3) < 0.45 then 'PCM' when pg_temp.zr(n, 3) < 0.60 then 'PCMB'
         when pg_temp.zr(n, 3) < 0.75 then 'PCB' when pg_temp.zr(n, 3) < 0.85 then 'Others' end as stream,
    case when pg_temp.zr(n, 4) < 0.15 then 2025 when pg_temp.zr(n, 4) < 0.50 then 2026
         when pg_temp.zr(n, 4) < 0.80 then 2027 when pg_temp.zr(n, 4) < 0.90 then 2028 end as grad_year,
    case when pg_temp.zr(n, 5) < 0.22 then (array['WhatsApp', 'whatsapp', ' Whatsapp ', 'WHATSAPP'])[1 + floor(pg_temp.zr(n, 6) * 4)::int]
         when pg_temp.zr(n, 5) < 0.40 then (array['meta', 'Meta', 'META'])[1 + floor(pg_temp.zr(n, 6) * 3)::int]
         when pg_temp.zr(n, 5) < 0.52 then (array['instagram', 'Instagram'])[1 + floor(pg_temp.zr(n, 6) * 2)::int]
         when pg_temp.zr(n, 5) < 0.62 then 'google'
         when pg_temp.zr(n, 5) < 0.69 then 'youtube'
         when pg_temp.zr(n, 5) < 0.75 then 'telegram'
         when pg_temp.zr(n, 5) < 0.80 then 'referral'
         when pg_temp.zr(n, 5) < 0.84 then 'codesprint_launch' end as src,
    case when pg_temp.zr(n, 7) < 0.10 then '/codesprint' else '/' end as landing
  from generate_series(1, 5000) n
) s;

-- state / city (the sign-up form asks for them later; ~15% have not filled them in)
update public.profiles p
set created_at = u.created_at,
    state = case when pg_temp.zr(x.n, 9) < 0.04 then lower(st.state) else st.state end,
    city  = case when st.state is not null then 'Dummy City' end
from auth.users u
cross join lateral (select (u.raw_user_meta_data->>'dummy_n')::int as n) x
left join lateral (
  select w.state from (values
    ('Uttar Pradesh', .14), ('Maharashtra', .24), ('Bihar', .32), ('Rajasthan', .39), ('Madhya Pradesh', .45),
    ('Delhi', .51), ('Karnataka', .56), ('Tamil Nadu', .61), ('West Bengal', .66), ('Gujarat', .70),
    ('Telangana', .74), ('Haryana', .78), ('Andhra Pradesh', .81), ('Odisha', .84), ('Kerala', .86),
    ('Punjab', .88), ('Jharkhand', .90), ('Assam', .915), ('Uttarakhand', .93), ('Chhattisgarh', .94),
    ('Jammu and Kashmir', .95), ('Himachal Pradesh', .955), ('Goa', .958), ('Ladakh', .959),
    ('Dadra and Nagar Haveli and Daman and Diu', .96), ('Chandigarh', .963), ('Manipur', .965)
  ) w(state, cum)
  where pg_temp.zr(x.n, 10) >= 0.15 and w.cum > pg_temp.zr(x.n, 8)
  order by w.cum limit 1
) st on true
where p.id = u.id and u.raw_user_meta_data->>'dummy_seed' = 'insights-scale-v1';

-- ════════════════════════════════════════════════════════════════════════════════
-- PART 2 · product activity (CodeSprint, Bootcamp, PYQ, College Predictor)
-- ════════════════════════════════════════════════════════════════════════════════
do $$ begin
  if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
    raise exception 'Refusing to run: this is not the staging database (app_flags.environment <> staging).';
  end if;
  if exists (select 1 from public.cs_enrollments e join auth.users u on u.id = e.user_id
             where u.raw_user_meta_data->>'dummy_seed' = 'insights-scale-v1') then
    raise exception 'Part 2 already ran.';
  end if;
end $$;

create or replace function pg_temp.zr(n int, k int) returns float8 language sql immutable
as $$ select (('x' || substr(md5(n::text || ':' || k::text), 1, 8))::bit(32)::bigint)::float8 / 4294967296 $$;

drop table if exists pg_temp.zd;
create temp table zd as
select u.id, (u.raw_user_meta_data->>'dummy_n')::int as n, p.created_at as signup, p.full_name, p.email,
       pg_temp.zr((u.raw_user_meta_data->>'dummy_n')::int, 20) as e,   -- how engaged this person is (0..1)
       (coalesce(u.raw_user_meta_data->>'utm_source', '') ilike '%sprint%'
        or coalesce(u.raw_user_meta_data->>'landing_path', '') ilike '%codesprint%') as cs_link
from auth.users u join public.profiles p on p.id = u.id
where u.raw_user_meta_data->>'dummy_seed' = 'insights-scale-v1';

-- CodeSprint: enrol (most people who came through a CodeSprint link, plus engaged others)
insert into public.cs_enrollments (user_id, enrolled_at)
select d.id, d.signup + (now() - d.signup) * power(pg_temp.zr(d.n, 22), 3)
from zd d
where pg_temp.zr(d.n, 21) < case when d.cs_link then 0.7 else 0.12 + 0.4 * d.e end;

-- lessons done (staging has 2 lessons)
insert into public.cs_progress (user_id, lesson_id, completed_at)
select d.id, l.id, least(now() - interval '1 minute', e.enrolled_at + make_interval(hours => (l.rn * 20 + floor(pg_temp.zr(d.n, 24) * 72))::int))
from zd d
join public.cs_enrollments e on e.user_id = d.id
join (select id, row_number() over (order by "order", id) as rn from public.cs_lessons) l
  on (l.rn = 1 and pg_temp.zr(d.n, 23) < 0.55) or (l.rn = 2 and pg_temp.zr(d.n, 23) < 0.25);

-- Bootcamp: first registration for a bootcamp after sign-up; engaged people sometimes register for a second
insert into public.event_registrations (event_id, event_code, user_id, user_email, full_name, created_at, joined, attended_minutes, github_url)
select ev.id, ev.event_code, d.id, d.email, d.full_name,
       d.signup + (least(ev.starts_at, now()) - d.signup) * pg_temp.zr(d.n, 32 + ev.k),
       (ev.starts_at < now() and pg_temp.zr(d.n, 33 + ev.k) < 0.35 + 0.4 * d.e),
       case when ev.starts_at < now() and pg_temp.zr(d.n, 33 + ev.k) < 0.35 + 0.4 * d.e then
         case when pg_temp.zr(d.n, 34 + ev.k) < 0.10 then 2 else 5 + floor(115 * power(pg_temp.zr(d.n, 35 + ev.k), 0.7))::int end else 0 end,
       case when ev.starts_at < now() and pg_temp.zr(d.n, 33 + ev.k) < 0.35 + 0.4 * d.e and pg_temp.zr(d.n, 36 + ev.k) < 0.2
            then 'https://github.com/zzdummy/project-' || d.n end
from zd d
cross join lateral (
  select e.id, e.event_code, e.starts_at, (row_number() over (order by e.starts_at))::int as k
  from public.events e
  where e.event_code like 'ZZDUMMY-BC%' and e.starts_at > d.signup
) ev
where ev.k <= case when pg_temp.zr(d.n, 31) < 0.12 + 0.35 * d.e then case when pg_temp.zr(d.n, 37) < 0.25 * d.e then 2 else 1 end else 0 end;

-- PYQ: start a paper; most submit; engaged people start a second one
insert into public.pyq_attempts (user_id, paper_id, status, started_at, submitted_at, duration_secs, score, max_score, created_at, session_id)
select d.id, pp.id,
       case when pg_temp.zr(d.n, 43 + a.k) < 0.6 then 'submitted' else 'in_progress' end,
       a.at, case when pg_temp.zr(d.n, 43 + a.k) < 0.6 then a.at + interval '90 minutes' end,
       case when pg_temp.zr(d.n, 43 + a.k) < 0.6 then 5400 end,
       case when pg_temp.zr(d.n, 43 + a.k) < 0.6 then round((pg_temp.zr(d.n, 44 + a.k) * 200)::numeric, 0) end,
       case when pg_temp.zr(d.n, 43 + a.k) < 0.6 then 300 end,
       a.at, 'zzdummy-p-' || d.n || '-pyq'
from zd d
cross join lateral (
  select k, least(now() - interval '2 hours', d.signup + (now() - d.signup) * pg_temp.zr(d.n, 40 + k)) as at
  from generate_series(1, 2) k
  where pg_temp.zr(d.n, 41) < 0.10 + 0.35 * d.e and (k = 1 or pg_temp.zr(d.n, 42) < 0.4 * d.e)
) a
join (select p.id, row_number() over (order by p.id) as rn, count(*) over () as total
      from public.pyq_papers p where p.is_published) pp
  on pp.rn = 1 + floor(pg_temp.zr(d.n, 45 + a.k) * pp.total)::int;

-- College Predictor: 1–6 predictions
insert into public.cp_predictions (user_id, rank, marks, category, gender, stream, passout_year, result_count, created_at)
select d.id, 1000 + floor(pg_temp.zr(d.n, 52 + k) * 200000)::int, round((pg_temp.zr(d.n, 53 + k) * 300)::numeric, 1),
       'General', 'Male', 'PCM', '2026', floor(pg_temp.zr(d.n, 54 + k) * 40)::int,
       least(now() - interval '1 minute', d.signup + (now() - d.signup) * pg_temp.zr(d.n, 55 + k))
from zd d
cross join lateral generate_series(1, 1 + floor(power(pg_temp.zr(d.n, 51), 2) * 6)::int) k
where pg_temp.zr(d.n, 50) < 0.12 + 0.3 * d.e;

-- ════════════════════════════════════════════════════════════════════════════════
-- PART 3 · VSAT early registration (+ some simulated fee payments)
--          More likely for MQRs and for people who used more products, so the
--          dashboards have a real pattern to show.
-- ════════════════════════════════════════════════════════════════════════════════
do $$ begin
  if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
    raise exception 'Refusing to run: this is not the staging database (app_flags.environment <> staging).';
  end if;
  if exists (select 1 from public.vsat_registrations v join auth.users u on u.id = v.user_id
             where u.raw_user_meta_data->>'dummy_seed' = 'insights-scale-v1') then
    raise exception 'Part 3 already ran.';
  end if;
end $$;

create or replace function pg_temp.zr(n int, k int) returns float8 language sql immutable
as $$ select (('x' || substr(md5(n::text || ':' || k::text), 1, 8))::bit(32)::bigint)::float8 / 4294967296 $$;

with d as (
  select u.id, (u.raw_user_meta_data->>'dummy_n')::int as n, p.created_at as signup, p.public_id, p.full_name, p.email, p.utm_source,
         coalesce(p.stream in ('PCM', 'PCMB') and p.grad_year in (2026, 2027), false) as mqr,
         (exists (select 1 from public.cs_enrollments x where x.user_id = u.id))::int
       + (exists (select 1 from public.event_registrations x where x.user_id = u.id))::int
       + (exists (select 1 from public.pyq_attempts x where x.user_id = u.id))::int
       + (exists (select 1 from public.cp_predictions x where x.user_id = u.id))::int as n_products
  from auth.users u join public.profiles p on p.id = u.id
  where u.raw_user_meta_data->>'dummy_seed' = 'insights-scale-v1'
)
insert into public.vsat_registrations (user_id, public_id, full_name, email, utm_source, signup_at, registered, registered_at)
select d.id, d.public_id, d.full_name, d.email, d.utm_source, d.signup,
       pg_temp.zr(d.n, 60) < 0.02 + 0.07 * d.mqr::int + 0.05 * d.n_products,
       case when pg_temp.zr(d.n, 60) < 0.02 + 0.07 * d.mqr::int + 0.05 * d.n_products
            then least(now() - interval '1 minute', d.signup + (now() - d.signup) * (0.2 + 0.8 * pg_temp.zr(d.n, 61))) end
from d
where pg_temp.zr(d.n, 60) < 0.05 + 0.07 * d.mqr::int + 0.05 * d.n_products;   -- the extra 3% started but did not finish

select set_config('vedam.allow_simulated_payments', 'on', false);
insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider, amount, currency)
select v.user_id, least(now() - interval '1 minute', v.registered_at + interval '1 day'), 'SIMULATED-ZZDUMMY-' || v.user_id, 'simulated', 0, 'INR'
from public.vsat_registrations v join auth.users u on u.id = v.user_id
where u.raw_user_meta_data->>'dummy_seed' = 'insights-scale-v1' and v.registered
  and pg_temp.zr((u.raw_user_meta_data->>'dummy_n')::int, 62) < 0.25;
select set_config('vedam.allow_simulated_payments', 'off', false);

-- ════════════════════════════════════════════════════════════════════════════════
-- PART 4 · traffic sessions + daily active time + rollups
-- ════════════════════════════════════════════════════════════════════════════════
do $$ begin
  if coalesce((select value from public.app_flags where key = 'environment'), '') <> 'staging' then
    raise exception 'Refusing to run: this is not the staging database (app_flags.environment <> staging).';
  end if;
  if exists (select 1 from public.traffic_events where session_id like 'zzdummy-%') then
    raise exception 'Part 4 already ran.';
  end if;
end $$;

create or replace function pg_temp.zr(n int, k int) returns float8 language sql immutable
as $$ select (('x' || substr(md5(n::text || ':' || k::text), 1, 8))::bit(32)::bigint)::float8 / 4294967296 $$;

drop table if exists pg_temp.zd;
create temp table zd as
select u.id, (u.raw_user_meta_data->>'dummy_n')::int as n, p.created_at as signup,
       coalesce(u.raw_user_meta_data->>'landing_path', '/') as landing,
       pg_temp.zr((u.raw_user_meta_data->>'dummy_n')::int, 20) as e
from auth.users u join public.profiles p on p.id = u.id
where u.raw_user_meta_data->>'dummy_seed' = 'insights-scale-v1';

-- each dummy user's sign-up session: landing page, then /register (15% sign up from another page)
insert into public.traffic_events (session_id, path, kind, created_at)
select 'zzdummy-s-' || d.n, v.path, 'view', d.signup - v.before
from zd d
cross join lateral (values (d.landing, interval '4 minutes'), ('/register', interval '2 minutes')) v(path, before)
where v.path <> '/register' or pg_temp.zr(d.n, 70) >= 0.15;

-- a page view for every product use (its own session)
insert into public.traffic_events (session_id, user_id, path, kind, created_at)
select 'zzdummy-p-' || d.n || '-' || x.product, d.id, x.path, 'view', x.at - interval '1 minute'
from zd d
cross join lateral (
  select 'cs' as product, '/codesprint' as path, (select e.enrolled_at from public.cs_enrollments e where e.user_id = d.id) as at
  union all select 'bc', '/events/zzdummy-bootcamp', (select min(r.created_at) from public.event_registrations r where r.user_id = d.id)
  union all select 'pyq', '/pyq', (select min(a.started_at) from public.pyq_attempts a where a.user_id = d.id)
  union all select 'cp', '/predict', (select min(c.created_at) from public.cp_predictions c where c.user_id = d.id)
  union all select 'vsat', '/apply', (select v.registered_at from public.vsat_registrations v where v.user_id = d.id)
) x
where x.at is not null;

-- visitors who never signed up (≈2.8 per sign-up); about 1 in 5 opens /register and leaves
insert into public.traffic_events (session_id, path, kind, created_at)
select 'zzdummy-a-' || a.k, v.path, 'view', a.at + v.after
from (
  select k, now() - interval '120 days' * power(pg_temp.zr(k, 81), 1.4) as at,
         case when pg_temp.zr(k, 82) < 0.45 then '/' when pg_temp.zr(k, 82) < 0.62 then '/codesprint'
              when pg_temp.zr(k, 82) < 0.74 then '/events' when pg_temp.zr(k, 82) < 0.84 then '/pyq'
              when pg_temp.zr(k, 82) < 0.94 then '/predict' else '/apply' end as first_path
  from generate_series(1, 14000) k
) a
cross join lateral (values (a.first_path, interval '0'), ('/register', interval '1 minute')) v(path, after)
where (v.path <> '/register' or pg_temp.zr(a.k, 83) < 0.2) and a.at + v.after < now();

-- daily active time (last 60 days): 'site' plus one product the person uses; <300 s is not "active"
insert into public.product_active_daily (user_id, product, day, active_seconds, updated_at)
select d.id, pr.product, dy.day, case when pr.product = 'site' then dy.secs else (dy.secs * 0.8)::int end, now()
from zd d
cross join lateral (
  select ((now() at time zone 'Asia/Kolkata')::date - g) as day, 60 + floor(2400 * pg_temp.zr(d.n, 200 + g))::int as secs, g
  from generate_series(0, 59) g
  where ((now() at time zone 'Asia/Kolkata')::date - g) >= (d.signup at time zone 'Asia/Kolkata')::date
    and pg_temp.zr(d.n, 100 + g) < 0.02 + 0.22 * d.e * d.e
) dy
cross join lateral (
  select 'site' as product
  union all
  (select u.product from (
    select 'codesprint' as product where exists (select 1 from public.cs_enrollments x where x.user_id = d.id)
    union all select 'pyq' where exists (select 1 from public.pyq_attempts x where x.user_id = d.id)
    union all select 'cp' where exists (select 1 from public.cp_predictions x where x.user_id = d.id)
    union all select 'vsat' where exists (select 1 from public.vsat_registrations x where x.user_id = d.id)
  ) u
  order by md5(d.n || u.product || dy.g) limit 1)
) pr;

-- rebuild the Vedam One rollup for the dummy users (what the refresh queue does in real life)
do $$ declare r record; begin
  for r in select id from pg_temp.zd loop perform public.vedam_one_recompute_profile(r.id); end loop;
end $$;
delete from public.vedam_one_refresh_queue q using zd d where q.user_id = d.id;
