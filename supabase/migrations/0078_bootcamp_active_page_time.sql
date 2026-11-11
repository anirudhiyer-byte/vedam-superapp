-- 0078 · Bootcamp active users = time on Bootcamp pages in Vedam One (2+ minutes a day), not Zoom.
--
-- Why: until now Insights counted a Bootcamp user as active on a day when they spent 5+ minutes in
-- the live Zoom session. Zoom is a separate app: that time is not spent in Vedam One, so it does
-- not show engagement with the product. Owner decision (11 Nov 2026): a Bootcamp user is active on a
-- day when they spend 2+ minutes on Bootcamp pages (/events, /e/...). The 2-minute bar is for
-- Bootcamp only, because those pages are short reads; every other product stays at 5+ minutes.
--
-- Data: the heartbeat (components/active-heartbeat.tsx, lib/active-product.ts) has saved seconds on
-- /events and /e/... as product 'bootcamp' in product_active_daily since 15 Oct 2026. No tracking
-- code changes; only how the two dashboards count it.
--
-- What changes:
--   1. public.ins_active (Insights > Active users): Bootcamp now comes from product_active_daily with
--      a 120-second bar, like the other products (300 seconds). The Zoom rows are no longer used.
--      "Tracked since" for Bootcamp = its first heartbeat day. Everything else unchanged.
--   2. public.dash_active_users (Daily Dashboard > Active Users): for p_product = 'bootcamp' the bar
--      is 120 seconds, whatever p_min the caller passes, so both dashboards show the same number.
--      Other products keep p_min (default 300). Also set search_path to '' (every name was already
--      schema-qualified), as the repo rules require for SECURITY DEFINER functions.
-- Unchanged: signatures, SECURITY DEFINER, admin checks, grants (CREATE OR REPLACE keeps them),
-- the table, its rows, and every other function.
--
-- Rollback: supabase/rollback/0078_bootcamp_active_page_time_down.sql restores both functions
--           exactly (md5 of pg_get_functiondef: ins_active adb670f0c0be5a38e03bb7fb4e9de8a7,
--           dash_active_users c59b5f63655b0c33b37a5dcc4101fad5).
-- Tests:    supabase/tests/bootcamp_active_page_time.test.sql

-- 1 ─ Insights: active users per product ────────────────────────────────────────────
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

  with d as (  -- one row per user, product and active day: 2+ minutes on Bootcamp pages, 5+ minutes elsewhere
    select a.user_id, a.product, a.day from public.product_active_daily a
    where a.active_seconds >= case when a.product = 'bootcamp' then 120 else 300 end
      and a.day > today - 60
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
  since as (  -- first tracked day per product (heartbeat)
    select a.product, min(a.day) as first_day from public.product_active_daily a group by a.product
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

-- 2 ─ Daily Dashboard: active users for one product ─────────────────────────────────
create or replace function public.dash_active_users(p_product text, p_min integer default 300)
returns table(dau bigint, dau_prev bigint, wau bigint, wau_prev bigint, mau bigint, mau_prev bigint)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  v_min integer := case when p_product = 'bootcamp' then 120 else p_min end;  -- Bootcamp: 2+ minutes on its pages (0078)
begin
  if not public.is_admin() then return query select 0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint; return; end if;
  return query
  select
    (select count(distinct a.user_id) from public.product_active_daily a where a.product=p_product and a.day=today and a.active_seconds>=v_min),
    (select count(distinct a.user_id) from public.product_active_daily a where a.product=p_product and a.day=today-1 and a.active_seconds>=v_min),
    (select count(distinct a.user_id) from public.product_active_daily a where a.product=p_product and a.day>today-7  and a.day<=today     and a.active_seconds>=v_min),
    (select count(distinct a.user_id) from public.product_active_daily a where a.product=p_product and a.day>today-14 and a.day<=today-7   and a.active_seconds>=v_min),
    (select count(distinct a.user_id) from public.product_active_daily a where a.product=p_product and a.day>today-30 and a.day<=today     and a.active_seconds>=v_min),
    (select count(distinct a.user_id) from public.product_active_daily a where a.product=p_product and a.day>today-60 and a.day<=today-30  and a.active_seconds>=v_min);
end $function$;
