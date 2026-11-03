-- Rollback for 0052: restore the six Product Users functions exactly as they were
-- before 0052 (definitions, search_path, volatility and grants), i.e. the state left
-- by 0045/0046/0049/0050/0051 plus the four functions that were created by hand on
-- staging. On a database where 0052 created the four older functions for the first
-- time (production), this leaves them in their pre-0052 form instead of dropping them;
-- they stay admin-only either way.

CREATE OR REPLACE FUNCTION public.pu_vsat()
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin() THEN RETURN; END IF;
  RETURN QUERY
    SELECT to_jsonb(x) FROM (
      SELECT v.user_id,
             coalesce(v.full_name, p.full_name) AS full_name,
             coalesce(v.email, p.email)         AS email,
             coalesce(v.phone, p.phone)         AS phone,
             coalesce(p.public_id, v.public_id) AS public_id,
             v.campus_preference, v.year_passing_10th, v.gender,
             v.registered, v.registered_at, v.signup_at,
             v.utm_source, v.utm_campaign,
             (pay.paid_at IS NOT NULL)          AS paid,
             pay.paid_at                        AS paid_at,
             to_jsonb(p) AS profile
      FROM vsat_registrations v
      LEFT JOIN vedam_one_profiles p ON p.user_id = v.user_id
      LEFT JOIN LATERAL (
        SELECT min(coalesce(vp.paid_at, vp.created_at)) AS paid_at
        FROM vsat_payments vp
        WHERE vp.lead_id = v.user_id
      ) pay ON true
      ORDER BY v.registered_at DESC NULLS LAST
    ) x;
END $function$;

CREATE OR REPLACE FUNCTION public.pu_codesprint()
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin() THEN RETURN; END IF;
  RETURN QUERY
    SELECT to_jsonb(x) FROM (
      SELECT p.user_id, p.full_name, p.email, p.phone, p.public_id,
             p.cs_current_module, p.cs_modules_completed, p.cs_lessons_completed,
             p.cs_completion_rate, p.cs_certs_count, p.cs_avg_quiz_score,
             p.cs_registered_at, p.cs_last_used_at,
             to_jsonb(p) AS profile
      FROM vedam_one_profiles p
      WHERE p.cs_registered IS TRUE
      ORDER BY p.cs_last_used_at DESC NULLS LAST
    ) x;
END $function$;

CREATE OR REPLACE FUNCTION public.pu_college_predictor()
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin() THEN RETURN; END IF;
  RETURN QUERY
    WITH latest AS (
      SELECT DISTINCT ON (c.user_id) c.user_id, c.rank, c.marks, c.category, c.stream,
             c.passout_year, c.result_count, c.created_at AS used_on
      FROM cp_predictions c
      ORDER BY c.user_id, c.created_at DESC
    )
    SELECT to_jsonb(x) FROM (
      SELECT l.user_id, p.full_name, p.email, p.phone, p.public_id,
             l.rank, l.marks, l.category, l.stream, l.passout_year, l.result_count, l.used_on,
             to_jsonb(p) AS profile
      FROM latest l
      LEFT JOIN vedam_one_profiles p ON p.user_id = l.user_id
      ORDER BY l.used_on DESC NULLS LAST
    ) x;
END $function$;

CREATE OR REPLACE FUNCTION public.pu_pyq()
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin() THEN RETURN; END IF;
  RETURN QUERY
    WITH agg AS (
      SELECT a.user_id,
             count(*) AS attempts_started,
             count(*) FILTER (WHERE a.status='submitted') AS attempts_submitted,
             count(DISTINCT a.paper_id) AS papers_attempted,
             round(avg(a.accuracy) FILTER (WHERE a.accuracy IS NOT NULL))::int AS avg_accuracy,
             max(a.started_at) AS last_used,
             min(a.started_at) AS first_used
      FROM pyq_attempts a GROUP BY a.user_id
    ),
    lastex AS (
      SELECT DISTINCT ON (a.user_id) a.user_id, pp.exam AS last_exam
      FROM pyq_attempts a JOIN pyq_papers pp ON pp.id = a.paper_id
      ORDER BY a.user_id, a.started_at DESC
    )
    SELECT to_jsonb(x) FROM (
      SELECT g.user_id, p.full_name, p.email, p.phone, p.public_id,
             g.attempts_started, g.attempts_submitted, g.papers_attempted, g.avg_accuracy,
             e.last_exam, g.last_used, g.first_used,
             to_jsonb(p) AS profile
      FROM agg g
      LEFT JOIN lastex e ON e.user_id = g.user_id
      LEFT JOIN vedam_one_profiles p ON p.user_id = g.user_id
      ORDER BY g.last_used DESC NULLS LAST
    ) x;
END $function$;

CREATE OR REPLACE FUNCTION public.pu_bootcamp()
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_admin() then return; end if;
  return query
    with agg as (
      select b.user_id,
             count(*)                                          as bc_registered,
             count(*) filter (where b.attended)                as bc_attended,
             round(avg(b.watch_pct) filter (where b.watch_pct is not null))::int as bc_avg_watch,
             sum(b.attended_minutes)                           as bc_total_minutes,
             bool_or(b.is_winner)                              as bc_winner,
             count(*) filter (where b.github_link is not null) as bc_github_count,
             count(*) filter (where b.linkedin_post_link is not null) as bc_linkedin_count,
             sum(b.points_earned)                              as bc_points,
             max(b.registered_at)                              as bc_last_registered,
             min(b.registered_at)                              as bc_first_registered,
             bool_or(b.dropped_off)                            as bc_dropped_off
      from public.bootcamp_participation b
      group by b.user_id
    ),
    last_ev as (
      select distinct on (b.user_id) b.user_id,
             b.event_name as bc_last_event, b.utm_source as bc_utm_source
      from public.bootcamp_participation b
      order by b.user_id, b.registered_at desc nulls last
    )
    select to_jsonb(x) from (
      select g.user_id, p.full_name, p.email, p.phone, p.public_id,
             g.bc_registered, g.bc_attended, g.bc_avg_watch,
             le.bc_last_event, g.bc_winner,
             g.bc_total_minutes, g.bc_points, g.bc_github_count, g.bc_linkedin_count,
             g.bc_last_registered, g.bc_first_registered, g.bc_dropped_off, le.bc_utm_source,
             to_jsonb(p) as profile
      from agg g
      left join last_ev le on le.user_id = g.user_id
      left join public.vedam_one_profiles p on p.user_id = g.user_id
      order by g.bc_last_registered desc nulls last
    ) x;
end
$function$;

CREATE OR REPLACE FUNCTION public.pu_all_users()
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
             p.cs_registered_at, p.cs_last_used_at, p.cs_avg_quiz_score,
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
      order by p.full_name asc nulls last
    ) x;
end
$function$;

-- grants as before 0052: the four older functions were executable by everyone
-- (still admin-gated inside); bootcamp / all users were authenticated-only.
grant execute on function public.pu_vsat()              to public, anon, authenticated, service_role;
grant execute on function public.pu_codesprint()        to public, anon, authenticated, service_role;
grant execute on function public.pu_college_predictor() to public, anon, authenticated, service_role;
grant execute on function public.pu_pyq()               to public, anon, authenticated, service_role;
revoke all on function public.pu_bootcamp()  from public, anon, service_role;
revoke all on function public.pu_all_users() from public, anon, service_role;
grant execute on function public.pu_bootcamp()  to authenticated;
grant execute on function public.pu_all_users() to authenticated;
