-- Rollback 0142 · restore all 11 dashboard functions to their pre-0142 definitions
-- (removes the internal-email exclusion; Growth returns to its @vedam.org-only filter).
-- Original md5s: ins__facts 91e46251963463c6d67126c5f0f935ce · ins__product_users eb70609e98ce763cffb7ccab5894a53d
-- · pu_vsat 00d063d377c5cd9dcc35f317f561c8d8 · pu_all_users e795030c61b10632306fc1576f1757d8
-- · dash_vsat 4e6ecd30e5b01bd5d1207d36a9de7f82 · dash_vsat_sources 2bd6aeb8c809e649e810bf8ec3d7d3a2
-- · growth__leads 234f44050272a3fe661e25630e52767b · growth__lead_rows 37255cd514cc4ec9f58b41823831e3d7
-- · growth__season_ids 073cfad19229890fbceb2f251844314d · growth__cons_attr fd53c675e31a32babc00f5d4dc7a4b62
-- · growth__cons_people 1a4c1dd0787192c71513745dd8bf7288

CREATE OR REPLACE FUNCTION public.ins__facts()
 RETURNS TABLE(user_id uuid, signup_at timestamp with time zone, is_full boolean, is_mqr boolean, src text, state text, cs_at timestamp with time zone, cs_enrolled boolean, cs_started boolean, cs_lessons integer, cs_certs integer, bc_at timestamp with time zone, bc_regs integer, bc_attended integer, bc_stayed integer, bc_projects integer, pyq_at timestamp with time zone, pyq_attempts integer, pyq_submitted integer, cp_at timestamp with time zone, cp_uses integer, vsat_at timestamp with time zone, n_products integer, n_deep integer, last_activity_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with cs_en as (
    select e.user_id, min(e.enrolled_at) as enrolled_at from public.cs_enrollments e group by e.user_id
  ),
  cs_link as (
    select u.id as user_id, u.created_at from auth.users u
    where coalesce(u.raw_user_meta_data->>'landing_path', '') ilike '%codesprint%'
       or coalesce(u.raw_user_meta_data->>'utm_source', '')   ilike '%sprint%'
       or coalesce(u.raw_user_meta_data->>'utm_campaign', '') ilike '%sprint%'
  ),
  cs_st as (select distinct c.user_id from public.cs_progress c),
  bc as (
    select b.user_id, min(b.registered_at) as first_at, max(b.registered_at) as last_at,
           count(*)::int as regs,
           (count(*) filter (where b.attended))::int as attended,
           (count(*) filter (where b.stayed_full))::int as stayed,
           (count(*) filter (where coalesce(b.github_link, '') <> ''))::int as projects
    from public.bootcamp_participation b group by b.user_id
  ),
  pyq as (
    select a.user_id, min(coalesce(a.started_at, a.created_at)) as first_at,
           max(coalesce(a.started_at, a.created_at)) as last_at,
           count(*)::int as n, (count(*) filter (where a.status = 'submitted'))::int as submitted
    from public.pyq_attempts a group by a.user_id
  ),
  cp as (
    select c.user_id, min(c.created_at) as first_at, max(c.created_at) as last_at, count(*)::int as n
    from public.cp_predictions c where c.user_id is not null group by c.user_id
  ),
  vs as (
    select v.user_id, min(coalesce(v.registered_at, v.signup_at)) as at
    from public.vsat_registrations v where v.registered is true group by v.user_id
  ),
  base as (
    select p.id as user_id, p.created_at as signup_at,
           coalesce(p.profile_completed, false) as is_full,
           coalesce(p.stream in ('PCM', 'PCMB') and p.grad_year in (2026, 2027), false) as is_mqr,
           public.ins__src(p.utm_source) as src,
           nullif(btrim(p.state), '') as state,
           case when en.user_id is not null or vp.cs_registered is true or cl.user_id is not null
                then coalesce(en.enrolled_at, vp.cs_registered_at, cl.created_at, p.created_at) end as cs_at,
           (en.user_id is not null) as cs_enrolled,
           (cst.user_id is not null) as cs_started,
           coalesce(vp.cs_lessons_completed, 0) as cs_lessons,
           coalesce(vp.cs_certs_count, 0) as cs_certs,
           vp.cs_last_used_at,
           bc.first_at as bc_at, coalesce(bc.regs, 0) as bc_regs, coalesce(bc.attended, 0) as bc_attended,
           coalesce(bc.stayed, 0) as bc_stayed, coalesce(bc.projects, 0) as bc_projects, bc.last_at as bc_last,
           pyq.first_at as pyq_at, coalesce(pyq.n, 0) as pyq_attempts, coalesce(pyq.submitted, 0) as pyq_submitted,
           pyq.last_at as pyq_last,
           cp.first_at as cp_at, coalesce(cp.n, 0) as cp_uses, cp.last_at as cp_last,
           vs.at as vsat_at
    from public.profiles p
    left join cs_en en on en.user_id = p.id
    left join public.vedam_one_profiles vp on vp.user_id = p.id
    left join cs_link cl on cl.user_id = p.id
    left join cs_st cst on cst.user_id = p.id
    left join bc on bc.user_id = p.id
    left join pyq on pyq.user_id = p.id
    left join cp on cp.user_id = p.id
    left join vs on vs.user_id = p.id
  )
  select b.user_id, b.signup_at, b.is_full, b.is_mqr, b.src, b.state,
         b.cs_at, b.cs_enrolled, b.cs_started, b.cs_lessons, b.cs_certs,
         b.bc_at, b.bc_regs, b.bc_attended, b.bc_stayed, b.bc_projects,
         b.pyq_at, b.pyq_attempts, b.pyq_submitted,
         b.cp_at, b.cp_uses,
         b.vsat_at,
         ((b.cs_at is not null)::int + (b.bc_at is not null)::int + (b.pyq_at is not null)::int + (b.cp_at is not null)::int) as n_products,
         -- "deep use": CodeSprint lesson done · Bootcamp attended live · PYQ paper submitted · 2+ predictions
         ((b.cs_started)::int + (b.bc_attended > 0)::int + (b.pyq_submitted > 0)::int + (b.cp_uses >= 2)::int) as n_deep,
         greatest(b.signup_at, b.cs_last_used_at, b.cs_at, b.bc_last, b.pyq_last, b.cp_last, b.vsat_at) as last_activity_at
  from base b
$function$;

CREATE OR REPLACE FUNCTION public.ins__product_users(p_product text, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(user_id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select f.user_id from public.ins__facts() f
  where p_product = 'codesprint' and f.cs_at >= coalesce(p_from, '-infinity') and f.cs_at < coalesce(p_to, 'infinity')
  union
  select b.user_id from public.bootcamp_participation b
  where p_product = 'bootcamp' and b.user_id is not null
    and b.registered_at >= coalesce(p_from, '-infinity') and b.registered_at < coalesce(p_to, 'infinity')
  union
  select a.user_id from public.pyq_attempts a
  where p_product = 'pyq' and a.user_id is not null
    and coalesce(a.started_at, a.created_at) >= coalesce(p_from, '-infinity')
    and coalesce(a.started_at, a.created_at) <  coalesce(p_to, 'infinity')
  union
  select c.user_id from public.cp_predictions c
  where p_product = 'cp' and c.user_id is not null
    and c.created_at >= coalesce(p_from, '-infinity') and c.created_at < coalesce(p_to, 'infinity')
  union
  select v.user_id from public.vsat_registrations v
  where p_product = 'vsat' and v.registered is true and v.user_id is not null
    and coalesce(v.registered_at, v.signup_at) >= coalesce(p_from, '-infinity')
    and coalesce(v.registered_at, v.signup_at) <  coalesce(p_to, 'infinity')
$function$;

CREATE OR REPLACE FUNCTION public.pu_vsat()
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
               exists (select 1 from public.application_manager am where am.lead_id = v.user_id) as applied,
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
               exists (select 1 from public.application_manager am where am.lead_id = v.user_id) as applied,
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

CREATE OR REPLACE FUNCTION public.pu_all_users()
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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

CREATE OR REPLACE FUNCTION public.dash_vsat(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(landings bigint, leads bigint, new_acc bigint, existing_acc bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_admin() then return query select 0::bigint,0::bigint,0::bigint,0::bigint; return; end if;
  return query
  with lnd as (
    select distinct session_id from public.traffic_events
    where kind='view' and path='/vsat' and session_id is not null
      and created_at >= p_from and created_at < p_to
  ),
  leads as (
    select vr.user_id, p.signup_session_id
    from public.vsat_registrations vr
    join public.profiles p on p.id = vr.user_id
    where vr.registered = true
      and coalesce(vr.registered_at, vr.signup_at) >= p_from
      and coalesce(vr.registered_at, vr.signup_at) <  p_to
  ),
  newu as (
    select distinct l.user_id from leads l
    where l.signup_session_id is not null
      and exists (select 1 from public.traffic_events te
                  where te.session_id = l.signup_session_id and te.path ilike '/vsat%')
  )
  select
    (select count(*) from lnd),
    (select count(distinct user_id) from leads),
    (select count(*) from newu),
    greatest((select count(distinct user_id) from leads) - (select count(*) from newu), 0);
end $function$;

CREATE OR REPLACE FUNCTION public.dash_vsat_sources(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(source text, n bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_admin() then return; end if;
  return query
  select coalesce(nullif(btrim(utm_source),''), 'Direct/Unknown') as source, count(distinct user_id) as n
  from public.vsat_registrations
  where registered = true
    and coalesce(registered_at, signup_at) >= p_from
    and coalesce(registered_at, signup_at) <  p_to
  group by 1 order by n desc;
end $function$;

CREATE OR REPLACE FUNCTION public.growth__leads(p_keys text[])
 RETURNS TABLE(lead_id uuid, k text, created_d date, paid_d date, enrolled_d date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select lm.lead_id, q.k,
         (coalesce(lm.user_registration_date, lm.created_at) at time zone 'Asia/Kolkata')::date,   -- 0122: registration day (creation day when empty)
         (select (min(vp.paid_at) at time zone 'Asia/Kolkata')::date from public.vsat_payments vp where vp.lead_id = lm.lead_id),
         (select (min(coalesce(am.enrollment_paid_at, am.last_updated_date)) at time zone 'Asia/Kolkata')::date
            from public.application_manager am where am.lead_id = lm.lead_id and am.enrollment_stage = 'approved')
    from (select distinct u.k from unnest(p_keys) u(k) where u.k is not null) q
   cross join lateral (select l.* from public.lead_manager l where public.vsat__norm_utm(l.primary_utm) = q.k) lm   -- index lookup per key
   where (lm.registered_email is null or lm.registered_email not ilike '%@vedam.org');   -- 0122: staff are not leads
$function$;

CREATE OR REPLACE FUNCTION public.growth__lead_rows(p_from date, p_to date)
 RETURNS TABLE(lead_id uuid, lead_on date, email text, campus text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select lm.lead_id,
         (lm.user_registration_date at time zone 'Asia/Kolkata')::date,
         lm.registered_email,
         public.growth__campus(lm.campus_preference)
    from public.lead_manager lm
   where lm.user_registration_date >= (p_from::timestamp at time zone 'Asia/Kolkata')
     and lm.user_registration_date < ((p_to + 1)::timestamp at time zone 'Asia/Kolkata');
$function$;

CREATE OR REPLACE FUNCTION public.growth__season_ids(p_kind text, p_from date, p_to date, p_exam date)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_kind = 'leads' then
    -- 0121: the lead's registration day (its row's creation day when that is empty); staff (@vedam.org) are not leads
    return query select lm.lead_id from public.lead_manager lm
      where (coalesce(lm.user_registration_date, lm.created_at) at time zone 'Asia/Kolkata')::date between p_from and p_to
        and (lm.registered_email is null or lm.registered_email not ilike '%@vedam.org');
  elsif p_kind = 'paid' then
    return query select vp.lead_id
      from (select x.lead_id, (min(x.paid_at) at time zone 'Asia/Kolkata')::date d from public.vsat_payments x group by x.lead_id) vp
      where exists (select 1 from public.lead_manager lm where lm.lead_id = vp.lead_id)   -- 0109: only leads the list can show
        and case when p_exam is null then vp.d between p_from and p_to
                 else exists (select 1 from public.application_manager am join public.vsat_exam_dates ed on ed.id = am.exam_date_id
                               where am.lead_id = vp.lead_id and ed.exam_date = p_exam) end;
  elsif p_kind = 'enrolled' then
    return query select e.lead_id
      from (select am.lead_id,
                   (min(coalesce(am.enrollment_paid_at, am.last_updated_date)) at time zone 'Asia/Kolkata')::date d,
                   coalesce(bool_or(ed.exam_date = p_exam), false) on_exam
              from public.application_manager am left join public.vsat_exam_dates ed on ed.id = am.exam_date_id
             where am.enrollment_stage = 'approved' and am.lead_id is not null
             group by am.lead_id) e
      where case when p_exam is null then e.d between p_from and p_to else e.on_exam end;
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.growth__cons_attr(p_trash boolean)
 RETURNS TABLE(id uuid, utm_key text, leads integer, apps_utm integer, enr_utm integer, apps_coupon integer, enr_coupon integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with r as materialized (
    select c.id, public.growth__utm_key(c.utm_link) k, nullif(lower(btrim(c.coupon_code)), '') cp, c.created_at
      from public.growth_cons_rows c where (c.deleted_at is not null) = p_trash
  ), live_keys as materialized (   -- a lead from one of these UTMs is counted by UTM, never again by coupon
    select distinct public.growth__utm_key(c.utm_link) k from public.growth_cons_rows c
     where c.deleted_at is null and public.growth__utm_key(c.utm_link) is not null
  ), l as materialized (
    select * from public.growth__leads(array(select distinct r.k from r where r.k is not null))
  ), u as (
    select l.k, count(*)::int n, count(l.paid_d)::int pd, count(l.enrolled_d)::int en from l group by l.k
  ), own as (                      -- one row per coupon: the oldest
    select distinct on (r.cp) r.cp, r.id from r where r.cp is not null order by r.cp, r.created_at, r.id
  ), cl as materialized (          -- paid VSAT-fee leads by coupon, each lead once (its first paid order)
    select distinct on (o.lead_id) o.lead_id, lower(btrim(o.discount_coupon)) cp
      from public.vsat_payment_orders o
      join public.vsat_payments vp on vp.lead_id = o.lead_id
      join public.lead_manager lm on lm.lead_id = o.lead_id
     where o.status = 'paid' and o.kind = 'vsat_fee'
       and lower(btrim(o.discount_coupon)) in (select own.cp from own)
       and (lm.registered_email is null or lm.registered_email not ilike '%@vedam.org')
       and not exists (select 1 from live_keys lk where lk.k = public.vsat__norm_utm(lm.primary_utm))
     order by o.lead_id, o.created_at, o.cf_order_id
  ), c as (
    select own.id, count(*)::int n,
           count(*) filter (where exists (select 1 from public.application_manager am
                                           where am.lead_id = cl.lead_id and am.enrollment_stage = 'approved'))::int en
      from cl join own on own.cp = cl.cp group by own.id
  )
  select r.id, r.k, coalesce(u.n, 0), coalesce(u.pd, 0), coalesce(u.en, 0), coalesce(c.n, 0), coalesce(c.en, 0)
    from r left join u on u.k = r.k left join c on c.id = r.id;
$function$;

CREATE OR REPLACE FUNCTION public.growth__cons_people(p_campus text)
 RETURNS TABLE(row_id uuid, lead_id uuid, via text, created_d date, paid_d date, enrolled_d date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with r as materialized (
    select c.id, public.growth__utm_key(c.utm_link) k, nullif(lower(btrim(c.coupon_code)), '') cp, c.created_at
      from public.growth_cons_rows c where c.deleted_at is null
  ), l as materialized (
    select * from public.growth__leads(array(select distinct r.k from r where r.k is not null))
  ), lu as (
    select distinct on (l.lead_id) r.id, l.lead_id, l.created_d, l.paid_d, l.enrolled_d
      from l join r on r.k = l.k order by l.lead_id, r.created_at, r.id
  ), live_keys as materialized (
    select distinct r.k from r where r.k is not null
  ), own as (
    select distinct on (r.cp) r.cp, r.id from r where r.cp is not null order by r.cp, r.created_at, r.id
  ), cl as materialized (
    select distinct on (o.lead_id) o.lead_id, lower(btrim(o.discount_coupon)) cp
      from public.vsat_payment_orders o
      join public.vsat_payments vp on vp.lead_id = o.lead_id
      join public.lead_manager lm on lm.lead_id = o.lead_id
     where o.status = 'paid' and o.kind = 'vsat_fee'
       and lower(btrim(o.discount_coupon)) in (select own.cp from own)
       and (lm.registered_email is null or lm.registered_email not ilike '%@vedam.org')
       and not exists (select 1 from live_keys lk where lk.k = public.vsat__norm_utm(lm.primary_utm))
     order by o.lead_id, o.created_at, o.cf_order_id
  ), a as (
    select lu.id row_id, lu.lead_id, 'utm'::text via, lu.created_d, lu.paid_d, lu.enrolled_d from lu
    union all
    select own.id, cl.lead_id, 'coupon'::text,
           (coalesce(lm.user_registration_date, lm.created_at) at time zone 'Asia/Kolkata')::date,
           (select (min(vp.paid_at) at time zone 'Asia/Kolkata')::date from public.vsat_payments vp where vp.lead_id = cl.lead_id),
           (select (min(coalesce(am.enrollment_paid_at, am.last_updated_date)) at time zone 'Asia/Kolkata')::date
              from public.application_manager am where am.lead_id = cl.lead_id and am.enrollment_stage = 'approved')
      from cl join own on own.cp = cl.cp join public.lead_manager lm on lm.lead_id = cl.lead_id
  )
  select a.row_id, a.lead_id, a.via, a.created_d, a.paid_d, a.enrolled_d
    from a
   where p_campus is null
      or exists (select 1 from public.lead_manager m where m.lead_id = a.lead_id and public.growth__campus(m.campus_preference) = p_campus);
$function$;
