-- Links every browser id (session_id) to every student seen on it, read from all places we store both.
-- No backfill: it is computed at read time, so older profiles and shared browsers are covered too.
-- Admin-only (security_invoker: inherits the admin-only RLS of the tables underneath).

create or replace view public.pyq_session_users with (security_invoker = true) as
select session_id, user_id from public.pyq_events    where session_id is not null and user_id is not null
union
select session_id, user_id from public.pyq_attempts  where session_id is not null and user_id is not null
union
select session_id, user_id from public.traffic_events where session_id is not null and user_id is not null
union
select signup_session_id as session_id, id as user_id from public.profiles where signup_session_id is not null;

-- Every PYQ event from every browser a student has ever been seen on (including the logged-out
-- ones from before they signed up). Shared browsers: their logged-out events show under each student.
create or replace view public.pyq_student_events with (security_invoker = true) as
select m.user_id as student_id, (e.user_id is null) as was_logged_out, e.*
from public.pyq_events e
join public.pyq_session_users m on m.session_id = e.session_id;

-- Journey view: same columns as before, plus every student seen on the browser (shared browsers).
create or replace view public.pyq_session_journey with (security_invoker = true) as
select
  e.session_id,
  min(e.created_at)                                                             as first_seen_at,
  max(e.created_at)                                                             as last_seen_at,
  (array_agg(e.event_type order by e.created_at, e.id))[1]                      as first_event,
  (array_agg(e.utm_source   order by e.created_at, e.id))[1]                    as first_utm_source,
  (array_agg(e.utm_campaign order by e.created_at, e.id))[1]                    as first_utm_campaign,
  (array_agg(e.exam     order by e.created_at, e.id) filter (where e.event_type = 'exam_select'))[1]  as first_exam_clicked,
  (array_agg(e.paper_id order by e.created_at, e.id) filter (where e.event_type = 'paper_select'))[1] as first_paper_clicked,
  (array_agg(e.user_id  order by e.created_at, e.id) filter (where e.user_id is not null))[1]         as user_id,
  bool_or(e.event_type = 'screen_view' and e.screen = 'register')               as reached_register,
  min(e.created_at) filter (where e.user_id is not null)                        as first_signed_in_at,
  count(*) filter (where e.event_type = 'attempt_started')                      as attempts_started,
  count(*) filter (where e.event_type = 'attempt_submitted')                    as attempts_submitted,
  count(*)                                                                      as events,
  (select coalesce(array_agg(m.user_id), '{}') from public.pyq_session_users m where m.session_id = e.session_id) as user_ids,
  (select count(*) from public.pyq_session_users m where m.session_id = e.session_id)                              as distinct_users
from public.pyq_events e
where e.session_id is not null
group by e.session_id;

revoke all on public.pyq_session_users, public.pyq_student_events, public.pyq_session_journey from anon, authenticated;
grant select on public.pyq_session_users, public.pyq_student_events, public.pyq_session_journey to authenticated;
