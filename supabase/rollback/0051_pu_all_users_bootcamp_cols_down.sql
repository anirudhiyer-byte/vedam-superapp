-- 0051_pu_all_users_bootcamp_cols_down.sql (was 0048) — restore pu_all_users to its 0046 form
-- (drops the four bootcamp summary columns).

create or replace function public.pu_all_users()
returns setof jsonb
language plpgsql
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
             to_jsonb(p) as profile
      from public.vedam_one_profiles p
      left join vsat     v        on v.user_id        = p.user_id
      left join cp                on cp.user_id       = p.user_id
      left join pyq               on pyq.user_id      = p.user_id
      left join pyq_last          on pyq_last.user_id = p.user_id
      order by p.full_name asc nulls last
    ) x;
end
$function$;

revoke all on function public.pu_all_users() from public, anon, authenticated, service_role;
grant execute on function public.pu_all_users() to authenticated;
