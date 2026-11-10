-- 0068 · Insights dashboards — fixes found by the 5,000-user test on staging (2026-11-06).
--
-- What changes (only these five read-only functions from 0062; nothing else):
--   1. ins_overview  + 'mqr_full' = MQRs who also have a full profile. The page showed
--                      "MQR % of full profiles" as all MQRs / full profiles, which can go above
--                      100% because many MQRs have not finished their profile. The page now
--                      divides mqr_full by full. Every other number is unchanged.
--   2. ins_states    the state label is the most common spelling in the group. Before, the
--                      alphabetically first one won, so "uttar pradesh" (typed in lower case
--                      by a few people) could replace "Uttar Pradesh" for the whole row.
--                      Counts are unchanged (grouping was already case-insensitive).
--   3. ins_cross     "last product before VSAT" is found with one sorted pass instead of a
--                      lookup per VSAT registrant (9.7 s → well under 1 s at 25,000 users).
--                      Same result.
--   4. ins_products  each product's numbers come from one grouped pass (was ~45 scans).
--                      Same result.
--   5. ins_active    the per-product counts come from one grouped pass (was 42 scans).
--                      Same result.
-- Unchanged: signatures, SECURITY DEFINER, search_path '', the admin check, grants (CREATE OR
-- REPLACE keeps them), all helpers (ins__*), every table.
--
-- Rollback: supabase/rollback/0068_insights_scale_fixes_down.sql restores the 0062 versions.
-- Tests:    supabase/tests/insights_dashboards.test.sql (all must still pass) and
--           supabase/tests/insights_scale_fixes.test.sql (the two behaviour changes above).
-- Staging: applied 2026-11-06 under the name 0067_insights_scale_fixes, then renumbered to 0068 before
--          commit (a teammate's unpushed migration is likely 0067). Same SQL; nothing to re-apply on staging.

-- 1 ─ overview funnel for one period (+ mqr_full) ──────────────────────────────────
create or replace function public.ins_overview(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable
security definer
set search_path to ''
as $$
declare
  v_paid bigint := null;
  v_lo timestamptz := coalesce(p_from, '-infinity'::timestamptz);
  v_hi timestamptz := coalesce(p_to, 'infinity'::timestamptz);
  v jsonb;
begin
  perform public.ins__guard(p_from, p_to);

  -- VSAT fee payments only once that table exists (staging today, not production)
  if to_regclass('public.vsat_payments') is not null then
    execute 'select count(distinct lead_id) from public.vsat_payments
             where coalesce(paid_at, created_at) >= $1 and coalesce(paid_at, created_at) < $2'
      into v_paid using v_lo, v_hi;
  end if;

  with f as (
    select x.*, (x.signup_at >= v_lo and x.signup_at < v_hi) as in_p from public.ins__facts() x
  ),
  a as (
    select count(*) filter (where f.in_p) as registered,
           count(*) filter (where f.in_p and not f.is_full) as partial,
           count(*) filter (where f.in_p and f.is_full) as full_reg,
           count(*) filter (where f.in_p and f.is_mqr) as mqr,
           count(*) filter (where f.in_p and f.is_mqr and f.is_full) as mqr_full,
           count(*) filter (where f.in_p and f.n_products > 0) as used_product,
           count(*) filter (where f.in_p and f.vsat_at is not null) as vsat_early,
           count(*) filter (where f.in_p and f.vsat_at is not null and f.is_mqr) as vsat_early_mqr,
           count(*) filter (where f.vsat_at >= v_lo and f.vsat_at < v_hi) as vsat_early_in_period
    from f
  ),
  att as (
    select count(distinct t.session_id) as n from public.traffic_events t
    where t.kind = 'view' and t.path = '/register' and t.session_id is not null
      and t.created_at >= v_lo and t.created_at < v_hi
  )
  select jsonb_build_object(
    'visitors',             public.ins__visitors('all', p_from, p_to),
    'attempted',            (select n from att),
    'registered',           a.registered,
    'partial',              a.partial,
    'full',                 a.full_reg,
    'mqr',                  a.mqr,
    'mqr_full',             a.mqr_full,
    'used_product',         a.used_product,
    'vsat_early',           a.vsat_early,
    'vsat_early_mqr',       a.vsat_early_mqr,
    'vsat_early_in_period', a.vsat_early_in_period,
    'vsat_paid_in_period',  v_paid
  ) into v
  from a;
  return v;
end $$;

-- 4 ─ one row per product for one period (one grouped pass) ─────────────────────────
create or replace function public.ins_products(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable
security definer
set search_path to ''
as $$
declare
  v_lo timestamptz := coalesce(p_from, '-infinity'::timestamptz);
  v_hi timestamptz := coalesce(p_to, 'infinity'::timestamptz);
  v jsonb;
begin
  perform public.ins__guard(p_from, p_to);

  with f as (select * from public.ins__facts()),
  prods(product, ord) as (values ('codesprint', 1), ('bootcamp', 2), ('pyq', 3), ('cp', 4), ('vsat', 5)),
  pu as (  -- the same people as ins__product_users(product, from, to), for every product at once
    select 'codesprint' as product, f.user_id from f where f.cs_at >= v_lo and f.cs_at < v_hi
    union
    select 'bootcamp', b.user_id from public.bootcamp_participation b
    where b.user_id is not null and b.registered_at >= v_lo and b.registered_at < v_hi
    union
    select 'pyq', a.user_id from public.pyq_attempts a
    where a.user_id is not null and coalesce(a.started_at, a.created_at) >= v_lo and coalesce(a.started_at, a.created_at) < v_hi
    union
    select 'cp', c.user_id from public.cp_predictions c
    where c.user_id is not null and c.created_at >= v_lo and c.created_at < v_hi
    union
    select 'vsat', s.user_id from public.vsat_registrations s
    where s.registered is true and s.user_id is not null
      and coalesce(s.registered_at, s.signup_at) >= v_lo and coalesce(s.registered_at, s.signup_at) < v_hi
  ),
  agg as (
    select pu.product,
      count(*) as users,
      count(*) filter (where case pu.product when 'codesprint' then f.cs_at when 'bootcamp' then f.bc_at when 'pyq' then f.pyq_at
                                             when 'cp' then f.cp_at else f.vsat_at end >= v_lo) as new_users,
      count(*) filter (where f.is_full) as full_reg,
      count(*) filter (where f.is_mqr) as mqr,
      count(*) filter (where f.vsat_at is not null) as vsat_early,
      count(*) filter (where f.n_products >= 2) as multi,
      count(*) filter (where case pu.product when 'codesprint' then f.cs_enrolled when 'bootcamp' then f.bc_attended > 0
                                             when 'pyq' then f.pyq_submitted > 0 when 'cp' then f.cp_uses >= 2 else f.n_products > 0 end) as step1,
      count(*) filter (where case pu.product when 'codesprint' then f.cs_started when 'bootcamp' then f.bc_stayed > 0
                                             when 'pyq' then f.pyq_submitted >= 2 when 'cp' then f.cp_uses >= 5 else f.n_products >= 2 end) as step2,
      count(*) filter (where case pu.product when 'codesprint' then f.cs_certs > 0 when 'bootcamp' then f.bc_projects > 0
                                             else false end) as step3
    from pu join f on f.user_id = pu.user_id
    group by pu.product
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'product',        pr.product,
      'visitors',       public.ins__visitors(pr.product, p_from, p_to),
      'users',          coalesce(a.users, 0),
      'new_users',      coalesce(a.new_users, 0),
      'full',           coalesce(a.full_reg, 0),
      'mqr',            coalesce(a.mqr, 0),
      'vsat_early',     coalesce(a.vsat_early, 0),
      'multi',          coalesce(a.multi, 0),
      'step1',          coalesce(a.step1, 0),
      'step2',          coalesce(a.step2, 0),
      'step3',          coalesce(a.step3, 0),
      'spend_all_time', public.ins__spend(pr.product)
    ) order by pr.ord), '[]'::jsonb) into v
  from prods pr left join agg a on a.product = pr.product;
  return v;
end $$;

-- 2 ─ state breakdown (label = most common spelling) ────────────────────────────────
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
    select lower(coalesce(c.state, '')) as k,
           mode() within group (order by coalesce(c.state, 'Unknown')) as label,
           count(*) as users,
           count(*) filter (where c.is_mqr) as mqr,
           count(*) filter (where c.vsat_at is not null) as vsat_early,
           count(*) filter (where c.n_products >= 2) as multi
    from c group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('state', a.label, 'users', a.users, 'mqr', a.mqr,
                                               'vsat_early', a.vsat_early, 'multi', a.multi)
                            order by (a.k = ''), a.users desc, a.label), '[]'::jsonb)
    into v
  from agg a;
  return v;
end $$;

-- 3 ─ cross-product use and the VSAT link (one sorted pass for "before VSAT") ───────
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
  bv as (  -- products started before VSAT, newest first
    select u.user_id, u.product,
           row_number() over (partition by u.user_id order by u.at desc, u.product) as rn
    from uses u join c on c.user_id = u.user_id
    where c.vsat_at is not null and u.at < c.vsat_at
  ),
  before_vsat as (  -- the last product a VSAT registrant started before registering for VSAT
    select c.user_id, coalesce(bv.product, 'none') as product
    from c left join bv on bv.user_id = c.user_id and bv.rn = 1
    where c.vsat_at is not null
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
                    from (select bv2.product, count(*) as users from before_vsat bv2 group by bv2.product) b)
  ) into v;
  return v;
end $$;

-- 5 ─ active users per product (one grouped pass) ───────────────────────────────────
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
  prods(product, ord) as (values ('site', 0), ('codesprint', 1), ('bootcamp', 2), ('pyq', 3), ('cp', 4), ('vsat', 5), ('peerpath', 6)),
  agg as (
    select d.product,
      count(distinct d.user_id) filter (where d.day = today) as dau,
      count(distinct d.user_id) filter (where d.day = today - 1) as dau_prev,
      count(distinct d.user_id) filter (where d.day > today - 7) as wau,
      count(distinct d.user_id) filter (where d.day > today - 14 and d.day <= today - 7) as wau_prev,
      count(distinct d.user_id) filter (where d.day > today - 30) as mau,
      count(distinct d.user_id) filter (where d.day > today - 60 and d.day <= today - 30) as mau_prev
    from d group by d.product
  ),
  since as (  -- first tracked day: the heartbeat table, except Bootcamp = first bootcamp with Zoom attendance
    select a.product, min(a.day) as first_day from public.product_active_daily a where a.product <> 'bootcamp' group by a.product
    union all
    select 'bootcamp', min((e.starts_at at time zone 'Asia/Kolkata')::date) from public.events e
    where exists (select 1 from public.bootcamp_participation b where b.event_id = e.id and b.attended_minutes is not null)
  )
  select jsonb_build_object(
    'today', today,
    'products', (select jsonb_agg(jsonb_build_object(
        'product',  pr.product,
        'dau',      coalesce(a.dau, 0),
        'dau_prev', coalesce(a.dau_prev, 0),
        'wau',      coalesce(a.wau, 0),
        'wau_prev', coalesce(a.wau_prev, 0),
        'mau',      coalesce(a.mau, 0),
        'mau_prev', coalesce(a.mau_prev, 0),
        'tracked_since', s.first_day
      ) order by pr.ord)
      from prods pr left join agg a on a.product = pr.product left join since s on s.product = pr.product),
    'trend', (select coalesce(jsonb_agg(jsonb_build_object('day', t.day, 'product', t.product, 'dau', t.n) order by t.day, t.product), '[]'::jsonb)
              from (select d.day, d.product, count(distinct d.user_id) as n from d
                    where d.day > today - p_days group by d.day, d.product) t)
  ) into v;
  return v;
end $$;
