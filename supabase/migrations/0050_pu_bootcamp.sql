-- 0050_pu_bootcamp.sql (renumbered from 0047 to avoid a clash with 0047_vsat_exam_admin_bypass)
-- Product Users → "Bootcamp" tab: one row per student, aggregated across all
-- bootcamps they registered for (bootcamp_participation). Admin-only, same
-- SECURITY DEFINER / is_admin() pattern as the other pu_* RPCs.

create or replace function public.pu_bootcamp()
returns setof jsonb
language plpgsql
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
      order by g.bc_last_registered desc nulls last
    ) x;
end
$function$;

revoke all on function public.pu_bootcamp() from public, anon, authenticated, service_role;
grant execute on function public.pu_bootcamp() to authenticated;
