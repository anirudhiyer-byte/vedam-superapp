-- 0062 · Insights dashboards — READ-ONLY data for the new admin page /admin/insights:
--        Vedam One overview funnel, product comparison, sources, states,
--        cross-product use and the link to VSAT early registration.
--
-- What this adds: new ins_* functions only. Nothing existing is changed:
--   no table, column, index, policy, trigger, grant or existing function is touched.
--   The existing Dashboards RPCs (dash_*) are not called or altered.
--
-- Tables read (never written): profiles, auth.users (signup metadata), traffic_events,
--   cs_enrollments, cs_progress, vedam_one_profiles, bootcamp_participation, events,
--   pyq_attempts, cp_predictions, vsat_registrations, product_active_daily,
--   growth_cs_cost_rows, growth_cp_cost_rows, growth_events_rows, growth_events_manual,
--   and vsat_payments when that table exists (it is not on production yet).
--
-- Definitions (kept identical to the existing dashboards so numbers reconcile):
--   * Registered (partial / full) = profiles created in the period; full = profile_completed
--   * MQR = registered with stream PCM/PCMB and passing year 2026/2027 (same as dash_registration_funnel)
--   * Visitors / Attempted = distinct traffic sessions with a page view / a view of /register
--   * Product users in a period = distinct users with that product's event in the period:
--       CodeSprint = enrolment date, else rollup date, else signup date for people who came via a
--                    CodeSprint link (same population and date as Product Users · CodeSprint, 0057)
--       Bootcamp   = a bootcamp registration (bootcamp_participation)
--       PYQ        = a paper started (pyq_attempts)
--       College Predictor = a prediction run (cp_predictions)
--       VSAT early = vsat_registrations.registered (registered_at)
--   * Source = first-touch profiles.utm_source, trimmed and case-insensitive ("Whatsapp" = "whatsapp")
--   * Active = 5+ minutes on a product in a day (product_active_daily); Bootcamp active = 5+ minutes
--     in the live Zoom session of a bootcamp held that day.
--
-- Security (every public ins_* function):
--   * SECURITY DEFINER, set search_path to '' (all names schema-qualified)
--   * first statement: admin check -> SQLSTATE 42501 for anyone else
--   * period = half-open [p_from, p_to); both null = all time; otherwise both required, to > from
--   * revoke execute from public, anon; grant execute to authenticated only
-- Helpers ins__* are private: execute revoked from public, anon and authenticated.
--
-- Rollback: supabase/rollback/0062_insights_dashboards_down.sql (drops exactly these functions).
-- Tests:    supabase/tests/insights_dashboards.test.sql (staging only, rolls itself back).

-- ── private helpers ─────────────────────────────────────────────────────────────

-- admin + period check, shared by every ins_* function
create or replace function public.ins__guard(p_from timestamptz, p_to timestamptz)
returns void
language plpgsql stable
set search_path to ''
as $$
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if (p_from is null) <> (p_to is null) then
    raise exception 'range_incomplete' using errcode = '22023';
  end if;
  if p_from is not null and p_to <= p_from then
    raise exception 'range_invalid' using errcode = '22023';
  end if;
end $$;

-- first-touch source -> one key per source, case- and space-insensitive; blank -> 'unknown'
create or replace function public.ins__src(p text)
returns text
language sql immutable
set search_path to ''
as $$
  select case
    when p is null or btrim(p) = '' then 'unknown'
    else regexp_replace(lower(btrim(p)), '[[:space:]-]+', '_', 'g')
  end
$$;

-- one row per signed-up user with everything the dashboards need
create or replace function public.ins__facts()
returns table(
  user_id uuid, signup_at timestamptz, is_full boolean, is_mqr boolean, src text, state text,
  cs_at timestamptz, cs_enrolled boolean, cs_started boolean, cs_lessons int, cs_certs int,
  bc_at timestamptz, bc_regs int, bc_attended int, bc_stayed int, bc_projects int,
  pyq_at timestamptz, pyq_attempts int, pyq_submitted int,
  cp_at timestamptz, cp_uses int,
  vsat_at timestamptz,
  n_products int, n_deep int, last_activity_at timestamptz)
language sql stable
set search_path to ''
as $$
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
$$;

-- distinct users with a product event in [from, to); null bounds = all time
create or replace function public.ins__product_users(p_product text, p_from timestamptz, p_to timestamptz)
returns table(user_id uuid)
language sql stable
set search_path to ''
as $$
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
$$;

-- distinct visitor sessions that viewed a product's pages in [from, to); 'all' = any page
create or replace function public.ins__visitors(p_product text, p_from timestamptz, p_to timestamptz)
returns bigint
language sql stable
set search_path to ''
as $$
  select count(distinct t.session_id)
  from public.traffic_events t
  where t.kind = 'view' and t.session_id is not null
    and t.created_at >= coalesce(p_from, '-infinity') and t.created_at < coalesce(p_to, 'infinity')
    and case p_product
          when 'all'        then true
          when 'codesprint' then t.path like '/codesprint%'
          when 'bootcamp'   then t.path like '/events%' or t.path like '/e/%'
          when 'pyq'        then t.path like '/pyq%'
          when 'cp'         then t.path like '/predict%' or t.path like '/college-predictor%'
          when 'vsat'       then t.path like '/apply%' or t.path like '/vsat%'
          else false
        end
$$;

-- all-time spend logged in the Growth sheets, per product
create or replace function public.ins__spend(p_product text)
returns numeric
language sql stable
set search_path to ''
as $$
  select case p_product
    when 'codesprint' then (select coalesce(sum(r.total_cost), 0) from public.growth_cs_cost_rows r where not coalesce(r.is_trashed, false))
    when 'cp'         then (select coalesce(sum(r.total_cost), 0) from public.growth_cp_cost_rows r where not coalesce(r.is_trashed, false))
    when 'bootcamp'   then
      (select coalesce(sum(coalesce(r.ad_spend,0)+coalesce(r.influencer_spend,0)+coalesce(r.comms_spend,0)+coalesce(r.telegram_spend,0)+coalesce(r.host_spend,0)+coalesce(r.price_spend,0)), 0)
         from public.growth_events_rows r where not coalesce(r.is_trashed, false))
      + (select coalesce(sum(coalesce(m.ad_spend,0)+coalesce(m.influencer_spend,0)+coalesce(m.comms_spend,0)+coalesce(m.telegram_spend,0)+coalesce(m.host_spend,0)+coalesce(m.price_spend,0)), 0)
           from public.growth_events_manual m where not coalesce(m.is_trashed, false))
    else 0::numeric
  end
$$;

-- all-time spend per source: CodeSprint / Predictor rows by the utm_source in their link;
-- event rows by spend type (Telegram spend -> telegram, everything else -> 'untagged')
create or replace function public.ins__spend_by_source()
returns table(src text, spend numeric)
language sql stable
set search_path to ''
as $$
  with s as (
    select public.ins__src(substring(r.utm_link from '[?&]utm_source=([^&#]+)')) as src, coalesce(r.total_cost, 0) as amt
    from public.growth_cs_cost_rows r where not coalesce(r.is_trashed, false)
    union all
    select public.ins__src(substring(r.utm_link from '[?&]utm_source=([^&#]+)')), coalesce(r.total_cost, 0)
    from public.growth_cp_cost_rows r where not coalesce(r.is_trashed, false)
    union all
    select 'telegram', coalesce(r.telegram_spend, 0) from public.growth_events_rows r where not coalesce(r.is_trashed, false)
    union all
    select 'untagged', coalesce(r.ad_spend,0)+coalesce(r.influencer_spend,0)+coalesce(r.comms_spend,0)+coalesce(r.host_spend,0)+coalesce(r.price_spend,0)
    from public.growth_events_rows r where not coalesce(r.is_trashed, false)
    union all
    select 'telegram', coalesce(m.telegram_spend, 0) from public.growth_events_manual m where not coalesce(m.is_trashed, false)
    union all
    select 'untagged', coalesce(m.ad_spend,0)+coalesce(m.influencer_spend,0)+coalesce(m.comms_spend,0)+coalesce(m.host_spend,0)+coalesce(m.price_spend,0)
    from public.growth_events_manual m where not coalesce(m.is_trashed, false)
  )
  select case when s.src = 'unknown' then 'untagged' else s.src end, sum(s.amt)
  from s group by 1 having sum(s.amt) <> 0
$$;

-- ── public functions ────────────────────────────────────────────────────────────

-- Vedam One funnel for one period
create or replace function public.ins_overview(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable
security definer
set search_path to ''
as $$
declare
  v_paid bigint := null;
  v jsonb;
begin
  perform public.ins__guard(p_from, p_to);

  -- VSAT fee payments only once that table exists (staging today, not production)
  if to_regclass('public.vsat_payments') is not null then
    execute 'select count(distinct lead_id) from public.vsat_payments
             where coalesce(paid_at, created_at) >= $1 and coalesce(paid_at, created_at) < $2'
      into v_paid using coalesce(p_from, '-infinity'::timestamptz), coalesce(p_to, 'infinity'::timestamptz);
  end if;

  with f as (select * from public.ins__facts()),
  reg as (
    select * from f where f.signup_at >= coalesce(p_from, '-infinity') and f.signup_at < coalesce(p_to, 'infinity')
  ),
  att as (
    select count(distinct t.session_id) as n from public.traffic_events t
    where t.kind = 'view' and t.path = '/register' and t.session_id is not null
      and t.created_at >= coalesce(p_from, '-infinity') and t.created_at < coalesce(p_to, 'infinity')
  )
  select jsonb_build_object(
    'visitors',            public.ins__visitors('all', p_from, p_to),
    'attempted',           (select n from att),
    'registered',          (select count(*) from reg),
    'partial',             (select count(*) from reg where not reg.is_full),
    'full',                (select count(*) from reg where reg.is_full),
    'mqr',                 (select count(*) from reg where reg.is_mqr),
    'used_product',        (select count(*) from reg where reg.n_products > 0),
    'vsat_early',          (select count(*) from reg where reg.vsat_at is not null),
    'vsat_early_mqr',      (select count(*) from reg where reg.vsat_at is not null and reg.is_mqr),
    'vsat_early_in_period',(select count(*) from f where f.vsat_at >= coalesce(p_from, '-infinity') and f.vsat_at < coalesce(p_to, 'infinity')),
    'vsat_paid_in_period', v_paid
  ) into v;
  return v;
end $$;

-- one row per product for one period
create or replace function public.ins_products(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable
security definer
set search_path to ''
as $$
declare v jsonb;
begin
  perform public.ins__guard(p_from, p_to);

  with f as (select * from public.ins__facts()),
  prods(product, ord) as (values ('codesprint', 1), ('bootcamp', 2), ('pyq', 3), ('cp', 4), ('vsat', 5)),
  pu as (
    select pr.product, u.user_id from prods pr
    cross join lateral public.ins__product_users(pr.product, p_from, p_to) u
  ),
  j as (select pu.product, f.* from pu join f on f.user_id = pu.user_id)
  select coalesce(jsonb_agg(x.row order by x.ord), '[]'::jsonb) into v
  from (
    select pr.ord, jsonb_build_object(
      'product',     pr.product,
      'visitors',    public.ins__visitors(pr.product, p_from, p_to),
      'users',       (select count(*) from j where j.product = pr.product),
      'new_users',   (select count(*) from j where j.product = pr.product and
                        case pr.product when 'codesprint' then j.cs_at when 'bootcamp' then j.bc_at when 'pyq' then j.pyq_at
                                        when 'cp' then j.cp_at else j.vsat_at end >= coalesce(p_from, '-infinity')),
      'full',        (select count(*) from j where j.product = pr.product and j.is_full),
      'mqr',         (select count(*) from j where j.product = pr.product and j.is_mqr),
      'vsat_early',  (select count(*) from j where j.product = pr.product and j.vsat_at is not null),
      'multi',       (select count(*) from j where j.product = pr.product and j.n_products >= 2),
      'step1',       (select count(*) from j where j.product = pr.product and case pr.product
                        when 'codesprint' then j.cs_enrolled when 'bootcamp' then j.bc_attended > 0
                        when 'pyq' then j.pyq_submitted > 0 when 'cp' then j.cp_uses >= 2 else j.n_products > 0 end),
      'step2',       (select count(*) from j where j.product = pr.product and case pr.product
                        when 'codesprint' then j.cs_started when 'bootcamp' then j.bc_stayed > 0
                        when 'pyq' then j.pyq_submitted >= 2 when 'cp' then j.cp_uses >= 5 else j.n_products >= 2 end),
      'step3',       (select count(*) from j where j.product = pr.product and case pr.product
                        when 'codesprint' then j.cs_certs > 0 when 'bootcamp' then j.bc_projects > 0
                        else false end),
      'spend_all_time', public.ins__spend(pr.product)
    ) as row
    from prods pr
  ) x;
  return v;
end $$;

-- source breakdown of people who signed up in the period (optionally only users of one product)
create or replace function public.ins_sources(p_from timestamptz, p_to timestamptz, p_product text default 'all')
returns jsonb
language plpgsql stable
security definer
set search_path to ''
as $$
declare v jsonb;
begin
  perform public.ins__guard(p_from, p_to);
  if p_product is null or p_product not in ('all', 'codesprint', 'bootcamp', 'pyq', 'cp', 'vsat') then
    raise exception 'product_invalid' using errcode = '22023';
  end if;

  with f as (select * from public.ins__facts()),
  c as (
    select f.* from f
    where (p_product = 'all' and f.signup_at >= coalesce(p_from, '-infinity') and f.signup_at < coalesce(p_to, 'infinity'))
       or (p_product <> 'all' and f.user_id in (select u.user_id from public.ins__product_users(p_product, p_from, p_to) u))
  ),
  agg as (
    select c.src, count(*) as users,
           count(*) filter (where c.is_full) as full_reg,
           count(*) filter (where c.is_mqr) as mqr,
           count(*) filter (where c.vsat_at is not null) as vsat_early,
           count(*) filter (where c.n_products >= 2) as multi
    from c group by c.src
  ),
  -- all-time spend is shown only on the all-products view (spend rows are not split by product)
  sp as (select s.src, s.spend from public.ins__spend_by_source() s where p_product = 'all')
  select coalesce(jsonb_agg(jsonb_build_object(
           'source', coalesce(a.src, sp.src), 'users', coalesce(a.users, 0), 'full', coalesce(a.full_reg, 0),
           'mqr', coalesce(a.mqr, 0), 'vsat_early', coalesce(a.vsat_early, 0), 'multi', coalesce(a.multi, 0),
           'spend_all_time', sp.spend)
         order by coalesce(a.users, 0) desc, coalesce(a.src, sp.src)), '[]'::jsonb)
    into v
  from agg a full join sp on sp.src = a.src;
  return v;
end $$;

-- state breakdown of people who signed up in the period (optionally only users of one product)
create or replace function public.ins_states(p_from timestamptz, p_to timestamptz, p_product text default 'all')
returns jsonb
language plpgsql stable
security definer
set search_path to ''
as $$
declare v jsonb;
begin
  perform public.ins__guard(p_from, p_to);
  if p_product is null or p_product not in ('all', 'codesprint', 'bootcamp', 'pyq', 'cp', 'vsat') then
    raise exception 'product_invalid' using errcode = '22023';
  end if;

  with f as (select * from public.ins__facts()),
  c as (
    select f.* from f
    where (p_product = 'all' and f.signup_at >= coalesce(p_from, '-infinity') and f.signup_at < coalesce(p_to, 'infinity'))
       or (p_product <> 'all' and f.user_id in (select u.user_id from public.ins__product_users(p_product, p_from, p_to) u))
  ),
  agg as (
    select lower(coalesce(c.state, '')) as k, min(coalesce(c.state, 'Unknown')) as label, count(*) as users,
           count(*) filter (where c.is_mqr) as mqr,
           count(*) filter (where c.vsat_at is not null) as vsat_early,
           count(*) filter (where c.n_products >= 2) as multi
    from c group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('state', a.label, 'users', a.users, 'mqr', a.mqr,
                                               'vsat_early', a.vsat_early, 'multi', a.multi)
                            order by (a.k = '') , a.users desc, a.label), '[]'::jsonb)
    into v
  from agg a;
  return v;
end $$;

-- cross-product use and the VSAT link, for people who signed up in the period
create or replace function public.ins_cross(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable
security definer
set search_path to ''
as $$
declare v jsonb;
begin
  perform public.ins__guard(p_from, p_to);

  with c as (
    select f.* from public.ins__facts() f
    where f.signup_at >= coalesce(p_from, '-infinity') and f.signup_at < coalesce(p_to, 'infinity')
  ),
  uses as (  -- one row per user and product used, with the date they started
    select c.user_id, 'codesprint' as product, c.cs_at as at from c where c.cs_at is not null
    union all select c.user_id, 'bootcamp', c.bc_at from c where c.bc_at is not null
    union all select c.user_id, 'pyq', c.pyq_at from c where c.pyq_at is not null
    union all select c.user_id, 'cp', c.cp_at from c where c.cp_at is not null
  ),
  ordered as (
    select u.*, row_number() over (partition by u.user_id order by u.at, u.product) as rn from uses u
  ),
  lvl as (
    select c.user_id, c.vsat_at,
           case when c.n_deep >= 2 then 'high' when c.n_deep = 1 then 'medium' else 'low' end as level
    from c
  ),
  before_vsat as (  -- the last product a VSAT registrant started before registering for VSAT
    select c.user_id,
           coalesce((select u.product from uses u where u.user_id = c.user_id and u.at < c.vsat_at
                     order by u.at desc, u.product limit 1), 'none') as product
    from c where c.vsat_at is not null
  )
  select jsonb_build_object(
    'cohort',   (select count(*) from c),
    'vsat',     (select count(*) from c where c.vsat_at is not null),
    'by_count', (select coalesce(jsonb_agg(jsonb_build_object('n', k.n, 'users', k.users, 'vsat', k.vsat) order by k.n), '[]'::jsonb)
                 from (select c.n_products as n, count(*) as users, count(*) filter (where c.vsat_at is not null) as vsat
                       from c group by c.n_products) k),
    'pairs',    (select coalesce(jsonb_agg(jsonb_build_object('a', p.a, 'b', p.b, 'users', p.users, 'vsat', p.vsat) order by p.a, p.b), '[]'::jsonb)
                 from (select a.product as a, b.product as b, count(*) as users,
                              count(*) filter (where c.vsat_at is not null) as vsat
                       from uses a join uses b on b.user_id = a.user_id and b.product > a.product
                       join c on c.user_id = a.user_id
                       group by a.product, b.product) p),
    'products', (select coalesce(jsonb_agg(jsonb_build_object('product', q.product, 'users', q.users, 'multi', q.multi, 'vsat', q.vsat) order by q.product), '[]'::jsonb)
                 from (select u.product, count(*) as users,
                              count(*) filter (where c.n_products >= 2) as multi,
                              count(*) filter (where c.vsat_at is not null) as vsat
                       from uses u join c on c.user_id = u.user_id group by u.product) q),
    'paths',    (select coalesce(jsonb_agg(jsonb_build_object('from', t.a, 'to', t.b, 'users', t.users) order by t.users desc, t.a, t.b), '[]'::jsonb)
                 from (select o1.product as a, o2.product as b, count(*) as users
                       from ordered o1 join ordered o2 on o2.user_id = o1.user_id and o2.rn = o1.rn + 1
                       where o1.rn = 1 group by o1.product, o2.product) t),
    'levels',   (select coalesce(jsonb_agg(jsonb_build_object('level', l.level, 'users', l.users, 'vsat', l.vsat)), '[]'::jsonb)
                 from (select lvl.level, count(*) as users, count(*) filter (where lvl.vsat_at is not null) as vsat
                       from lvl group by lvl.level) l),
    'before_vsat', (select coalesce(jsonb_agg(jsonb_build_object('product', b.product, 'users', b.users) order by b.users desc, b.product), '[]'::jsonb)
                    from (select bv.product, count(*) as users from before_vsat bv group by bv.product) b)
  ) into v;
  return v;
end $$;

-- the people behind any number: one row per user, newest activity first (paged by the client)
create or replace function public.ins_people(
  p_from timestamptz, p_to timestamptz,
  p_products text[] default null,  -- must have used ALL of these (codesprint, bootcamp, pyq, cp)
  p_min_products int default null, -- at least this many products
  p_level text default null,       -- low | medium | high
  p_source text default null,      -- normalised source key
  p_state text default null,       -- state name (case-insensitive); 'Unknown' = blank
  p_vsat boolean default null      -- true = VSAT early registered, false = not
)
returns setof jsonb
language plpgsql stable
security definer
set search_path to ''
as $$
begin
  perform public.ins__guard(p_from, p_to);
  if p_level is not null and p_level not in ('low', 'medium', 'high') then
    raise exception 'level_invalid' using errcode = '22023';
  end if;
  if p_products is not null and not (p_products <@ array['codesprint', 'bootcamp', 'pyq', 'cp']) then
    raise exception 'product_invalid' using errcode = '22023';
  end if;

  return query
  select jsonb_build_object(
    'user_id', f.user_id, 'public_id', p.public_id, 'name', p.full_name, 'email', p.email, 'phone', p.phone,
    'signup_at', f.signup_at, 'source', f.src, 'state', coalesce(f.state, 'Unknown'),
    'full', f.is_full, 'mqr', f.is_mqr, 'n_products', f.n_products,
    'level', case when f.n_deep >= 2 then 'high' when f.n_deep = 1 then 'medium' else 'low' end,
    'codesprint', case when f.cs_at is null then null else jsonb_build_object(
        'since', f.cs_at, 'enrolled', f.cs_enrolled, 'lessons', f.cs_lessons, 'certs', f.cs_certs) end,
    'bootcamp', case when f.bc_at is null then null else jsonb_build_object(
        'since', f.bc_at, 'registered', f.bc_regs, 'attended', f.bc_attended, 'stayed', f.bc_stayed, 'projects', f.bc_projects) end,
    'pyq', case when f.pyq_at is null then null else jsonb_build_object(
        'since', f.pyq_at, 'started', f.pyq_attempts, 'submitted', f.pyq_submitted) end,
    'cp', case when f.cp_at is null then null else jsonb_build_object('since', f.cp_at, 'predictions', f.cp_uses) end,
    'vsat_at', f.vsat_at,
    'last_activity_at', f.last_activity_at)
  from public.ins__facts() f
  left join public.profiles p on p.id = f.user_id
  where f.signup_at >= coalesce(p_from, '-infinity') and f.signup_at < coalesce(p_to, 'infinity')
    and (p_products is null or (
          (not ('codesprint' = any(p_products)) or f.cs_at is not null) and
          (not ('bootcamp'   = any(p_products)) or f.bc_at is not null) and
          (not ('pyq'        = any(p_products)) or f.pyq_at is not null) and
          (not ('cp'         = any(p_products)) or f.cp_at is not null)))
    and (p_min_products is null or f.n_products >= p_min_products)
    and (p_level is null or p_level = case when f.n_deep >= 2 then 'high' when f.n_deep = 1 then 'medium' else 'low' end)
    and (p_source is null or f.src = public.ins__src(p_source))
    and (p_state is null or lower(coalesce(f.state, 'unknown')) = lower(btrim(p_state)))
    and (p_vsat is null or (f.vsat_at is not null) = p_vsat)
  order by f.n_products desc, f.last_activity_at desc nulls last, f.user_id;
end $$;

-- active users per product: today / last 7 days / last 30 days (IST), plus the same
-- periods one step earlier, and a daily trend. 5+ minutes in a day = active that day;
-- Bootcamp = 5+ minutes in the live Zoom session of a bootcamp held that day.
create or replace function public.ins_active(p_days int default 30)
returns jsonb
language plpgsql stable
security definer
set search_path to ''
as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  v jsonb;
begin
  perform public.ins__guard(null, null);
  if p_days is null or p_days < 7 or p_days > 120 then
    raise exception 'days_invalid' using errcode = '22023';
  end if;

  with d as (  -- one row per user, product and active day
    select a.user_id, a.product, a.day from public.product_active_daily a
    where a.active_seconds >= 300 and a.product <> 'bootcamp' and a.day > today - 60
    union
    select b.user_id, 'bootcamp', (e.starts_at at time zone 'Asia/Kolkata')::date
    from public.bootcamp_participation b join public.events e on e.id = b.event_id
    where coalesce(b.attended_minutes, 0) >= 5 and e.starts_at is not null
      and (e.starts_at at time zone 'Asia/Kolkata')::date > today - 60
  ),
  prods(product, ord) as (values ('site', 0), ('codesprint', 1), ('bootcamp', 2), ('pyq', 3), ('cp', 4), ('vsat', 5), ('peerpath', 6))
  select jsonb_build_object(
    'today', today,
    'products', (select jsonb_agg(jsonb_build_object(
        'product', pr.product,
        'dau',      (select count(distinct d.user_id) from d where d.product = pr.product and d.day = today),
        'dau_prev', (select count(distinct d.user_id) from d where d.product = pr.product and d.day = today - 1),
        'wau',      (select count(distinct d.user_id) from d where d.product = pr.product and d.day > today - 7),
        'wau_prev', (select count(distinct d.user_id) from d where d.product = pr.product and d.day > today - 14 and d.day <= today - 7),
        'mau',      (select count(distinct d.user_id) from d where d.product = pr.product and d.day > today - 30),
        'mau_prev', (select count(distinct d.user_id) from d where d.product = pr.product and d.day > today - 60 and d.day <= today - 30),
        'tracked_since', case when pr.product = 'bootcamp'
                           then (select min((e.starts_at at time zone 'Asia/Kolkata')::date) from public.events e
                                 where exists (select 1 from public.bootcamp_participation b where b.event_id = e.id and b.attended_minutes is not null))
                           else (select min(a.day) from public.product_active_daily a where a.product = pr.product) end
      ) order by pr.ord) from prods pr),
    'trend', (select coalesce(jsonb_agg(jsonb_build_object('day', t.day, 'product', t.product, 'dau', t.n) order by t.day, t.product), '[]'::jsonb)
              from (select d.day, d.product, count(distinct d.user_id) as n from d
                    where d.day > today - p_days group by d.day, d.product) t)
  ) into v;
  return v;
end $$;

-- ── grants ──────────────────────────────────────────────────────────────────────

revoke all on function public.ins__guard(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.ins__src(text) from public, anon, authenticated;
revoke all on function public.ins__facts() from public, anon, authenticated;
revoke all on function public.ins__product_users(text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.ins__visitors(text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.ins__spend(text) from public, anon, authenticated;
revoke all on function public.ins__spend_by_source() from public, anon, authenticated;

revoke all on function public.ins_overview(timestamptz, timestamptz) from public, anon;
revoke all on function public.ins_products(timestamptz, timestamptz) from public, anon;
revoke all on function public.ins_sources(timestamptz, timestamptz, text) from public, anon;
revoke all on function public.ins_states(timestamptz, timestamptz, text) from public, anon;
revoke all on function public.ins_cross(timestamptz, timestamptz) from public, anon;
revoke all on function public.ins_people(timestamptz, timestamptz, text[], int, text, text, text, boolean) from public, anon;
revoke all on function public.ins_active(int) from public, anon;

grant execute on function public.ins_overview(timestamptz, timestamptz) to authenticated;
grant execute on function public.ins_products(timestamptz, timestamptz) to authenticated;
grant execute on function public.ins_sources(timestamptz, timestamptz, text) to authenticated;
grant execute on function public.ins_states(timestamptz, timestamptz, text) to authenticated;
grant execute on function public.ins_cross(timestamptz, timestamptz) to authenticated;
grant execute on function public.ins_people(timestamptz, timestamptz, text[], int, text, text, text, boolean) to authenticated;
grant execute on function public.ins_active(int) to authenticated;
