-- Rollback of 0132_growth_telegram_listing.sql — removes everything 0132 added and puts growth_campaign_delete back
-- as 0105 defined it. After this file the database is exactly as before 0132.
-- WARNING: drops the Telegram rows and columns (growth_tg_rows, growth_tg_columns) for good. Export them first if needed.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from cron.job where jobname = 'growth-tg-trash-purge') then
    perform cron.unschedule('growth-tg-trash-purge');
  end if;
end $$;

-- growth_campaign_delete as in 0105 (without the Telegram check)
create or replace function public.growth_campaign_delete(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_id uuid;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['id']);
  begin v_id := (p->>'id')::uuid; exception when others then raise exception 'BAD_VALUE: id' using errcode = '22023'; end;
  if v_id is null or not exists (select 1 from public.vsat_campaigns where id = v_id) then raise exception 'NOT_FOUND' using errcode = '22023'; end if;
  if exists (select 1 from public.growth_ad_rows where campaign_id = v_id) or exists (select 1 from public.growth_infl_posts where campaign_id = v_id) then
    raise exception 'IN_USE' using errcode = '22023';
  end if;
  delete from public.vsat_campaigns where id = v_id;
  return jsonb_build_object('ok', true);
end $fn$;

drop function if exists public.growth_tg_list(jsonb);
drop function if exists public.growth_tg_save(jsonb);
drop function if exists public.growth_tg_bulk_update(jsonb);
drop function if exists public.growth_tg_trash(jsonb);
drop function if exists public.growth_tg_purge(jsonb);
drop function if exists public.growth_tg_import(jsonb);
drop function if exists public.growth_tg_col_add(jsonb);
drop function if exists public.growth_tg_col_update(jsonb);
drop function if exists public.growth_tg_col_unhide_all(jsonb);
drop function if exists public.growth_tg_col_order(jsonb);
drop function if exists public.growth_tg_col_remove(jsonb);

drop function if exists public.growth__tg_ids(jsonb);
drop function if exists public.growth__tg_extra(jsonb, jsonb);
drop function if exists public.growth__tg_obj(uuid);
drop function if exists public.growth__tg_utm_owner(text, uuid, uuid);
drop function if exists public.growth__tg_save(jsonb);
drop function if exists public.growth__tg_attr(boolean);
drop function if exists public.growth__tg_purge_old();

drop trigger if exists trg_audit_growth_tg_rows on public.growth_tg_rows;
drop trigger if exists trg_audit_growth_tg_columns on public.growth_tg_columns;
drop table if exists public.growth_tg_rows;
drop table if exists public.growth_tg_columns;
