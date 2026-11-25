-- VSAT offer · default validity 7 days (sir, 24 Nov) — tests for migration 0190 (STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the Supabase MCP.
-- The last statement returns one row per test: test | pass | detail.
--
-- A. Pune and Gurugram default to 7 days · B. a student with no per-student days gets 7 days, last date 23:59:59 IST
-- C. the 0190 record (column comment) is there for the rollback
--
-- Read-only: nothing is written. (Per-student "Days to pay" still wins: vsat_offer_days_override.test.sql.)

create or replace function pg_temp.run_vsat_offer_days_7_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}'; s text; k text; v_app text; d record;
  v_now timestamptz := '2026-11-25 10:00:00+05:30';
begin
  t_name := t_name || text 'A Pune and Gurugram default validity = 7 days';
  select string_agg(campus || '=' || offer_days, ', ' order by campus) into s from public.vsat_campus_settings;
  t_det := t_det || coalesce(s, 'no rows');
  t_pass := t_pass || (s = 'gurugram=7, pune=7');

  for k in select 'pune' union all select 'gurugram' loop
    t_name := t_name || ('B ' || k || ' student without per-student days: 7 days, last date 2 Dec 2026 23:59:59 IST')::text;
    select am.application_id into v_app from public.application_manager am
     where public.vsat__campus_key(am.campus_applied) = k and am.offer_days_override is null
     order by am.application_id limit 1;
    select * into d from public.vsat__offer_deadline(v_app, v_now);
    t_det := t_det || format('%s: days %s, expires %s', coalesce(v_app, 'no student'), d.days, d.expires_at at time zone 'Asia/Kolkata');
    t_pass := t_pass || (v_app is not null and d.days = 7 and d.expires_at = '2026-12-02 23:59:59+05:30'::timestamptz);
  end loop;

  t_name := t_name || text 'C 0190 kept the earlier values for the rollback';
  s := col_description('public.vsat_campus_settings'::regclass,
         (select a.attnum from pg_catalog.pg_attribute a where a.attrelid = 'public.vsat_campus_settings'::regclass and a.attname = 'offer_days')::int);
  t_det := t_det || coalesce(s, 'no comment');
  t_pass := t_pass || (s like '%Before 0190: {%' and substr(s, position('Before 0190: ' in s) + 13)::jsonb ?& array['pune', 'gurugram']);

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, pass, detail from pg_temp.run_vsat_offer_days_7_tests();
