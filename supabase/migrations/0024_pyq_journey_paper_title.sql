-- pyq_session_journey: also show the NAME of the first paper clicked (and its exam), not just its id.
-- Same columns as 0023, plus two appended at the end.
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
  (select count(*) from public.pyq_session_users m where m.session_id = e.session_id)                              as distinct_users,
  (select p.title from public.pyq_papers p
     where p.id = (array_agg(e.paper_id order by e.created_at, e.id) filter (where e.event_type = 'paper_select'))[1]) as first_paper_title,
  (select p.exam  from public.pyq_papers p
     where p.id = (array_agg(e.paper_id order by e.created_at, e.id) filter (where e.event_type = 'paper_select'))[1]) as first_paper_exam
from public.pyq_events e
where e.session_id is not null
group by e.session_id;

revoke all on public.pyq_session_journey from anon, authenticated;
grant select on public.pyq_session_journey to authenticated;
