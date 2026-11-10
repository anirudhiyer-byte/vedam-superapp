-- Rollback 0072 · remove the Calling UTM Listing aggregate.
drop function if exists public.calling_utm_listing(jsonb);
