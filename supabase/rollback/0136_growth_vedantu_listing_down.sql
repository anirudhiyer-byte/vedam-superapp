-- Rollback of 0136_growth_vedantu_listing.sql — removes everything 0136 added and puts growth_campaign_delete back
-- as 0132 defined it (ads, influencer and Telegram checks). After this file the database is exactly as before 0136.
-- WARNING: drops the Vedantu rows and columns (growth_vd_rows, growth_vd_columns) for good. Export them first if needed.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from cron.job where jobname = 'growth-vd-trash-purge') then
    perform cron.unschedule('growth-vd-trash-purge');
  end if;
end $$;

-- growth_campaign_delete as in 0132 (without the Vedantu check)
create or replace function public.growth_campaign_delete(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_id uuid;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['id']);
  begin v_id := (p->>'id')::uuid; exception when others then raise exception 'BAD_VALUE: id' using errcode = '22023'; end;
  if v_id is null or not exists (select 1 from public.vsat_campaigns where id = v_id) then raise exception 'NOT_FOUND' using errcode = '22023'; end if;
  if exists (select 1 from public.growth_ad_rows where campaign_id = v_id) or exists (select 1 from public.growth_infl_posts where campaign_id = v_id)
     or exists (select 1 from public.growth_tg_rows where campaign_id = v_id) then
    raise exception 'IN_USE' using errcode = '22023';
  end if;
  delete from public.vsat_campaigns where id = v_id;
  return jsonb_build_object('ok', true);
end $fn$;

drop function if exists public.growth_vd_list(jsonb);
drop function if exists public.growth_vd_save(jsonb);
drop function if exists public.growth_vd_bulk_update(jsonb);
drop function if exists public.growth_vd_trash(jsonb);
drop function if exists public.growth_vd_purge(jsonb);
drop function if exists public.growth_vd_import(jsonb);
drop function if exists public.growth_vd_col_add(jsonb);
drop function if exists public.growth_vd_col_update(jsonb);
drop function if exists public.growth_vd_col_unhide_all(jsonb);
drop function if exists public.growth_vd_col_order(jsonb);
drop function if exists public.growth_vd_col_remove(jsonb);

drop function if exists public.growth__vd_ids(jsonb);
drop function if exists public.growth__vd_campaign(date);
drop function if exists public.growth__vd_extra(jsonb, jsonb);
drop function if exists public.growth__vd_obj(uuid);
drop function if exists public.growth__vd_utm_owner(text, date, uuid);
drop function if exists public.growth__vd_save(jsonb);
drop function if exists public.growth__vd_attr(boolean);
drop function if exists public.growth__vd_purge_old();

drop trigger if exists trg_growth_vd_rows_key on public.growth_vd_rows;
drop trigger if exists trg_audit_growth_vd_rows on public.growth_vd_rows;
drop trigger if exists trg_audit_growth_vd_columns on public.growth_vd_columns;
drop function if exists public.growth__vd_key_trg();
drop table if exists public.growth_vd_rows;
drop table if exists public.growth_vd_columns;
