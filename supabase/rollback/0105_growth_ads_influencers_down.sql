-- Rollback for 0105_growth_ads_influencers.sql
-- Removes the Ads + Influencers RPCs, helpers and tables. vsat_campaigns is NOT touched
-- (rows created through the campaign screen stay; the table existed before 0105).

drop function if exists public.growth_infl_views_set(jsonb);
drop function if exists public.growth_infl_youtube_targets();
drop function if exists public.growth_weekly(jsonb);
drop function if exists public.growth_perf(jsonb);
drop function if exists public.growth_column_remove(jsonb);
drop function if exists public.growth_column_add(jsonb);
drop function if exists public.growth_influencer_add(jsonb);
drop function if exists public.growth_rows_import(jsonb);
drop function if exists public.growth_rows_trash(jsonb);
drop function if exists public.growth_row_save(jsonb);
drop function if exists public.growth_rows_list(jsonb);
drop function if exists public.growth_campaign_delete(jsonb);
drop function if exists public.growth_campaign_save(jsonb);
drop function if exists public.growth_mkt_meta();

drop function if exists public.growth__row_attr(text, boolean);
drop function if exists public.growth__save_row(text, jsonb, boolean);
drop function if exists public.growth__next_serial(text);
drop function if exists public.growth__campaign_id(jsonb, text);
drop function if exists public.growth__extra(text, jsonb, jsonb);
drop function if exists public.growth__url(jsonb, text);
drop function if exists public.growth__date(jsonb, text);
drop function if exists public.growth__num(jsonb, text, numeric, numeric);
drop function if exists public.growth__txt(jsonb, text, int);
drop function if exists public.growth__channel(jsonb);
drop function if exists public.growth__keys(jsonb, text[]);
drop function if exists public.growth__leads(text[]);
drop function if exists public.growth__utm_key(text);
drop function if exists public.growth__admin();

drop table if exists public.growth_infl_posts;
drop table if exists public.growth_influencers;
drop table if exists public.growth_ad_rows;
drop table if exists public.growth_custom_columns;
