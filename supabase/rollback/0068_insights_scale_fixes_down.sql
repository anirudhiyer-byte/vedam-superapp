-- Rollback for 0068_insights_scale_fixes.sql
-- Restores ins_overview, ins_products, ins_states, ins_cross and ins_active exactly as 0062
-- created them (copied from 0062). Grants are untouched by 0068 (CREATE OR REPLACE keeps them).
-- md5(pg_get_functiondef) on staging before 0068:
--   ins_active 159b1db4aee39b6c45f6b98e9ab21ddd · ins_cross 085c950ae09f307d74c0d4c8cee74987
--   ins_overview ca45cbb722eaaaee658441103e5888fd · ins_products 5e677c759d69a6febb40c8c329a5f587
--   ins_states 15e6a5db07e2be008a77bf443552f53e

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
