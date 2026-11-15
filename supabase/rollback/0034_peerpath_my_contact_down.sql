-- Rollback for 0034_peerpath_my_contact.sql (run 0035's rollback first, then this, then 0033's)
drop function if exists public.pp_my_contact();
