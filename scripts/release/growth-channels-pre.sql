-- Growth channels release (Consultants / Telegram / Vedantu: migrations 0130-0134, 0136-0138) · PRE-CHECK
-- READ ONLY. Safe on staging and production: SELECT only, nothing is written.
-- Run on PRODUCTION before applying the migrations. Every row must say ok = true.
-- Also note the 'fingerprint' rows: run growth-channels-post.sql afterwards; those must be IDENTICAL (pages that existed before
-- must show the same numbers after the release).

with need_fn(f) as (values ('audit_trigger'),('growth__admin'),('growth__campaign_id'),('growth__campus'),('growth__date'),('growth__keys'),
                           ('growth__num'),('growth__txt'),('growth__url'),('growth__utm_key'),('vsat__norm_utm'),('growth__leads'),
                           ('growth_campaign_save'),('growth_campaign_delete'),('growth_perf'),('growth_weekly')),
need_tbl(t) as (values ('application_manager'),('growth_ad_rows'),('growth_infl_posts'),('lead_manager'),('vsat_campaigns'),
                       ('vsat_payment_orders'),('vsat_payments'),('audit_log')),
need_col(c) as (values ('application_manager.enrollment_paid_at'),('application_manager.enrollment_stage'),('application_manager.last_updated_date'),
                       ('lead_manager.primary_utm'),('lead_manager.user_registration_date'),('lead_manager.registered_email'),
                       ('vsat_payment_orders.discount_coupon'),('vsat_payment_orders.kind'),('vsat_payment_orders.status'),('vsat_payment_orders.cf_order_id'),
                       ('vsat_payments.paid_at'),('vsat_payments.lead_id'),('vsat_campaigns.campaign_start'),('vsat_campaigns.application_target'),
                       ('vsat_campaigns.exam_date'))
select 'needs: function ' || f as "check", exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = f) as ok, null::text as detail from need_fn
union all
select 'needs: table ' || t, to_regclass('public.' || t) is not null, null from need_tbl
union all
select 'needs: column ' || c, exists (select 1 from information_schema.columns where table_schema = 'public' and table_name || '.' || column_name = c), null from need_col
union all
select 'needs: extension pg_cron (nightly trash clean-up jobs)', exists (select 1 from pg_extension where extname = 'pg_cron'), null
union all
select 'fresh: ' || t || ' does not exist yet', to_regclass('public.' || t) is null, null from unnest(array['growth_cons_city_targets','growth_cons_columns','growth_cons_rows','growth_tg_columns','growth_tg_rows','growth_vd_columns','growth_vd_rows']) t
union all
select 'fresh: ' || f || ' does not exist yet', not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = f), null
  from unnest(array['growth_campaign_delete','growth_campaign_save','growth_cons_bulk_update','growth_cons_city_target_set','growth_cons_city_targets_get','growth_cons_col_add','growth_cons_col_order','growth_cons_col_remove','growth_cons_col_unhide_all','growth_cons_col_update','growth_cons_import','growth_cons_list','growth_cons_perf','growth_cons_perf_students','growth_cons_purge','growth_cons_save','growth_cons_trash','growth_tg_bulk_update','growth_tg_col_add','growth_tg_col_order','growth_tg_col_remove','growth_tg_col_unhide_all','growth_tg_col_update','growth_tg_import','growth_tg_list','growth_tg_perf','growth_tg_perf_meta','growth_tg_perf_students','growth_tg_purge','growth_tg_save','growth_tg_trash','growth_vd_bulk_update','growth_vd_col_add','growth_vd_col_order','growth_vd_col_remove','growth_vd_col_unhide_all','growth_vd_col_update','growth_vd_import','growth_vd_list','growth_vd_perf_drill','growth_vd_purge','growth_vd_save','growth_vd_trash']) f where f not in ('growth_campaign_save', 'growth_campaign_delete')
union all
select 'fingerprint: ' || p.proname || ' (shared, will be replaced)', true, left(md5(pg_get_functiondef(p.oid)), 12)
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('growth__leads', 'growth_campaign_save', 'growth_campaign_delete')
union all
select 'fingerprint: ' || p.proname || ' (must NOT change)', true, left(md5(pg_get_functiondef(p.oid)), 12)
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('growth_perf', 'growth_weekly', 'growth_rows_list', 'growth__owned_leads')
order by 1;
