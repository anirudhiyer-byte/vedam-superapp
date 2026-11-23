-- Rollback 0146 · drop the School Connect channel (all objects are new in 0146).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'growth-sc-trash-purge') then
    perform cron.unschedule('growth-sc-trash-purge');
  end if;
end $$;

drop function if exists public.growth_sc_perf_drill(jsonb);
drop function if exists public.growth_sc_col_remove(jsonb);
drop function if exists public.growth_sc_col_order(jsonb);
drop function if exists public.growth_sc_col_unhide_all(jsonb);
drop function if exists public.growth_sc_col_update(jsonb);
drop function if exists public.growth_sc_col_add(jsonb);
drop function if exists public.growth_sc_import(jsonb);
drop function if exists public.growth_sc_purge(jsonb);
drop function if exists public.growth_sc_trash(jsonb);
drop function if exists public.growth_sc_bulk_update(jsonb);
drop function if exists public.growth_sc_save(jsonb);
drop function if exists public.growth_sc_list(jsonb);

drop function if exists public.growth__scperf_people(date, date, text, text);
drop function if exists public.growth__sc_purge_old();
drop function if exists public.growth__sc_attr(boolean);
drop function if exists public.growth__sc_signups(text[]);
drop function if exists public.growth__sc_save(jsonb);
drop function if exists public.growth__sc_utm_owner(text, date, uuid);
drop function if exists public.growth__sc_obj(uuid);
drop function if exists public.growth__sc_extra(jsonb, jsonb);

drop trigger if exists trg_growth_sc_rows_key on public.growth_sc_rows;
drop function if exists public.growth__sc_key_trg();

drop table if exists public.growth_sc_rows;
drop table if exists public.growth_sc_columns;
