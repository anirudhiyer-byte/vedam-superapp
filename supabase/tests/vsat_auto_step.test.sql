-- VSAT pipeline · scholarship step from the formula only (migration 0083, STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the
-- Supabase MCP. The last statement returns one row per test: test | pass | detail.
--
-- A. vsat_calc_auto_step against sheet column BK ("Scholarship as Per Weightage"): 44 rows from
--    VSAT-14 (Pune, GGN) and VSAT-12 (Pune) where BK, the score and the category are all formula
--    cells, each with its own sheet's bucket table. Two VSAT-14 GGN rows are left out: their saved
--    values were calculated with an older GGN bucket table (the formula on today's table gives
--    40 and 25, the saved cells say 25 and 10).
-- B. edge cases. C. counselling saves the formula step and %, nothing typed. D. access.
--
-- Nothing is left behind: test data is created inside a block that is rolled back with a private
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

-- applicant at "vsat_cleared", Pune, VSAT p_marks/50 (25 → 50% → category 6, steps 30/35; 40 → 80% → category 5, steps 35/45)
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

create or replace function pg_temp.run_vsat_auto_step_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  adm uuid; int1 uuid; cou1 uuid; d uuid; b1 text; r jsonb; pre jsonb; s text; n int;
begin
  -- ── A. sheet BK fixtures ──
  select count(*), string_agg(format('%s→%s (sheet %s)', f.score, public.vsat_calc_auto_step(f.score, f.min_s, f.max_s, f.buckets, f.min_a, f.max_a), f.expect), '; ')
         filter (where public.vsat_calc_auto_step(f.score, f.min_s, f.max_s, f.buckets, f.min_a, f.max_a) is distinct from f.expect)
    into n, s
    from (values
      (34.634, 0.0, 65.0, 4, 5.0, 20.0, 15.0),
      (45.69, 0.0, 65.0, 5, 5.0, 25.0, 20.0),
      (53.816, 0.0, 65.0, 4, 5.0, 20.0, 20.0),
      (54.25, 0.0, 65.0, 4, 5.0, 20.0, 20.0),
      (54.43, 0.0, 65.0, 4, 5.0, 20.0, 20.0),
      (54.843, 0.0, 65.0, 4, 5.0, 20.0, 20.0),
      (57.876, 0.0, 65.0, 4, 5.0, 20.0, 20.0),
      (58.5, 0.0, 65.0, 4, 5.0, 20.0, 20.0),
      (58.55, 0.0, 65.0, 4, 5.0, 20.0, 20.0),
      (58.934, 0.0, 65.0, 4, 5.0, 20.0, 20.0),
      (59.066, 0.0, 65.0, 4, 5.0, 20.0, 20.0),
      (59.56, 0.0, 65.0, 5, 5.0, 25.0, 25.0),
      (60.499, 0.0, 65.0, 5, 5.0, 25.0, 25.0),
      (61.8, 0.0, 65.0, 5, 5.0, 25.0, 25.0),
      (62.61, 0.0, 65.0, 2, 5.0, 10.0, 10.0),
      (63.115, 0.0, 65.0, 2, 5.0, 10.0, 10.0),
      (64.55, 0.0, 65.0, 4, 5.0, 20.0, 20.0),
      (65.0, 65.0, 70.0, 4, 25.0, 40.0, 25.0),
      (66.05, 65.0, 70.0, 4, 25.0, 40.0, 25.0),
      (66.275, 65.0, 70.0, 3, 15.0, 25.0, 15.0),
      (66.45, 65.0, 70.0, 4, 25.0, 40.0, 30.0),
      (67.33, 65.0, 70.0, 3, 15.0, 25.0, 20.0),
      (67.4, 65.0, 70.0, 4, 25.0, 40.0, 30.0),
      (67.86, 65.0, 70.0, 3, 30.0, 40.0, 35.0),
      (68.02794, 65.0, 70.0, 3, 15.0, 25.0, 20.0),
      (68.7, 65.0, 70.0, 4, 25.0, 40.0, 35.0),
      (69.04, 65.0, 70.0, 4, 25.0, 40.0, 40.0),
      (69.5985, 65.0, 70.0, 4, 25.0, 40.0, 40.0),
      (70.226, 70.0, 75.0, 2, 45.0, 50.0, 45.0),
      (71.02, 70.0, 75.0, 2, 45.0, 50.0, 45.0),
      (71.25, 70.0, 75.0, 2, 45.0, 50.0, 45.0),
      (71.5, 70.0, 75.0, 2, 30.0, 35.0, 30.0),
      (71.79, 70.0, 75.0, 2, 30.0, 35.0, 30.0),
      (72.31, 70.0, 75.0, 2, 30.0, 35.0, 30.0),
      (73.16, 70.0, 75.0, 2, 45.0, 50.0, 50.0),
      (76.0425, 75.0, 80.0, 2, 55.0, 60.0, 55.0),
      (76.6925, 75.0, 80.0, 2, 55.0, 60.0, 55.0),
      (78.75, 75.0, 80.0, 2, 55.0, 60.0, 60.0),
      (79.48, 75.0, 80.0, 2, 55.0, 60.0, 60.0),
      (80.0, 80.0, 85.0, 2, 65.0, 70.0, 65.0),
      (80.75, 80.0, 85.0, 2, 65.0, 70.0, 65.0),
      (81.75, 80.0, 85.0, 2, 65.0, 70.0, 65.0),
      (82.95, 80.0, 85.0, 2, 50.0, 55.0, 55.0),
      (86.746, 85.0, 90.0, 3, 50.0, 70.0, 60.0)
    ) f(score, min_s, max_s, buckets, min_a, max_a, expect);
  t_name := t_name || text 'A 44 sheet rows: formula step = sheet BK'; t_det := t_det || (n || ' rows; mismatches: ' || coalesce(s, 'none'));
  t_pass := t_pass || (n = 44 and s is null);

  -- ── B. edge cases ──
  t_name := t_name || text 'B score below the band → 0; one bucket → min award; top of band → max award';
  s := format('%s|%s|%s|%s', public.vsat_calc_auto_step(64.99, 65, 70, 3, 15, 25), public.vsat_calc_auto_step(72, 70, 75, 1, 30, 35),
              public.vsat_calc_auto_step(70, 65, 70, 3, 15, 25), public.vsat_calc_auto_step(100, 95, 100, 3, 90, 100));
  t_det := t_det || s; t_pass := t_pass || (s = '0|30|25|100');
  t_name := t_name || text 'B bucket edges: 66.6667 → 2nd step, 68.3333 → 3rd step (65–70, 3 buckets)';
  s := format('%s|%s|%s', public.vsat_calc_auto_step(66.66, 65, 70, 3, 15, 25), public.vsat_calc_auto_step(66.6667, 65, 70, 3, 15, 25),
              public.vsat_calc_auto_step(68.3334, 65, 70, 3, 15, 25));
  t_det := t_det || s; t_pass := t_pass || (s = '15|20|25');
  t_name := t_name || text 'B empty or broken band → null';
  t_det := t_det || coalesce(public.vsat_calc_auto_step(null, 65, 70, 3, 15, 25)::text, 'null');
  t_pass := t_pass || (public.vsat_calc_auto_step(null, 65, 70, 3, 15, 25) is null and public.vsat_calc_auto_step(66, 70, 65, 3, 15, 25) is null
                       and public.vsat_calc_auto_step(66, 65, 70, 0, 15, 25) is null);
  r := public.vsat_calc_scholarship('{"vsat_pct":80,"class10_pct":90,"class12_pct":80,"interview_score":3,"cs_passion":2,"class10_maths_pct":85,"class12_maths_pct":70}', 'pune', null);
  t_name := t_name || text 'B vsat_calc_scholarship returns auto_step, one of the category steps'; t_det := t_det || r::text;
  t_pass := t_pass || (r ? 'auto_step' and r->'award_steps' @> jsonb_build_array(r->'auto_step'));

  begin -- rolled back at the end (ZDONE)
    adm  := pg_temp.mk_user('zztest-aut-adm@example.invalid');
    int1 := pg_temp.mk_user('zztest-aut-int1@example.invalid');
    cou1 := pg_temp.mk_user('zztest-aut-cou1@example.invalid');
    insert into public.vsat_team (user_id, role) values (adm, 'admissions'), (int1, 'interviewer'), (cou1, 'counsellor');
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at)
    values ('ZZTEST auto step batch', 'zz-aut', current_date, now(), now() + interval '2 hours') returning id into d;
    b1 := pg_temp.mk_app('ZZT-AUT-1', d, 25);
    r := pg_temp.to_counselling(b1, 4, 1, adm, int1, cou1);
    t_name := t_name || text 'setup: student reaches counselling_scheduled'; t_det := t_det || left(r::text, 150);
    t_pass := t_pass || (r->'pipeline'->>'stage' = 'counselling_scheduled');

    -- ── C. counselling: formula only ──
    pre := pg_temp.call_as(cou1, format('select public.vsat_scholarship_preview(%L)', b1));
    t_name := t_name || text 'C preview shows auto_step = the BK formula on this score and band'; t_det := t_det || left(pre::text, 250);
    t_pass := t_pass || ((pre->>'auto_step')::numeric = (select public.vsat_calc_auto_step((pre->>'score')::numeric, sb.min_score, sb.max_score, sb.steps, sb.min_award, sb.max_award)
                           from public.vsat_scholarship_bands sb where sb.campus = 'pune' and sb.exam_date_id is null and sb.category = (pre->>'category')::int));
    r := pg_temp.call_as(cou1, pg_temp.rpc('vsat_submit_counselling', jsonb_build_object('application_id', b1, 'chosen_step', pre->'award_steps'->-1)));
    t_name := t_name || text 'C sending chosen_step is refused (UNKNOWN_KEY)'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'message' like 'UNKNOWN_KEY%');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_submit_counselling', jsonb_build_object('application_id', b1, 'actual_pct', 90, 'actual_reason', 'special case')));
    t_name := t_name || text 'C sending actual_pct / actual_reason is refused, admissions too'; t_det := t_det || r::text;
    t_pass := t_pass || (r->>'message' like 'UNKNOWN_KEY%');
    r := pg_temp.call_as(cou1, pg_temp.rpc('vsat_submit_counselling', jsonb_build_object('application_id', b1, 'remarks', 'zz ok')));
    t_name := t_name || text 'C submit with only remarks → step = auto_step, % = calculated, counselled'; t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'step')::numeric = (pre->>'auto_step')::numeric and (r->>'actual_pct')::numeric = (r->>'calculated_pct')::numeric
                         and r->>'stage' = 'counselled');
    t_name := t_name || text 'C saved: chosen_step = auto, actual = calculated, no reason; history move has no reason';
    select format('%s|%s|%s', ca.chosen_step = (pre->>'auto_step')::numeric, ca.actual_pct = ca.calculated_pct, ca.actual_reason is null)
      into s from public.counselling_assignments ca where ca.application_id = b1;
    t_det := t_det || s;
    t_pass := t_pass || (s = 't|t|t' and exists (select 1 from public.vsat_stage_history h where h.application_id = b1 and h.to_stage = 'counselled' and h.reason is null));

    -- ── D. access ──
    t_name := t_name || text 'D vsat_calc_auto_step is private (no authenticated / anon)';
    t_det := t_det || format('%s/%s', has_function_privilege('authenticated', 'public.vsat_calc_auto_step(numeric,numeric,numeric,int,numeric,numeric)', 'execute'),
                                       has_function_privilege('anon', 'public.vsat_calc_auto_step(numeric,numeric,numeric,int,numeric,numeric)', 'execute'));
    t_pass := t_pass || (not has_function_privilege('authenticated', 'public.vsat_calc_auto_step(numeric,numeric,numeric,int,numeric,numeric)', 'execute')
                         and not has_function_privilege('anon', 'public.vsat_calc_auto_step(numeric,numeric,numeric,int,numeric,numeric)', 'execute'));
    t_name := t_name || text 'D submit_counselling: authenticated only, SECURITY DEFINER, empty search_path';
    select format('%s:%s:%s:%s', has_function_privilege('authenticated', p.oid, 'execute'), has_function_privilege('anon', p.oid, 'execute'), p.prosecdef, p.proconfig)
      into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = 'vsat_submit_counselling';
    t_det := t_det || s; t_pass := t_pass || (s = 't:f:t:{"search_path=\"\""}');

    raise exception 'done' using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;
  return query select * from unnest(t_name, t_pass, t_det);
end $$;

select * from pg_temp.run_vsat_auto_step_tests();
