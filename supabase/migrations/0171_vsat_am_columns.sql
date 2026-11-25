-- 0171_vsat_am_columns.sql
-- Admin helper: the writable columns of application_manager (name + data type), so the
-- bulk-importer UI can offer a map-to-any-column dropdown without hardcoding the schema.
-- Locked columns (lead_id, created_at) are excluded. Admin only.
create or replace function public.vsat_am_columns()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare uid uuid := auth.uid(); out jsonb;
begin
  if uid is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('name', column_name, 'type', data_type) order by column_name), '[]'::jsonb)
    into out
    from information_schema.columns
   where table_schema = 'public' and table_name = 'application_manager'
     and not (column_name = any (public.vsat__am_locked_cols()));
  return jsonb_build_object('ok', true, 'columns', out);
end $$;
revoke all on function public.vsat_am_columns() from public, anon;
grant execute on function public.vsat_am_columns() to authenticated;
