-- Rollback for 0176_peerpath_admin_insights.sql
-- Drops the one function 0176 added. No table or other function is touched, and no data is lost
-- (the function only reads). Revert the app code first: the admin page's Impact tab calls it
-- (without it the tab shows "Could not load these numbers"; the rest of the page still works).
begin;
drop function if exists public.pp_admin_insights(jsonb);
commit;
