-- 0055: Product Users · CodeSprint counts the real enrolments.
--
-- Bug: the CodeSprint tab listed vedam_one_profiles.cs_registered, which the profile
-- rollup sets only after a user COMPLETES a lesson (cs_progress) — not when they enrol.
-- Production: 382 enrolled (cs_enrollments) but the tab showed 141. "Registered On" was
-- also the first-lesson date, not the enrolment date. The All Users tab's
-- "CS Registered On" had the same problem.
--
-- Fix (Product Users RPCs only — the shared profile rollup is untouched, other screens
-- read it): the CodeSprint tab is built from cs_enrollments (plus anyone the rollup marks
-- as a CodeSprint user, so nobody drops out); "Registered On" = enrolment date in both
-- tabs. Grants, search_path and admin gate unchanged (CREATE OR REPLACE keeps grants).

create or replace function public.pu_codesprint()
 returns setof jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
begin
  if not public.is_admin() then return; end if;
  return query
    with enrolled as (
      select e.user_id, min(e.enrolled_at) as enrolled_at
      from public.cs_enrollments e
      group by e.user_id
    ),
    people as (
      -- everyone who enrolled, plus anyone the profile rollup marks as a CodeSprint user
      -- without an enrollment row (none today; kept so nobody can drop out of the tab)
      select coalesce(en.user_id, pr.user_id) as user_id, en.enrolled_at
      from enrolled en
      full join (select v.user_id from public.vedam_one_profiles v where v.cs_registered is true) pr
        on pr.user_id = en.user_id
    )
    select to_jsonb(x) from (
      select u.user_id, p.full_name, p.email, p.phone, p.public_id,
             p.cs_current_module, p.cs_modules_completed, p.cs_lessons_completed,
             p.cs_completion_rate, p.cs_certs_count, p.cs_avg_quiz_score,
             coalesce(u.enrolled_at, p.cs_registered_at) as cs_registered_at,   -- "Registered On" = enrolment date
             p.cs_last_used_at,
             to_jsonb(p) as profile
      from people u
      left join public.vedam_one_profiles p on p.user_id = u.user_id
      order by coalesce(p.cs_last_used_at, u.enrolled_at) desc nulls last, u.user_id
    ) x;
end
$function$;

create or replace function public.pu_all_users()
 returns setof jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
begin
  if not public.is_admin() then return; end if;
  return query
    with vsat as (
      select distinct on (v.user_id) v.user_id,
             v.campus_preference, v.year_passing_10th, v.gender,
             v.registered, v.registered_at, v.utm_source
      from public.vsat_registrations v
      order by v.user_id, v.registered_at desc nulls last
    ),
    cp as (
      select distinct on (c.user_id) c.user_id,
             c.rank, c.marks, c.category, c.stream, c.passout_year,
             c.result_count, c.created_at as used_on
      from public.cp_predictions c
      order by c.user_id, c.created_at desc
    ),
    pyq as (
      select a.user_id,
             count(*)                                             as attempts_started,
             count(*) filter (where a.status = 'submitted')        as attempts_submitted,
             count(distinct a.paper_id)                            as papers_attempted,
             round(avg(a.accuracy) filter (where a.accuracy is not null))::int as avg_accuracy,
             max(a.started_at)                                     as last_used,
             min(a.started_at)                                     as first_used
      from public.pyq_attempts a
      group by a.user_id
    ),
    pyq_last as (
      select distinct on (a.user_id) a.user_id, pp.exam as last_exam
      from public.pyq_attempts a
      join public.pyq_papers pp on pp.id = a.paper_id
      order by a.user_id, a.started_at desc
    ),
    cs_enr as (
      select e.user_id, min(e.enrolled_at) as enrolled_at
      from public.cs_enrollments e
      group by e.user_id
    ),
    bc as (
      select b.user_id,
             count(*)                           as bc_registered,
             count(*) filter (where b.attended) as bc_attended,
             round(avg(b.watch_pct) filter (where b.watch_pct is not null))::int as bc_avg_watch,
             bool_or(b.is_winner)               as bc_winner
      from public.bootcamp_participation b
      group by b.user_id
    )
    select to_jsonb(x) from (
      select p.user_id, p.full_name, p.email, p.phone, p.public_id,
             v.registered          as vsat_registered,
             v.campus_preference   as vsat_campus_preference,
             v.year_passing_10th   as vsat_year_passing_10th,
             v.gender              as vsat_gender,
             v.registered_at       as vsat_registered_at,
             v.utm_source          as vsat_utm_source,
             p.cs_current_module, p.cs_certs_count, p.cs_modules_completed,
             coalesce(cs_enr.enrolled_at, p.cs_registered_at) as cs_registered_at,   -- CS Registered On = enrolment date
             p.cs_last_used_at, p.cs_avg_quiz_score,
             cp.rank          as cp_rank,
             cp.marks         as cp_marks,
             cp.category      as cp_category,
             cp.stream        as cp_stream,
             cp.result_count  as cp_result_count,
             cp.passout_year  as cp_passout_year,
             cp.used_on       as cp_used_on,
             pyq.papers_attempted   as pyq_papers_attempted,
             pyq.attempts_started   as pyq_attempts_started,
             pyq.attempts_submitted as pyq_attempts_submitted,
             pyq.avg_accuracy       as pyq_avg_accuracy,
             pyq_last.last_exam     as pyq_last_exam,
             pyq.last_used          as pyq_last_used,
             pyq.first_used         as pyq_first_used,
             bc.bc_registered, bc.bc_attended, bc.bc_avg_watch, bc.bc_winner,
             to_jsonb(p) as profile
      from public.vedam_one_profiles p
      left join vsat     v        on v.user_id        = p.user_id
      left join cp                on cp.user_id       = p.user_id
      left join pyq               on pyq.user_id      = p.user_id
      left join pyq_last          on pyq_last.user_id = p.user_id
      left join bc                on bc.user_id       = p.user_id
      left join cs_enr            on cs_enr.user_id   = p.user_id
      order by p.full_name asc nulls last, p.user_id
    ) x;
end
$function$;
