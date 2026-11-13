-- VSAT pipeline · +10% bonus from the interview achievements score (migration 0082, STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the
-- Supabase MCP. The last statement returns one row per test: test | pass | detail.
-- 0083: no chosen_step any more, the step is the formula's. The formula itself (5 and ≤30% → +10, max 100) is tested in vsat_pipeline_scoring.test.sql;
-- this file checks where the rating comes from and that nobody can type it in.
--
-- Nothing is left behind: all test data is created inside a block that is rolled back with a
-- private error code at the end. Fake data only (@example.invalid, ZZTEST names).

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

-- applicant at "vsat_cleared", Pune, VSAT p_marks/50 (since 0083 the step comes from the formula:
-- 21 → 42% → score ~70.9, category 6, step 30; 40 → 80% → score ~78.6, category 5, step 45)
create or replace function pg_temp.mk_app(p_id text, p_date uuid, p_marks numeric)
returns text language plpgsql as $$
declare u uuid := pg_temp.mk_user(lower(p_id) || '@example.invalid');
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, lead_stage) values (u, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', 'applicant_paid')
  on conflict (lead_id) do nothing;
  insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email, campus_applied, exam_date_id,
    class10_year, class10_percentage, class10_maths_percentage, class12_year, class12_percentage, class12_maths_percentage,
    marks_physics_12, marks_chemistry_12, marks_maths_12, jee_registered, entrance_percentile, jee_main_maths_percentile,
    exam_percentile, exam_obtained_marks, exam_max_marks, vps_score)
  values (p_id, u, p_id, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', 'Ajeenkya DY Patil University — Pune', p_date,
    2024, 90, 85, 2026, 80, 70, 70, 70, 70, false, null, null, 80, p_marks, 50, 8.43);
  update public.application_manager set exam_given = true where application_id = p_id;
  perform public.vsat__move(p_id, 'vsat_cleared', 'active', 'zz test', 'system', null, null);
  return p_id;
end $$;

create or replace function pg_temp.call_as(p_uid uuid, p_sql text, p_anon boolean default false)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  if p_anon then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    set local role anon;
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

-- interview (given achievements score) → pi_cleared → counselling_scheduled
create or replace function pg_temp.to_counselling(p_app text, p_ach int, p_n int, p_adm uuid, p_int uuid, p_cou uuid)
returns jsonb language plpgsql as $$
declare r jsonb; slot text := to_char(now() + make_interval(days => 10 + p_n), 'YYYY-MM-DD"T"HH24:00:00"Z"');
begin
  r := pg_temp.call_as(p_adm, pg_temp.rpc('vsat_assign_interview', jsonb_build_object('application_id', p_app, 'interviewer_id', p_int, 'slot_datetime', slot)));
  r := pg_temp.call_as(p_int, pg_temp.rpc('vsat_submit_interview', jsonb_build_object('application_id', p_app, 'communication', 4, 'logic', 4,
         'passion', 3, 'achievements', p_ach, 'why_program', 4, 'cheating_seen', false, 'interviewer_verdict', 'selected')));
  if r->>'stage' is distinct from 'pi_cleared' then return r; end if;
  return pg_temp.call_as(p_adm, pg_temp.rpc('vsat_assign_counsellor', jsonb_build_object('application_id', p_app, 'counsellor_id', p_cou, 'slot_datetime', slot)));
end $$;

create or replace function pg_temp.run_vsat_bonus_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; int1 uuid; cou1 uuid; d uuid; b1 text; b2 text; b3 text; b4 text;
  r jsonb; pre jsonb; step numeric; m numeric; s text;
begin
  begin -- rolled back at the end (ZDONE)
    adm  := pg_temp.mk_user('zztest-bon-adm@example.invalid');
    int1 := pg_temp.mk_user('zztest-bon-int1@example.invalid');
    cou1 := pg_temp.mk_user('zztest-bon-cou1@example.invalid');
    insert into public.vsat_team (user_id, role) values (adm, 'admissions'), (int1, 'interviewer'), (cou1, 'counsellor');
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at)
    values ('ZZTEST bonus batch', 'zz-bon', current_date, now(), now() + interval '2 hours') returning id into d;
    b1 := pg_temp.mk_app('ZZT-BON-1', d, 21);
    b2 := pg_temp.mk_app('ZZT-BON-2', d, 21);
    b3 := pg_temp.mk_app('ZZT-BON-3', d, 21);
    b4 := pg_temp.mk_app('ZZT-BON-4', d, 40);

    r := pg_temp.to_counselling(b1, 5, 1, adm, int1, cou1);
    t_name := t_name || text 'setup: achievements 5 student reaches counselling_scheduled'; t_det := t_det || left(r::text, 150);
    t_pass := t_pass || (r->'pipeline'->>'stage' = 'counselling_scheduled');
    r := pg_temp.to_counselling(b2, 4, 2, adm, int1, cou1);
    t_name := t_name || text 'setup: achievements 4 student reaches counselling_scheduled'; t_det := t_det || left(r::text, 150);
    t_pass := t_pass || (r->'pipeline'->>'stage' = 'counselling_scheduled');
    r := pg_temp.to_counselling(b3, 5, 3, adm, int1, cou1);
    t_name := t_name || text 'setup: third student reaches counselling_scheduled'; t_det := t_det || left(r::text, 150);
    t_pass := t_pass || (r->'pipeline'->>'stage' = 'counselling_scheduled');
    r := pg_temp.to_counselling(b4, 5, 4, adm, int1, cou1);
    t_name := t_name || text 'setup: achievements 5, high marks student reaches counselling_scheduled'; t_det := t_det || left(r::text, 150);
    t_pass := t_pass || (r->'pipeline'->>'stage' = 'counselling_scheduled');

    -- ── A. preview shows the rating from the interview ──
    pre := pg_temp.call_as(cou1, format('select public.vsat_scholarship_preview(%L)', b1));
    t_name := t_name || text 'A preview: special_rating = interview achievements (5)'; t_det := t_det || left(pre::text, 200);
    t_pass := t_pass || ((pre->>'special_rating')::int = 5 and (pre->>'auto_step')::numeric = 30 and not (pre->>'jee_floor_enabled')::boolean);
    r := pg_temp.call_as(cou1, format('select public.vsat_scholarship_preview(%L)', b2));
    t_name := t_name || text 'A preview: achievements 4 → special_rating 4'; t_det := t_det || coalesce(r->>'special_rating', 'null');
    t_pass := t_pass || ((r->>'special_rating')::int = 4);

    -- ── B. nobody can type the rating in ──
    step := 30;
    r := pg_temp.call_as(cou1, pg_temp.rpc('vsat_submit_counselling', jsonb_build_object('application_id', b2, 'special_rating', 5)));
    t_name := t_name || text 'B counsellor sending special_rating is refused (UNKNOWN_KEY)'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'message' like 'UNKNOWN_KEY%');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_submit_counselling', jsonb_build_object('application_id', b2, 'special_rating', 5)));
    t_name := t_name || text 'B admissions sending special_rating is refused too'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'message' like 'UNKNOWN_KEY%');
    t_name := t_name || text 'B refused calls saved nothing (still counselling_scheduled)';
    select vp.stage into s from public.vsat_pipeline vp where vp.application_id = b2; t_det := t_det || s;
    t_pass := t_pass || (s = 'counselling_scheduled');

    -- ── C. bonus applied from the interview ──
    m := step;  -- JEE floor is off for Pune (checked in A)
    r := pg_temp.call_as(cou1, pg_temp.rpc('vsat_submit_counselling', jsonb_build_object('application_id', b1)));
    t_name := t_name || text 'C achievements 5, step 30 → 40% and bonus_applied'; t_det := t_det || (r::text || ' step=' || step || ' m=' || m);
    t_pass := t_pass || ((r->>'calculated_pct')::numeric = 40 and (r->>'bonus_applied')::boolean
                         and (r->>'special_rating')::int = 5 and r->>'stage' = 'counselled');
    t_name := t_name || text 'C saved: counselling special_rating 5, bonus true, % on the application';
    select format('%s|%s|%s', ca.special_rating, ca.bonus_applied, am.scholarship_percentage = ca.calculated_pct)
      into s from public.counselling_assignments ca join public.application_manager am using (application_id) where ca.application_id = b1;
    t_det := t_det || s; t_pass := t_pass || (s = '5|t|t');

    r := pg_temp.call_as(cou1, pg_temp.rpc('vsat_submit_counselling', jsonb_build_object('application_id', b2)));
    t_name := t_name || text 'C achievements 4 → no bonus'; t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'calculated_pct')::numeric = 30 and not (r->>'bonus_applied')::boolean and (r->>'special_rating')::int = 4);
    r := pg_temp.call_as(cou1, pg_temp.rpc('vsat_submit_counselling', jsonb_build_object('application_id', b4)));
    t_name := t_name || text 'C achievements 5 but award 45% (above 30%) → no bonus'; t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'calculated_pct')::numeric = 45 and not (r->>'bonus_applied')::boolean and (r->>'special_rating')::int = 5);

    -- ── D. no usable interview score → no bonus ──
    update public.interview_assignments a set rubric_achievements = 4.5 where a.application_id = b3;
    r := pg_temp.call_as(cou1, format('select public.vsat_scholarship_preview(%L)', b3));
    t_name := t_name || text 'D a non-whole score (4.5, old data) → special_rating null'; t_det := t_det || r::text;
    t_pass := t_pass || (r ? 'special_rating' and r->'special_rating' = 'null'::jsonb);
    update public.interview_assignments a set rubric_achievements = null where a.application_id = b3;
    r := pg_temp.call_as(cou1, pg_temp.rpc('vsat_submit_counselling', jsonb_build_object('application_id', b3)));
    t_name := t_name || text 'D no achievements score → no bonus, still counselled'; t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'calculated_pct')::numeric = 30 and not (r->>'bonus_applied')::boolean and r->'special_rating' = 'null'::jsonb
                         and r->>'stage' = 'counselled');

    -- ── E. access unchanged ──
    t_name := t_name || text 'E grants unchanged: authenticated yes, anon / public no';
    select string_agg(format('%s:%s:%s', p.proname, has_function_privilege('authenticated', p.oid, 'execute'), has_function_privilege('anon', p.oid, 'execute')), ' ' order by p.proname)
      into s from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('vsat_scholarship_preview', 'vsat_submit_counselling');
    t_det := t_det || s; t_pass := t_pass || (s = 'vsat_scholarship_preview:t:f vsat_submit_counselling:t:f');
    t_name := t_name || text 'E both functions: SECURITY DEFINER, search_path empty';
    select string_agg(format('%s:%s:%s', p.proname, p.prosecdef, p.proconfig), ' ' order by p.proname)
      into s from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('vsat_scholarship_preview', 'vsat_submit_counselling');
    t_det := t_det || s; t_pass := t_pass || (s = 'vsat_scholarship_preview:t:{"search_path=\"\""} vsat_submit_counselling:t:{"search_path=\"\""}');

    raise exception 'done' using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;
  return query select * from unnest(t_name, t_pass, t_det);
end $$;

select * from pg_temp.run_vsat_bonus_tests();
