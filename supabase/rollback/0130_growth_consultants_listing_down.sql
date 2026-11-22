-- Rollback of 0130_growth_consultants_listing.sql — removes everything 0130 added. Nothing else was changed by 0130,
-- so after this file the database is exactly as before it.
-- WARNING: drops the Consultant Listing rows and columns (growth_cons_rows / growth_cons_columns) for good.
-- Export them first if they hold real data.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'growth-cons-trash-purge') then
    perform cron.unschedule('growth-cons-trash-purge');
  end if;
end $$;

drop function if exists public.growth_cons_col_remove(jsonb);
drop function if exists public.growth_cons_col_order(jsonb);
drop function if exists public.growth_cons_col_unhide_all(jsonb);
drop function if exists public.growth_cons_col_update(jsonb);
drop function if exists public.growth_cons_col_add(jsonb);
drop function if exists public.growth_cons_import(jsonb);
drop function if exists public.growth_cons_purge(jsonb);
drop function if exists public.growth_cons_trash(jsonb);
drop function if exists public.growth_cons_bulk_update(jsonb);
drop function if exists public.growth_cons_save(jsonb);
drop function if exists public.growth_cons_list(jsonb);

drop function if exists public.growth__cons_purge_old();
drop function if exists public.growth__cons_attr(boolean);
drop function if exists public.growth__cons_save(jsonb);
drop function if exists public.growth__cons_utm_owner(text, uuid);
drop function if exists public.growth__cons_obj(uuid);
drop function if exists public.growth__cons_extra(jsonb, jsonb);
drop function if exists public.growth__cons_ids(jsonb);

drop trigger if exists trg_audit_growth_cons_columns on public.growth_cons_columns;
drop trigger if exists trg_audit_growth_cons_rows on public.growth_cons_rows;
drop table if exists public.growth_cons_columns;
drop table if exists public.growth_cons_rows;
