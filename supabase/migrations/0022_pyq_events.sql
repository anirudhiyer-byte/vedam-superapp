-- PYQ activity tracking: one append-only event log (anonymous + signed-in), a per-session
-- journey view (first click / first exam / first paper), and DB triggers that record attempt
-- milestones into pyq_events AND the cross-product ledger vedam_one (product = 'pyq').
-- Tracking must NEVER break the exam, so every trigger swallows its own errors.

-- 1) Link an attempt to the browser session it was started from (the v1_sid in localStorage).
alter table public.pyq_attempts add column if not exists session_id text;

-- 2) Event log.
create table if not exists public.pyq_events (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  session_id  text,
  user_id     uuid,
  event_type  text not null check (event_type in (
                'screen_view','exam_select','paper_select',
                'attempt_started','attempt_submitted','result_revealed')),
  screen      text,
  exam        text,
  paper_id    uuid,
  attempt_id  uuid,
  question_id uuid,
  meta        jsonb not null default '{}'::jsonb,
  utm_source  text,
  utm_medium  text,
  utm_campaign text
);
create index if not exists pyq_events_session_idx on public.pyq_events (session_id, created_at);
create index if not exists pyq_events_user_idx    on public.pyq_events (user_id, created_at) where user_id is not null;
create index if not exists pyq_events_type_idx    on public.pyq_events (event_type, created_at);
create index if not exists pyq_events_paper_idx   on public.pyq_events (paper_id) where paper_id is not null;

-- Writes only ever happen server-side (service role / SECURITY DEFINER triggers). Admins can read.
alter table public.pyq_events enable row level security;
revoke all on public.pyq_events from anon, authenticated;
grant select on public.pyq_events to authenticated;
drop policy if exists pyq_events_admin_select on public.pyq_events;
create policy pyq_events_admin_select on public.pyq_events for select to authenticated using (public.is_admin());

-- 3) Triggers on attempts / answers.
create or replace function public.trg_pyq_attempt_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p record;
begin
  begin
    select exam, title into p from public.pyq_papers where id = new.paper_id;
    if tg_op = 'INSERT' then
      insert into public.pyq_events(session_id, user_id, event_type, screen, exam, paper_id, attempt_id, created_at)
      values (new.session_id, new.user_id, 'attempt_started', 'test', p.exam, new.paper_id, new.id, coalesce(new.created_at, now()));
      insert into public.vedam_one(user_id, public_id, product, activity_type, object_id, object_name, occurred_at, session_id, dormant_days)
      select new.user_id, (select public_id from public.profiles where id = new.user_id), 'pyq', 'attempt_start',
             new.paper_id, p.title, coalesce(new.created_at, now()), new.session_id, public.vedam_one_dormant_days(new.user_id);
      perform public.vedam_one_refresh_profile(new.user_id);
    elsif tg_op = 'UPDATE' and new.status = 'submitted' and old.status is distinct from 'submitted' then
      insert into public.pyq_events(session_id, user_id, event_type, screen, exam, paper_id, attempt_id, meta)
      values (new.session_id, new.user_id, 'attempt_submitted', 'test', p.exam, new.paper_id, new.id,
              jsonb_build_object('score', new.score, 'max_score', new.max_score, 'correct', new.correct,
                                 'wrong', new.wrong, 'unattempted', new.unattempted, 'duration_secs', new.duration_secs));
      insert into public.vedam_one(user_id, public_id, product, activity_type, object_id, object_name, occurred_at, session_id, dormant_days)
      select new.user_id, (select public_id from public.profiles where id = new.user_id), 'pyq', 'attempt_submit',
             new.paper_id, p.title, now(), new.session_id, public.vedam_one_dormant_days(new.user_id);
      perform public.vedam_one_refresh_profile(new.user_id);
    end if;
  exception when others then
    raise warning 'pyq attempt tracking failed: %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists pyq_attempt_event_ins on public.pyq_attempts;
create trigger pyq_attempt_event_ins after insert on public.pyq_attempts
  for each row execute function public.trg_pyq_attempt_event();
drop trigger if exists pyq_attempt_event_upd on public.pyq_attempts;
create trigger pyq_attempt_event_upd after update of status on public.pyq_attempts
  for each row execute function public.trg_pyq_attempt_event();

create or replace function public.trg_pyq_answer_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  begin
    if new.revealed and (tg_op = 'INSERT' or not coalesce(old.revealed, false)) then
      select at.user_id, at.session_id, at.paper_id, pp.exam into a
      from public.pyq_attempts at join public.pyq_papers pp on pp.id = at.paper_id where at.id = new.attempt_id;
      insert into public.pyq_events(session_id, user_id, event_type, screen, exam, paper_id, attempt_id, question_id, meta)
      values (a.session_id, a.user_id, 'result_revealed', 'test', a.exam, a.paper_id, new.attempt_id, new.question_id,
              jsonb_build_object('is_correct', new.is_correct));
    end if;
  exception when others then
    raise warning 'pyq answer tracking failed: %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists pyq_answer_event_ins on public.pyq_answers;
create trigger pyq_answer_event_ins after insert on public.pyq_answers
  for each row execute function public.trg_pyq_answer_event();
drop trigger if exists pyq_answer_event_upd on public.pyq_answers;
create trigger pyq_answer_event_upd after update of revealed on public.pyq_answers
  for each row execute function public.trg_pyq_answer_event();

-- 4) One row per browser session: where they started, first exam / paper they picked, whether
--    (and as whom) they signed up, and how far they got. Admin-only (inherits pyq_events RLS).
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
  count(*)                                                                      as events
from public.pyq_events e
where e.session_id is not null
group by e.session_id;
revoke all on public.pyq_session_journey from anon, authenticated;
grant select on public.pyq_session_journey to authenticated;
