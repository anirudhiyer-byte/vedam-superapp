-- Rollback for 0078_bootcamp_active_page_time.sql
-- Restores ins_active (the 0068 version: Bootcamp = 5+ minutes in the live Zoom) and
-- dash_active_users (the version before 0078) exactly. Grants are kept by CREATE OR REPLACE.
-- Expected md5(pg_get_functiondef) after rollback:
--   ins_active        adb670f0c0be5a38e03bb7fb4e9de8a7
--   dash_active_users c59b5f63655b0c33b37a5dcc4101fad5

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

-- dash_active_users as it was before 0078
CREATE OR REPLACE FUNCTION public.dash_active_users(p_product text, p_min integer DEFAULT 300)
 RETURNS TABLE(dau bigint, dau_prev bigint, wau bigint, wau_prev bigint, mau bigint, mau_prev bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not public.is_admin() then return query select 0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint; return; end if;
  return query
  select
    (select count(distinct user_id) from public.product_active_daily where product=p_product and day=today and active_seconds>=p_min),
    (select count(distinct user_id) from public.product_active_daily where product=p_product and day=today-1 and active_seconds>=p_min),
    (select count(distinct user_id) from public.product_active_daily where product=p_product and day>today-7  and day<=today     and active_seconds>=p_min),
    (select count(distinct user_id) from public.product_active_daily where product=p_product and day>today-14 and day<=today-7   and active_seconds>=p_min),
    (select count(distinct user_id) from public.product_active_daily where product=p_product and day>today-30 and day<=today     and active_seconds>=p_min),
    (select count(distinct user_id) from public.product_active_daily where product=p_product and day>today-60 and day<=today-30  and active_seconds>=p_min);
end $function$;
