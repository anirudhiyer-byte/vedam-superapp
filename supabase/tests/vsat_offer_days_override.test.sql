-- VSAT offers · per-student "Days to pay" when releasing — tests for migration 0180 (STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the Supabase MCP.
-- The last statement returns one row per test: test | pass | detail.
--
-- Nothing is left behind: all test data is created inside a block that is rolled back with a private
-- error code at the end. Fake data only (@example.invalid, ZZTEST names).

create or replace function pg_temp.mk_user(p_email text)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, raw_user_meta_data)
  values (v, p_email, 'authenticated', 'authenticated', now(), '{}'::jsonb);
  insert into public.profiles (id, email, full_name) values (v, p_email, 'ZZTEST ' || split_part(p_email, '@', 1))
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
  return v;
end $$;

-- applicant at "counselled" (scholarship given = p_pct; null = counselling not saved)
create or replace function pg_temp.mk_app(p_id text, p_campus text, p_date uuid, p_pct numeric)
returns text language plpgsql as $$
declare u uuid := pg_temp.mk_user(lower(p_id) || '@example.invalid'); s text;
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, lead_stage) values (u, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', 'applicant_paid')
  on conflict (lead_id) do nothing;
  insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email, campus_applied, exam_date_id,
    class10_year, class10_percentage, class10_maths_percentage, class12_year, class12_percentage, class12_maths_percentage,
    marks_physics_12, marks_chemistry_12, marks_maths_12, exam_percentile, exam_obtained_marks, exam_max_marks, vps_score)
  values (p_id, u, p_id, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', p_campus, p_date,
    2024, 90, 85, 2026, 80, 70, 70, 70, 70, 80, 40, 50, 8.43);
  update public.application_manager set exam_given = true where application_id = p_id;
  foreach s in array array['vsat_cleared', 'interview_scheduled', 'interviewed', 'pi_cleared', 'counselling_scheduled', 'counselled'] loop
    perform public.vsat__move(p_id, s, 'active', 'zz test', 'system', null, null);
  end loop;
  update public.application_manager set scholarship_percentage = p_pct, scholarship_pct_1 = p_pct where application_id = p_id;
  return p_id;
end $$;

create or replace function pg_temp.call_as(p_uid uuid, p_sql text, p_role text default 'authenticated')
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  if p_role = 'anon' then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    set local role anon;
  elsif p_role = 'service_role' then
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    set local role service_role;
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    set local role authenticated;
  end if;
  execute p_sql into r;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return coalesce(r, 'null'::jsonb);
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('sqlstate', sqlstate, 'message', sqlerrm);
end $$;

create or replace function pg_temp.rpc(p_fn text, p jsonb)
returns text language sql as $$ select format('select public.%I(%L::jsonb)', p_fn, p::text) $$;

create or replace function pg_temp.release(p_who uuid, p_apps text[], p_dry boolean default false)
returns jsonb language sql as $$
  select pg_temp.call_as(p_who, pg_temp.rpc('vsat_offers_release', jsonb_build_object('application_ids', to_jsonb(p_apps), 'dry_run', p_dry)))
$$;

create or replace function pg_temp.move(p_who uuid, p_app text, p_to text, p_reason text default null, p_status text default 'active')
returns jsonb language sql as $$
  select pg_temp.call_as(p_who, pg_temp.rpc('vsat_move_stage',
    jsonb_strip_nulls(jsonb_build_object('application_id', p_app, 'to_stage', p_to, 'to_status', p_status, 'reason', p_reason))))
$$;

create or replace function pg_temp.stage(p_app text)
returns text language sql as $$ select vp.stage || ':' || vp.status from public.vsat_pipeline vp where vp.application_id = p_app $$;

create or replace function pg_temp.skip_code(r jsonb, p_app text)
returns text language sql as $$ select x->>'code' from jsonb_array_elements(r->'skipped') x where x->>'application_id' = p_app $$;

create or replace function pg_temp.release_days(p_who uuid, p_apps text[], p_days jsonb, p_dry boolean default false)
returns jsonb language sql as $$
  select pg_temp.call_as(p_who, pg_temp.rpc('vsat_offers_release',
    jsonb_build_object('application_ids', to_jsonb(p_apps), 'dry_run', p_dry, 'offer_days', p_days)))
$$;

create or replace function pg_temp.ist_day(t timestamptz)
returns text language sql as $$ select to_char(t at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') $$;

create or replace function pg_temp.run_vsat_offer_days_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; nobody uuid; d uuid;
  a1 text; a2 text; a3 text; a4 text; a5 text; a6 text; s1 text;
  r jsonb; s text; am public.application_manager; t timestamptz; n int;
  today_ist date := (now() at time zone 'Asia/Kolkata')::date;
  pune constant text := 'Ajeenkya DY Patil University — Pune';
  bad jsonb;
begin
  begin -- rolled back at the end (ZDONE)
    update public.vsat_campus_settings set offer_days = 5 where campus = 'pune';   -- campus default for these tests
    adm := pg_temp.mk_user('zztest-odays-adm@example.invalid');
    nobody := pg_temp.mk_user('zztest-odays-nobody@example.invalid');
    insert into public.vsat_team (user_id, role) values (adm, 'admissions');
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at)
    values ('ZZTEST offer days batch', 'zz-odays', current_date, now(), now() + interval '2 hours') returning id into d;
    a1 := pg_temp.mk_app('ZZT-ODAYS-1', pune, d, 40);
    a2 := pg_temp.mk_app('ZZT-ODAYS-2', pune, d, 30);
    a3 := pg_temp.mk_app('ZZT-ODAYS-3', pune, d, 30);
    a4 := pg_temp.mk_app('ZZT-ODAYS-4', pune, d, 30);
    a5 := pg_temp.mk_app('ZZT-ODAYS-5', pune, d, 30);
    a6 := pg_temp.mk_app('ZZT-ODAYS-6', pune, d, 30);
    s1 := pg_temp.mk_app('ZZT-ODAYS-S1', pune, d, 20);
    perform public.vsat__move(s1, 'counselling_scheduled', 'active', 'zz test', 'system', null, null);   -- one step back

    -- ════ A. the column ════
    t_name := t_name || text 'A offer_days_override exists, empty by default';
    select * into am from public.application_manager where application_id = a1;
    t_det := t_det || coalesce(am.offer_days_override::text, 'null'); t_pass := t_pass || (am.offer_days_override is null);
    t_name := t_name || text 'A the column only takes 1–90';
    s := '';
    begin update public.application_manager set offer_days_override = 0 where application_id = a1; s := s || '0 accepted;';
    exception when check_violation then null; end;
    begin update public.application_manager set offer_days_override = 91 where application_id = a1; s := s || '91 accepted;';
    exception when check_violation then null; end;
    begin update public.application_manager set offer_days_override = 1 where application_id = a1;
          update public.application_manager set offer_days_override = 90 where application_id = a1;
    exception when check_violation then s := s || '1/90 refused;'; end;
    update public.application_manager set offer_days_override = null where application_id = a1;
    t_det := t_det || coalesce(nullif(s, ''), 'ok'); t_pass := t_pass || (s = '');

    -- ════ B. the deadline helper ════
    t_name := t_name || text 'B deadline helper: no override → campus "Days to pay" (5)';
    select dd.days into n from public.vsat__offer_deadline(a1, now()) dd;
    t_det := t_det || coalesce(n::text, 'null'); t_pass := t_pass || (n = 5);
    t_name := t_name || text 'B deadline helper: override wins over the campus (12)';
    update public.application_manager set offer_days_override = 12 where application_id = a1;
    select dd.days, dd.expires_at into n, t from public.vsat__offer_deadline(a1, now()) dd;
    update public.application_manager set offer_days_override = null where application_id = a1;
    t_det := t_det || format('%s %s', n, pg_temp.ist_day(t));
    t_pass := t_pass || (n = 12 and (t at time zone 'Asia/Kolkata')::date = today_ist + 12 and pg_temp.ist_day(t) like '% 23:59:59');

    -- ════ C. preview (dry run) ════
    r := pg_temp.release_days(adm, array[a1], '10'::jsonb, true);
    t := (r->'released'->0->>'expires_at')::timestamptz;
    t_name := t_name || text 'C preview with 10 days shows today + 10, 11:59:59 pm IST'; t_det := t_det || r::text;
    t_pass := t_pass || ((t at time zone 'Asia/Kolkata')::date = today_ist + 10 and pg_temp.ist_day(t) like '% 23:59:59'
                         and (r->'released'->0->>'days')::int = 10 and r->>'dry_run' = 'true');
    select * into am from public.application_manager where application_id = a1;
    t_name := t_name || text 'C preview saves nothing (no override, no offer, same stage, no event)';
    t_det := t_det || format('override=%s released=%s stage=%s', am.offer_days_override, am.offer_released_at, pg_temp.stage(a1));
    t_pass := t_pass || (am.offer_days_override is null and am.offer_released_at is null and pg_temp.stage(a1) = 'counselled:active'
                         and not exists (select 1 from public.vsat_offer_events where application_id = a1));
    r := pg_temp.release_days(adm, array[a1], 'null'::jsonb, true);
    t := (r->'released'->0->>'expires_at')::timestamptz;
    t_name := t_name || text 'C preview with offer_days null = campus default (5)'; t_det := t_det || r::text;
    t_pass := t_pass || ((t at time zone 'Asia/Kolkata')::date = today_ist + 5 and (r->'released'->0->>'days')::int = 5);

    -- ════ D. release ════
    r := pg_temp.release_days(adm, array[a1], '10'::jsonb);
    select * into am from public.application_manager where application_id = a1;
    t_name := t_name || text 'D release with 10 days: Offer sent, deadline today + 10';
    t_det := t_det || format('%s stage=%s exp=%s days=%s', r, pg_temp.stage(a1), pg_temp.ist_day(am.offer_expires_at), am.offer_pay_timeline_days);
    t_pass := t_pass || (pg_temp.stage(a1) = 'offer_sent:active' and (am.offer_expires_at at time zone 'Asia/Kolkata')::date = today_ist + 10
                         and pg_temp.ist_day(am.offer_expires_at) like '% 23:59:59' and am.offer_pay_timeline_days = 10
                         and (r->'released'->0->>'days')::int = 10 and (r->'released'->0->>'expires_at')::timestamptz = am.offer_expires_at);
    t_name := t_name || text 'D the override is cleared once used';
    t_det := t_det || coalesce(am.offer_days_override::text, 'null'); t_pass := t_pass || (am.offer_days_override is null);
    t_name := t_name || text 'D the release event and counselling row carry the same deadline';
    t_det := t_det || coalesce((select expires_at::text from public.vsat_offer_events where application_id = a1 and kind = 'released'), '∅');
    t_pass := t_pass || ((select expires_at from public.vsat_offer_events where application_id = a1 and kind = 'released') = am.offer_expires_at
                         and not exists (select 1 from public.counselling_assignments c where c.application_id = a1
                                           and c.offer_expiry_date is distinct from am.offer_expires_at));

    r := pg_temp.release_days(adm, array[a2], 'null'::jsonb);
    select * into am from public.application_manager where application_id = a2;
    t_name := t_name || text 'D release without days keeps the campus default (5)';
    t_det := t_det || format('exp=%s days=%s', pg_temp.ist_day(am.offer_expires_at), am.offer_pay_timeline_days);
    t_pass := t_pass || ((am.offer_expires_at at time zone 'Asia/Kolkata')::date = today_ist + 5 and am.offer_pay_timeline_days = 5
                         and am.offer_days_override is null);

    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_offers_release', jsonb_build_object('application_ids', jsonb_build_array(a3))));
    select * into am from public.application_manager where application_id = a3;
    t_name := t_name || text 'D old callers (no offer_days key) still work, campus default';
    t_det := t_det || format('%s days=%s', r, am.offer_pay_timeline_days);
    t_pass := t_pass || (pg_temp.stage(a3) = 'offer_sent:active' and am.offer_pay_timeline_days = 5);

    r := pg_temp.release_days(adm, array[a4, a5, s1], '1'::jsonb);
    t_name := t_name || text 'D bulk with 1 day: both released for today + 1, the wrong-stage one skipped';
    t_det := t_det || r::text;
    t_pass := t_pass || (jsonb_array_length(r->'released') = 2 and pg_temp.skip_code(r, s1) = 'WRONG_STAGE'
                         and (select bool_and((offer_expires_at at time zone 'Asia/Kolkata')::date = today_ist + 1 and offer_pay_timeline_days = 1)
                                from public.application_manager where application_id in (a4, a5)));
    t_name := t_name || text 'D no override is left on anyone (released or skipped)';
    select count(*) into n from public.application_manager where application_id in (a1, a2, a3, a4, a5, a6, s1) and offer_days_override is not null;
    t_det := t_det || n::text; t_pass := t_pass || (n = 0);

    -- ════ E. re-open after a lapse uses the campus default, not the old days ════
    update public.application_manager set offer_expires_at = now() - interval '1 minute' where application_id = a1;
    perform public.vsat__move(a1, 'counselled', 'active', 'zz lapse', 'system', null, null);
    r := pg_temp.move(adm, a1, 'offer_sent', 'zz re-open');
    select * into am from public.application_manager where application_id = a1;
    t_name := t_name || text 'E re-open via Move stage → campus default (5), not the earlier 10';
    t_det := t_det || format('%s stage=%s days=%s', r, pg_temp.stage(a1), am.offer_pay_timeline_days);
    t_pass := t_pass || (pg_temp.stage(a1) = 'offer_sent:active' and am.offer_pay_timeline_days = 5
                         and (am.offer_expires_at at time zone 'Asia/Kolkata')::date = today_ist + 5);

    -- ════ F. bad input ════
    s := '';
    foreach bad in array array['0'::jsonb, '91'::jsonb, '2.5'::jsonb, '"7"'::jsonb, 'true'::jsonb, '-3'::jsonb] loop
      r := pg_temp.release_days(adm, array[a6], bad);
      if coalesce(r->>'message', '') not like 'BAD_VALUE: offer_days%' then s := s || bad::text || '→' || r::text || '; '; end if;
    end loop;
    t_name := t_name || text 'F 0, 91, 2.5, "7", true, -3 are refused (BAD_VALUE)';
    t_det := t_det || coalesce(nullif(s, ''), 'ok'); t_pass := t_pass || (s = '');
    t_name := t_name || text 'F a refused call changes nothing';
    select * into am from public.application_manager where application_id = a6;
    t_det := t_det || format('stage=%s override=%s', pg_temp.stage(a6), am.offer_days_override);
    t_pass := t_pass || (pg_temp.stage(a6) = 'counselled:active' and am.offer_days_override is null and am.offer_released_at is null);
    r := pg_temp.release_days(adm, array[a6], '90'::jsonb, true);
    t_name := t_name || text 'F 90 days is allowed (upper edge)'; t_det := t_det || r::text;
    t_pass := t_pass || ((r->'released'->0->>'days')::int = 90);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_offers_release', jsonb_build_object('application_ids', jsonb_build_array(a6), 'days', 7)));
    t_name := t_name || text 'F unknown keys are still refused'; t_det := t_det || r::text;
    t_pass := t_pass || (r ? 'sqlstate' and pg_temp.stage(a6) = 'counselled:active');

    -- ════ G. who can do it ════
    r := pg_temp.release_days(nobody, array[a6], '10'::jsonb);
    t_name := t_name || text 'G a signed-in non-admin is refused'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'message' = 'FORBIDDEN' and pg_temp.stage(a6) = 'counselled:active'
                         and (select offer_days_override from public.application_manager where application_id = a6) is null);
    r := pg_temp.call_as(null, pg_temp.rpc('vsat_offers_release', jsonb_build_object('application_ids', jsonb_build_array(a6), 'offer_days', 10)), 'anon');
    t_name := t_name || text 'G anon cannot call it'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'sqlstate' = '42501');
    t_name := t_name || text 'G grants unchanged: release RPC signed-in only; helpers server only; all definer + empty search_path';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat_offers_release', 'vsat__offer_deadline', 'vsat__offer_release')
       and not (p.prosecdef and p.proconfig = array['search_path=""'] and not has_function_privilege('anon', p.oid, 'execute')
                and has_function_privilege('service_role', p.oid, 'execute')
                and has_function_privilege('authenticated', p.oid, 'execute') = (p.proname = 'vsat_offers_release'));
    t_det := t_det || coalesce(s, 'ok'); t_pass := t_pass || (s is null);

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_vsat_offer_days_tests();
