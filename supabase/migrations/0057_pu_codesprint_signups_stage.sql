-- 0057: Product Users · CodeSprint shows everyone connected to CodeSprint, with a Stage.
--
-- 0055 made the tab list enrolments (382 on production) instead of lesson-completers
-- (141). People who signed up through a CodeSprint link / page but never pressed Enroll
-- (135 on production) were still missing — together 517, the number the team expects.
--
-- Who is in the tab (one row per user):
--   * enrolled            — a row in cs_enrollments
--   * marked by rollup    — vedam_one_profiles.cs_registered (kept so nobody drops out)
--   * came via CodeSprint — signup metadata (auth.users.raw_user_meta_data) has a
--                           landing_path containing "codesprint" or a utm_source /
--                           utm_campaign containing "sprint"
-- New column cs_stage:
--   'Started'                 — completed at least one lesson (cs_progress)
--   'Enrolled, not started'   — enrolled, no lesson completed
--   'Signed up, not enrolled' — came via CodeSprint, never enrolled
-- cs_registered_at ("Registered On") = enrolment date, else signup date.
-- Admin gate, search_path and grants unchanged (CREATE OR REPLACE keeps grants).

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
    via_link as (
      select u.id as user_id, u.created_at as signed_up_at
      from auth.users u
      where coalesce(u.raw_user_meta_data->>'landing_path', '') ilike '%codesprint%'
         or coalesce(u.raw_user_meta_data->>'utm_source', '')   ilike '%sprint%'
         or coalesce(u.raw_user_meta_data->>'utm_campaign', '') ilike '%sprint%'
    ),
    people as (
      select en.user_id from enrolled en
      union
      select v.user_id from public.vedam_one_profiles v where v.cs_registered is true
      union
      select vl.user_id from via_link vl
    ),
    started as (
      select distinct c.user_id from public.cs_progress c
    )
    select to_jsonb(x) from (
      select pe.user_id, p.full_name, p.email, p.phone, p.public_id,
             case
               when st.user_id is not null then 'Started'
               when en.user_id is not null then 'Enrolled, not started'
               else 'Signed up, not enrolled'
             end as cs_stage,
             p.cs_current_module, p.cs_modules_completed, p.cs_lessons_completed,
             p.cs_completion_rate, p.cs_certs_count, p.cs_avg_quiz_score,
             coalesce(en.enrolled_at, p.cs_registered_at, vl.signed_up_at, au.created_at) as cs_registered_at,
             p.cs_last_used_at,
             to_jsonb(p) as profile
      from people pe
      left join enrolled en                  on en.user_id = pe.user_id
      left join started st                   on st.user_id = pe.user_id
      left join via_link vl                  on vl.user_id = pe.user_id
      left join auth.users au                on au.id      = pe.user_id
      left join public.vedam_one_profiles p  on p.user_id  = pe.user_id
      order by coalesce(p.cs_last_used_at, en.enrolled_at, vl.signed_up_at, au.created_at) desc nulls last, pe.user_id
    ) x;
end
$function$;
