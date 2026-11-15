-- Rollback 0065 · Communication Manager Slice 3b (static lists from a CSV upload).
-- Drops exactly what 0065 created and puts the comm_lists kind check back to 'dynamic' only.
--
-- Static lists can only exist because of 0065, so they are deleted first (their members go with the
-- members table). Dynamic lists are not touched. Export any static list you need before running this.

drop function if exists public.comm_list_count(uuid);
drop function if exists public.comm_list_import(text, jsonb, boolean);

drop trigger if exists trg_comm_lists_members_on_delete on public.comm_lists;
drop function if exists public.comm__list_members_on_delete();

drop table if exists public.comm_list_members;

delete from public.comm_lists where kind = 'static';
alter table public.comm_lists drop constraint if exists comm_lists_kind_check;
alter table public.comm_lists add constraint comm_lists_kind_check check (kind in ('dynamic'));
