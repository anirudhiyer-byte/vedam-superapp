-- 0063 · Active-time tracking: count College Predictor, VSAT early registration and
--        Talk to a Senior too, and cap what one ping can add.
--
-- What changes (only public.track_active_ping, written by the browser heartbeat):
--   * accepted products: codesprint, bootcamp, site, pyq  ->  + cp, vsat, peerpath
--   * one ping adds at most 120 seconds (the heartbeat sends about 60 s a minute; was 3600)
--   * one user's total for a product and day never goes above 24 hours
--   * search_path '' (every name was already schema-qualified)
-- Unchanged: signature, SECURITY DEFINER, grants, the table and its rows, and the rule
-- that signed-out callers and unknown products are ignored silently.
--
-- Rollback: supabase/rollback/0063_track_active_more_products_down.sql restores the
--           previous function byte for byte (md5 of pg_get_functiondef 355022dea4eb144c159599fc802d2485).

create or replace function public.track_active_ping(p_product text, p_seconds integer)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare uid uuid := auth.uid();
begin
  if uid is null or p_product is null or coalesce(p_seconds, 0) <= 0 then return; end if;
  if p_product not in ('codesprint', 'bootcamp', 'site', 'pyq', 'cp', 'vsat', 'peerpath') then return; end if;
  insert into public.product_active_daily(user_id, product, day, active_seconds)
  values (uid, p_product, (now() at time zone 'Asia/Kolkata')::date, least(p_seconds, 120))
  on conflict (user_id, product, day) do update
    set active_seconds = least(public.product_active_daily.active_seconds + least(excluded.active_seconds, 120), 86400),
        updated_at = now();
end $function$;
