-- Growth channels release (Consultants / Telegram / Vedantu: migrations 0130-0134, 0136-0138) · POST-CHECK
-- READ ONLY. Safe on staging and production: SELECT only, nothing is written.
-- Run on PRODUCTION after the 8 migrations. Every row must say ok = true.
--
-- What it proves:
--   1. every table: RLS on, no policies, no rights for the browser roles (anon / authenticated)
--   2. every public function: SECURITY DEFINER, empty search_path, not callable by anon, callable by signed-in users
--      (the admin check is inside the function); every private helper: not callable from the browser at all
--   3. production is the same as the tested staging database: functions (logic, arguments, result, security settings; comments
--      and spacing ignored), table columns, indexes, constraints, triggers, seeded standard columns, the three nightly jobs
--   4. the four functions of the pages that were already live did not change (compare with growth-channels-pre.sql)
-- Reference values were read from staging (kyhakenhbgcissmaacws) on 22 Nov 2026, after 0138. If a later migration changes one
-- of these objects on purpose, refresh the value here in the same pull request.

with ref_fn as (select split_part(x, ':', 1) n, split_part(x, ':', 2) h from unnest(string_to_array(
          'growth__cons_attr:98933271ea66,growth__cons_extra:9962bffd0150,growth__cons_ids:ffcc71b7ab64,growth__cons_in:5c186e7311f8,'
       || 'growth__cons_obj:71f0b5d9ebb1,growth__cons_people:74f39778427d,growth__cons_purge_old:f33aac515684,growth__cons_save:c6ac8e9ab6e7,'
       || 'growth__cons_stage:09866de85cf0,growth__cons_utm_owner:0652c41eca7f,growth__cons_window:898dea6dc82e,growth__leads:331eb4f6b170,'
       || 'growth__tg_attr:2cb5a9d09192,growth__tg_extra:3e320e2bc3c6,growth__tg_ids:ffcc71b7ab64,growth__tg_key_trg:10bdc6f615e0,growth__tg_obj:011e86c46141,'
       || 'growth__tg_purge_old:bab8ef548cd9,growth__tg_save:58255f321b62,growth__tg_utm_owner:dcc739107f17,growth__tgperf_filter:bc95313aedbb,'
       || 'growth__tgperf_people:e48ad1b6fca5,growth__vd_attr:ddcda6d483d1,growth__vd_campaign:ee68b1a8c3fd,growth__vd_extra:3a49c8acd936,'
       || 'growth__vd_ids:ffcc71b7ab64,growth__vd_key_trg:10bdc6f615e0,growth__vd_obj:01f3f63de100,growth__vd_purge_old:7ece004e08be,'
       || 'growth__vd_save:2d04340009ce,growth__vd_utm_owner:d4b1fafc65bf,growth__vdperf_people:acb59d19e5a9,growth_campaign_delete:eee7570fc3b4,'
       || 'growth_campaign_save:e8b96a8747a5,growth_cons_bulk_update:422d48a08afb,growth_cons_city_target_set:23a0140a6348,'
       || 'growth_cons_city_targets_get:e2a80c41c48a,growth_cons_col_add:9c7bc3f226a7,growth_cons_col_order:8c96225f281e,growth_cons_col_remove:2bd524b14cea,'
       || 'growth_cons_col_unhide_all:ffdccf7267d9,growth_cons_col_update:dcd8c3beda48,growth_cons_import:52688f96000d,growth_cons_list:d343d860670f,'
       || 'growth_cons_perf:9e47d4697a5a,growth_cons_perf_students:864a09a64c31,growth_cons_purge:b832fbff7116,growth_cons_save:f83220ed566b,'
       || 'growth_cons_trash:14e65e78a66f,growth_tg_bulk_update:f62160b90745,growth_tg_col_add:706694de0a78,growth_tg_col_order:b570dec6ccfa,'
       || 'growth_tg_col_remove:0db6cf516966,growth_tg_col_unhide_all:6ff4c1f15307,growth_tg_col_update:da369ee2253a,growth_tg_import:cae8aa3d0f26,'
       || 'growth_tg_list:3ff549355bf7,growth_tg_perf:3ba8815642cf,growth_tg_perf_meta:e4ff112bdea3,growth_tg_perf_students:c4cd1e565ad4,'
       || 'growth_tg_purge:ff1078671334,growth_tg_save:0cab5453a286,growth_tg_trash:63450bd99905,growth_vd_bulk_update:0f2e779ecd6e,'
       || 'growth_vd_col_add:0889c433a964,growth_vd_col_order:bc7ecdb3a4b4,growth_vd_col_remove:30a1277b0b32,growth_vd_col_unhide_all:91a7417efc14,'
       || 'growth_vd_col_update:2cb0a512b87f,growth_vd_import:690ebeb7c1d3,growth_vd_list:60d3bea72f13,growth_vd_perf_drill:43ab35ce2a0d,'
       || 'growth_vd_purge:b25b6189b72f,growth_vd_save:490d6aa800c7,growth_vd_trash:7fdf88e2b973', ',')) x),
ref_cols as (select split_part(x, ':', 1) n, split_part(x, ':', 2) h from unnest(string_to_array(
          'growth_cons_city_targets:5b48dc128901,growth_cons_columns:88b65bac7729,growth_cons_rows:968b0e7cb896,growth_tg_columns:88b65bac7729,growth_tg_rows:ee28ba148b9d,growth_vd_columns:88b65bac7729,growth_vd_rows:032d39a58ad5', ',')) x),
ref_idx as (select split_part(x, ':', 1) n, split_part(x, ':', 2) h from unnest(string_to_array(
          'growth_cons_city_targets:d5b21c337004,growth_cons_columns:a84ab52d6e43,growth_cons_rows:03d98736780e,growth_tg_columns:69a3aff37463,growth_tg_rows:17d66bd4cbbc,growth_vd_columns:dbde950d8bce,growth_vd_rows:5e954f96ec22', ',')) x),
ref_con as (select split_part(x, ':', 1) n, split_part(x, ':', 2) h from unnest(string_to_array(
          'growth_cons_city_targets:2aa93e556390,growth_cons_columns:a0e299ae068c,growth_cons_rows:3778414e4c74,growth_tg_columns:a0e299ae068c,growth_tg_rows:0d28f22a79dc,growth_vd_columns:a0e299ae068c,growth_vd_rows:987e2f78f46f', ',')) x),
ref_trg as (select split_part(x, ':', 1) n, split_part(x, ':', 2) h from unnest(string_to_array(
          'growth_cons_city_targets:trg_audit_growth_cons_city_targets,growth_cons_columns:trg_audit_growth_cons_columns,growth_cons_rows:trg_audit_growth_cons_rows,growth_tg_columns:trg_audit_growth_tg_columns,growth_tg_rows:trg_audit_growth_tg_rows+trg_growth_tg_rows_key,growth_vd_columns:trg_audit_growth_vd_columns,growth_vd_rows:trg_audit_growth_vd_rows+trg_growth_vd_rows_key', ',')) x),
fn as (
  select p.oid, p.proname n, p.prosecdef, coalesce(p.proconfig @> array['search_path=""'], false) sp,
         left(md5(pg_get_function_identity_arguments(p.oid) || '|' || pg_get_function_result(p.oid) || '|' || p.prosecdef::text || '|'
                  || coalesce(p.proconfig::text, '') || '|' || p.provolatile::text || '|'
                  || regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\s+', '', 'g')), 12) h
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (select n from ref_fn)
)
-- 1. tables
select 'table ' || r.n || ': RLS on, no policies, no browser rights' as "check",
       coalesce(c.relrowsecurity, false) and not exists (select 1 from pg_policy pl where pl.polrelid = c.oid)
         and not has_table_privilege('anon', c.oid, 'select,insert,update,delete')
         and not has_table_privilege('authenticated', c.oid, 'select,insert,update,delete') as ok, null::text as detail
  from ref_cols r left join pg_class c on c.oid = to_regclass('public.' || r.n)
union all
select 'table ' || r.n || ': columns same as staging', coalesce(x.h = r.h, false), coalesce(x.h, 'missing')
  from ref_cols r left join (
    select c.table_name n, left(md5(string_agg(c.column_name || ':' || c.data_type || ':' || c.is_nullable || ':' || coalesce(c.column_default, ''), ',' order by c.column_name)), 12) h
      from information_schema.columns c where c.table_schema = 'public' group by 1) x on x.n = r.n
union all
select 'table ' || r.n || ': indexes same as staging', coalesce(x.h = r.h, false), coalesce(x.h, 'missing')
  from ref_idx r left join (
    select tablename n, left(md5(string_agg(regexp_replace(indexdef, '\s+', ' ', 'g'), ';' order by indexname)), 12) h
      from pg_indexes where schemaname = 'public' group by 1) x on x.n = r.n
union all
select 'table ' || r.n || ': constraints same as staging', coalesce(x.h = r.h, false), coalesce(x.h, 'missing')
  from ref_con r left join (
    select c.relname n, left(md5(string_agg(pg_get_constraintdef(k.oid), ';' order by k.conname)), 12) h
      from pg_constraint k join pg_class c on c.oid = k.conrelid where c.relnamespace = 'public'::regnamespace group by 1) x on x.n = r.n
union all
select 'table ' || r.n || ': triggers same as staging', coalesce(x.h = r.h, false), coalesce(x.h, 'missing')
  from ref_trg r left join (
    select c.relname n, string_agg(t.tgname, '+' order by t.tgname) h
      from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relnamespace = 'public'::regnamespace group by 1) x on x.n = r.n
union all
-- 2. functions: who may call them
select 'function ' || r.n || case when r.n like 'growth\_\_%' then ': private (browser cannot call it)' else ': definer, anon blocked, signed-in allowed' end,
       f.oid is not null and f.sp and case when r.n like 'growth\_\_%'
         then not has_function_privilege('anon', f.oid, 'execute') and not has_function_privilege('authenticated', f.oid, 'execute')
         else f.prosecdef and not has_function_privilege('anon', f.oid, 'execute') and has_function_privilege('authenticated', f.oid, 'execute') end, null
  from ref_fn r left join fn f on f.n = r.n
union all
-- 3. functions: same as staging
select 'function ' || r.n || ': same as staging', coalesce(f.h = r.h, false), coalesce(f.h, 'missing')
  from ref_fn r left join fn f on f.n = r.n
union all
select 'no function exists twice (overloads)', (select count(*) from fn) = (select count(*) from ref_fn), (select count(*) from fn)::text || ' of ' || (select count(*) from ref_fn)::text
union all
-- 4. seeded standard columns and nightly trash clean-up jobs
select 'standard columns seeded (Consultants / Telegram / Vedantu = 17 / 12 / 18)',
       coalesce((select count(*) from public.growth_cons_columns where is_standard) = 17 and (select count(*) from public.growth_tg_columns where is_standard) = 12
         and (select count(*) from public.growth_vd_columns where is_standard) = 18, false),
       (select count(*) from public.growth_cons_columns where is_standard)::text || ' / ' || (select count(*) from public.growth_tg_columns where is_standard)::text
         || ' / ' || (select count(*) from public.growth_vd_columns where is_standard)::text
union all
select 'nightly job ' || j.n || ' is scheduled', exists (select 1 from cron.job c where c.jobname = j.n and c.schedule = j.s and c.command = j.c and c.active), j.s
  from (values ('growth-cons-trash-purge', '41 3 * * *', 'select public.growth__cons_purge_old()'),
               ('growth-tg-trash-purge', '43 3 * * *', 'select public.growth__tg_purge_old()'),
               ('growth-vd-trash-purge', '47 3 * * *', 'select public.growth__vd_purge_old()')) j(n, s, c)
union all
-- 5. pages that were already live: these four must be identical to the PRE-CHECK output
select 'fingerprint: ' || p.proname || ' (must NOT change)', true, left(md5(pg_get_functiondef(p.oid)), 12)
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('growth_perf', 'growth_weekly', 'growth_rows_list', 'growth__owned_leads')
order by 1;
