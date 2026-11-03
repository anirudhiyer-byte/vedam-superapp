-- 0052: Product Users RPCs — release-ready versions of all six tab functions.
--
-- Why:
--  * pu_vsat / pu_codesprint / pu_college_predictor / pu_pyq were created directly on
--    staging and were never in a migration file, so a fresh (production) database
--    would not have them. This file captures them.
--  * The UI now loads rows in pages (the Supabase API returns at most ~1000 rows per
--    call). Paging needs a stable order, so every ORDER BY gets user_id as the final
--    tie-breaker (user_id is unique per row in every one of these functions).
--  * Project rule for browser-callable functions: SECURITY DEFINER, set search_path to '',
--    fully qualified names, revoke from public/anon, grant to authenticated only. The four
--    older functions were also executable by anon/public (data was still safe because
--    each one returns nothing unless public.is_admin()), now aligned with the rule.
--  * pu_vsat reports "paid" ONLY from public.vsat_payments (lead_id = the user's auth id).
--    That table does not exist on every database yet; when it is missing the function
--    returns the same rows without the paid / paid_at keys (the UI then hides those
--    columns) instead of failing.
--
-- Output of every function is unchanged apart from row order among ties.

-- ── VSAT ─────────────────────────────────────────────────────────────────────────
create or replace function public.pu_vsat()
 returns setof jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
begin
  if not public.is_admin() then return; end if;

  if to_regclass('public.vsat_payments') is null then
    return query
      select to_jsonb(x) from (
        select v.user_id,
               coalesce(v.full_name, p.full_name) as full_name,
               coalesce(v.email, p.email)         as email,
               coalesce(v.phone, p.phone)         as phone,
               coalesce(p.public_id, v.public_id) as public_id,
               v.campus_preference, v.year_passing_10th, v.gender,
               v.registered, v.registered_at, v.signup_at,
               v.utm_source, v.utm_campaign,
               to_jsonb(p) as profile
        from public.vsat_registrations v
        left join public.vedam_one_profiles p on p.user_id = v.user_id
        order by v.registered_at desc nulls last, v.user_id
      ) x;
  else
    -- planned only when this branch runs, so a missing table never breaks the function
    return query
      select to_jsonb(x) from (
        select v.user_id,
               coalesce(v.full_name, p.full_name) as full_name,
               coalesce(v.email, p.email)         as email,
               coalesce(v.phone, p.phone)         as phone,
               coalesce(p.public_id, v.public_id) as public_id,
               v.campus_preference, v.year_passing_10th, v.gender,
               v.registered, v.registered_at, v.signup_at,
               v.utm_source, v.utm_campaign,
               (pay.paid_at is not null)          as paid,
               pay.paid_at                        as paid_at,
               to_jsonb(p) as profile
        from public.vsat_registrations v
        left join public.vedam_one_profiles p on p.user_id = v.user_id
        left join lateral (
          select min(coalesce(vp.paid_at, vp.created_at)) as paid_at
          from public.vsat_payments vp
          where vp.lead_id = v.user_id
        ) pay on true
        order by v.registered_at desc nulls last, v.user_id
      ) x;
  end if;
end
$function$;

-- ── CodeSprint ───────────────────────────────────────────────────────────────────
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
    select to_jsonb(x) from (
      select p.user_id, p.full_name, p.email, p.phone, p.public_id,
             p.cs_current_module, p.cs_modules_completed, p.cs_lessons_completed,
             p.cs_completion_rate, p.cs_certs_count, p.cs_avg_quiz_score,
             p.cs_registered_at, p.cs_last_used_at,
             to_jsonb(p) as profile
      from public.vedam_one_profiles p
      where p.cs_registered is true
      order by p.cs_last_used_at desc nulls last, p.user_id
    ) x;
end
$function$;

-- ── College Predictor ────────────────────────────────────────────────────────────
create or replace function public.pu_college_predictor()
 returns setof jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
begin
  if not public.is_admin() then return; end if;
  return query
    with latest as (
      select distinct on (c.user_id) c.user_id, c.rank, c.marks, c.category, c.stream,
             c.passout_year, c.result_count, c.created_at as used_on
      from public.cp_predictions c
      order by c.user_id, c.created_at desc
    )
    select to_jsonb(x) from (
      select l.user_id, p.full_name, p.email, p.phone, p.public_id,
             l.rank, l.marks, l.category, l.stream, l.passout_year, l.result_count, l.used_on,
             to_jsonb(p) as profile
      from latest l
      left join public.vedam_one_profiles p on p.user_id = l.user_id
      order by l.used_on desc nulls last, l.user_id
    ) x;
end
$function$;

-- ── PYQ ──────────────────────────────────────────────────────────────────────────
create or replace function public.pu_pyq()
 returns setof jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
begin
  if not public.is_admin() then return; end if;
  return query
    with agg as (
      select a.user_id,
             count(*) as attempts_started,
             count(*) filter (where a.status = 'submitted') as attempts_submitted,
             count(distinct a.paper_id) as papers_attempted,
             round(avg(a.accuracy) filter (where a.accuracy is not null))::int as avg_accuracy,
             max(a.started_at) as last_used,
             min(a.started_at) as first_used
      from public.pyq_attempts a group by a.user_id
    ),
    lastex as (
      select distinct on (a.user_id) a.user_id, pp.exam as last_exam
      from public.pyq_attempts a join public.pyq_papers pp on pp.id = a.paper_id
      order by a.user_id, a.started_at desc
    )
    select to_jsonb(x) from (
      select g.user_id, p.full_name, p.email, p.phone, p.public_id,
             g.attempts_started, g.attempts_submitted, g.papers_attempted, g.avg_accuracy,
             e.last_exam, g.last_used, g.first_used,
             to_jsonb(p) as profile
      from agg g
      left join lastex e on e.user_id = g.user_id
      left join public.vedam_one_profiles p on p.user_id = g.user_id
      order by g.last_used desc nulls last, g.user_id
    ) x;
end
$function$;

-- ── Bootcamp ─────────────────────────────────────────────────────────────────────
create or replace function public.pu_bootcamp()
 returns setof jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
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
      order by g.bc_last_registered desc nulls last, g.user_id
    ) x;
end
$function$;

-- ── All Users ────────────────────────────────────────────────────────────────────
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
      order by p.full_name asc nulls last, p.user_id
    ) x;
end
$function$;

-- ── Access: authenticated only (each function also returns nothing unless is_admin()) ──
revoke all on function public.pu_vsat()              from public, anon, authenticated, service_role;
revoke all on function public.pu_codesprint()        from public, anon, authenticated, service_role;
revoke all on function public.pu_college_predictor() from public, anon, authenticated, service_role;
revoke all on function public.pu_pyq()               from public, anon, authenticated, service_role;
revoke all on function public.pu_bootcamp()          from public, anon, authenticated, service_role;
revoke all on function public.pu_all_users()         from public, anon, authenticated, service_role;
grant execute on function public.pu_vsat()              to authenticated;
grant execute on function public.pu_codesprint()        to authenticated;
grant execute on function public.pu_college_predictor() to authenticated;
grant execute on function public.pu_pyq()               to authenticated;
grant execute on function public.pu_bootcamp()          to authenticated;
grant execute on function public.pu_all_users()         to authenticated;
