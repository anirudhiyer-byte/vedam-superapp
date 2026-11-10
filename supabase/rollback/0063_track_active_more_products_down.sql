-- Rollback for 0063_track_active_more_products.sql
-- Restores public.track_active_ping exactly as it was before 0063 (copied from pg_get_functiondef,
-- md5 355022dea4eb144c159599fc802d2485 on staging and production). Grants are untouched by 0063.

CREATE OR REPLACE FUNCTION public.track_active_ping(p_product text, p_seconds integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid();
begin
  if uid is null or p_product is null or coalesce(p_seconds,0) <= 0 then return; end if;
  if p_product not in ('codesprint','bootcamp','site','pyq') then return; end if;
  insert into public.product_active_daily(user_id, product, day, active_seconds)
  values (uid, p_product, (now() at time zone 'Asia/Kolkata')::date, least(p_seconds, 3600))
  on conflict (user_id, product, day) do update
    set active_seconds = public.product_active_daily.active_seconds + least(excluded.active_seconds, 3600),
        updated_at = now();
end $function$;
