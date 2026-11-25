-- Rollback for 0185_peerpath_admin_impact_trend.sql
-- Drops the one function 0185 added. No table or other function is touched, and no data is lost
-- (the function only reads). Revert the app code first: the admin page's Impact tab calls it
-- (without it the trend charts show "Could not load the trends"; the rest of the page still works).
begin;
drop function if exists public.pp_admin_impact_trend(jsonb);
commit;
