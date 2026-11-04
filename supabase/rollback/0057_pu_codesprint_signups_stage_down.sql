-- Rollback for 0057: restore pu_codesprint exactly as 0055 left it (enrolled users +
-- rollup-marked users, no signups-only rows, no cs_stage column).

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
