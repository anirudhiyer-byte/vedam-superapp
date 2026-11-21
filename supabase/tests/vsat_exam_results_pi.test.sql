-- VSAT Phase 1 · exam results, VPS from the curve, proctoring, analysis, Select for PI — tests for migration 0135 (STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the Supabase MCP.
-- The last statement returns one row per test: test | pass | detail.
--
-- Nothing is left behind: all test data is created inside a block that is rolled back with a private
-- error code at the end. Fake people only (@example.invalid, ZZTEST names).
--
-- Parity fixture = NUMBERS ONLY from "VSAT-14 Mastersheet'26 · Test Result" (no names, emails or IDs):
-- 32 takers as [percentage, percentile, gender, campus P/G, disqualified]. The sheet's own analysis box says:
--   average % 75.84 · percentile > 70: 24 · non-DQ slabs 0–20: 0, 20–40: 4, 40–60: 1, 60–80: 8, 80+: 18 ·
--   non-DQ male 24 / female 7 · ≥ 35 & non-DQ: male 21 / female 6 (Pune 12 / 4, Gurugram 9 / 2) — the 27
--   students on its "Selected For PI" tab · ≥ 65 & non-DQ: male 20 / female 6 (Pune 11 / 4, Gurugram 9 / 2).
-- VSAT-14 curve: 0 → 0, 65 → 7.4, 100 → 9.8.

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

-- an applicant at "exam_taken" with a Wheebox-style result (marks out of 200, percentile) and NO stored vps_score
create or replace function pg_temp.mk_app(p_id text, p_campus text, p_date uuid, p_gender text, p_pct numeric, p_pctl numeric)
returns text language plpgsql as $$
declare u uuid := pg_temp.mk_user(lower(p_id) || '@example.invalid');
begin
  insert into public.lead_manager (lead_id, registered_name, registered_email, lead_stage) values (u, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', 'applicant_paid')
  on conflict (lead_id) do nothing;
  insert into public.application_manager (application_id, lead_id, application_no, registered_name, registered_email, registered_mobile, campus_applied, exam_date_id,
    gender, class10_year, class10_percentage, class12_year, class12_percentage, marks_physics_12, marks_chemistry_12, marks_maths_12,
    exam_percentile, exam_obtained_marks, exam_max_marks, vps_score)
  values (p_id, u, p_id, 'ZZTEST ' || p_id, lower(p_id) || '@example.invalid', '9000000000', p_campus, p_date,
    p_gender, 2024, 90, 2026, 80, 70, 70, 70, p_pctl, p_pct * 2, 200, null);
  perform public.vsat__move(p_id, 'exam_taken', 'active', 'zz test', 'system', null, null);
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

create or replace function pg_temp.run_vsat_exam_results_pi_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  fx jsonb := '[[65.0,65.0,"M","G",false],[92.5,92.0,"M","P",false],[73.0,73.0,"F","G",false],[77.5,78.0,"M","P",true],[26.5,26.0,"M","P",false],[81.5,82.0,"M","P",false],[92.5,92.0,"M","P",false],[74.0,74.0,"M","G",false],[80.0,80.0,"M","P",false],[88.5,88.0,"M","P",false],[30.0,30.0,"M","P",false],[95.0,95.0,"F","G",false],[80.0,80.0,"F","P",false],[87.5,88.0,"M","P",false],[75.0,75.0,"M","G",false],[82.0,82.0,"F","P",false],[91.0,91.0,"M","P",false],[80.0,80.0,"F","P",false],[82.5,82.0,"M","P",false],[69.5,70.0,"M","P",false],[95.0,95.0,"M","G",false],[97.5,98.0,"M","G",false],[95.0,95.0,"M","P",false],[67.5,68.0,"M","G",false],[95.5,96.0,"M","G",false],[77.5,78.0,"M","P",false],[92.5,92.0,"M","G",false],[33.0,33.0,"F","P",false],[85.0,85.0,"F","P",false],[77.5,78.0,"M","G",false],[56.5,56.0,"M","P",false],[31.0,31.0,"M","G",false]]';
  curve jsonb := '[{"percentile":0,"vps":0},{"percentile":65,"vps":7.4},{"percentile":100,"vps":9.8}]';
  old_rules jsonb := '{"min_year10": 2023, "class12_years": [2025, 2026], "pending_year": 2026, "pcm_min_total": 150}';
  new_rules jsonb := '{"min_year10": 2024, "max_year10": 2025, "class12_years": [2026, 2027], "pending_year": 2027, "pcm_min_total": 150, "pcm_min_each": 50, "class12_min_overall": 50}';
  adm uuid; adm_pune uuid; int1 uuid; d1 uuid; d2 uuid; x jsonb; i int := 0; ids text[] := '{}'; dq_id text; g_id text; p_id text;
  r jsonb; r2 jsonb; s text; n int; ok boolean; cols jsonb; set_rules jsonb;
begin
  begin -- rolled back at the end (ZDONE)
    adm := pg_temp.mk_user('zztest-pi-admin@example.invalid');
    insert into public.user_roles (user_id, role) values (adm, 'admin');
    adm_pune := pg_temp.mk_user('zztest-pi-adm-pune@example.invalid');
    int1 := pg_temp.mk_user('zztest-pi-int1@example.invalid');
    insert into public.vsat_team (user_id, role, campus) values (adm_pune, 'admissions', 'pune'), (int1, 'interviewer', null);
    -- d1 = the VSAT-14 copy (own curve) · d2 = a VSAT with no curve of its own (uses the Exam Center default)
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at, vps_anchors)
    values ('ZZTEST VSAT-PI', 'zz-pi-1', current_date, now(), now() + interval '2 hours', curve) returning id into d1;
    insert into public.vsat_exam_dates (label, wheebox_test_id, exam_date, start_at, end_at)
    values ('ZZTEST VSAT-PI2', 'zz-pi-2', current_date + 7, now() + interval '7 days', now() + interval '7 days 2 hours') returning id into d2;
    for x in select * from jsonb_array_elements(fx) loop
      i := i + 1;
      s := pg_temp.mk_app(format('PIX%s', lpad(i::text, 2, '0')),
                          case x->>3 when 'P' then 'Ajeenkya DY Patil University — Pune' else 'Sushant University — Gurugram' end, d1,
                          case x->>2 when 'M' then 'Male' else 'Female' end, (x->>0)::numeric, (x->>1)::numeric);
      ids := ids || s;
      if (x->>4)::boolean then dq_id := s; end if;
    end loop;
    g_id := 'PIX01';  -- Gurugram, male, percentile 65, percentage 65
    p_id := 'PIX02';  -- Pune, male, percentile 92
    update public.application_manager set exam_sections = '{"Maths VSAT": 40, "Logical and Aptitude": "35.5", "CS": {"markObtainInSection": "12"}}'
     where application_id = g_id;
    select s2.eligibility into set_rules from public.vsat_exam_settings s2 order by s2.id limit 1;

    -- ════ A. eligibility ════
    ok := true; s := '';
    for x in select * from jsonb_array_elements('[[2023,2025,81,86,80],[2024,2026,53,48,26],[2024,2026,0,0,0],[2023,2025,59,49,49],[2022,2026,60,60,60],[2024,2027,0,0,0],[2025,2027,50,50,50],[null,2026,70,70,70]]'::jsonb) loop
      if public.vsat_calc_eligibility((x->>0)::int, (x->>1)::int, (x->>2)::numeric, (x->>3)::numeric, (x->>4)::numeric, old_rules)
         is distinct from public.vsat_calc_eligibility((x->>0)::int, (x->>1)::int, (x->>2)::numeric, (x->>3)::numeric, (x->>4)::numeric, null::numeric, old_rules)
         or public.vsat_calc_eligibility((x->>0)::int, (x->>1)::int, (x->>2)::numeric, (x->>3)::numeric, (x->>4)::numeric, new_rules)
         is distinct from public.vsat_calc_eligibility((x->>0)::int, (x->>1)::int, (x->>2)::numeric, (x->>3)::numeric, (x->>4)::numeric, null::numeric, new_rules) then
        ok := false; s := s || x::text || ' ';
      end if;
    end loop;
    t_name := t_name || text 'A the old 6-argument eligibility answers exactly like the new one with no 12th %'; t_pass := t_pass || ok; t_det := t_det || coalesce(nullif(s, ''), 'same');
    r := public.vsat_calc_eligibility(2024, 2026, 70, 70, 70, 45, new_rules);
    r2 := public.vsat_calc_eligibility(2024, 2026, 70, 70, 70, 50, new_rules);
    t_name := t_name || text 'A 12th overall 45% → fail, not eligible; exactly 50% → pass, eligible';
    t_pass := t_pass || (r->>'class12' = 'fail' and not (r->>'eligible')::boolean and r2->>'class12' = 'pass' and (r2->>'eligible')::boolean);
    t_det := t_det || (r::text || ' | ' || r2::text);
    r := public.vsat_calc_eligibility(2024, 2026, 70, 70, 70, null, new_rules);
    r2 := public.vsat_calc_eligibility(2024, 2027, 0, 0, 0, null, new_rules);
    t_name := t_name || text 'A unknown 12th % is not held against the student; pending 12th (2027, no marks) → yet to graduate, eligible';
    t_pass := t_pass || ((r->>'eligible')::boolean and r2->>'class12' = 'yet_to_graduate' and (r2->>'eligible')::boolean);
    t_det := t_det || (r::text || ' | ' || r2::text);
    t_name := t_name || text 'A settings now say 10th 2024–2025 and 12th overall ≥ 50 (rest unchanged)';
    t_pass := t_pass || ((set_rules->>'min_year10')::int = 2024 and (set_rules->>'max_year10')::int = 2025 and (set_rules->>'class12_min_overall')::numeric = 50
                         and (set_rules->>'pcm_min_each')::numeric = 50 and set_rules->'class12_years' = '[2026, 2027]'::jsonb);
    t_det := t_det || set_rules::text;
    r := public.vsat__elig(2023, 2026, 70, 70, 70, 80);
    r2 := public.vsat__elig(2024, 2026, 70, 70, 70, 80);
    t_name := t_name || text 'A with the current settings: 10th in 2023 → not eligible, 2024 → eligible';
    t_pass := t_pass || (not (r->>'eligible')::boolean and (r2->>'eligible')::boolean); t_det := t_det || (r::text || ' | ' || r2::text);

    -- ════ B. VPS ════
    t_name := t_name || text 'B no stored VPS → the VSAT''s own curve: 65 → 7.4, 100 → 9.8, 35 → 3.98';
    t_pass := t_pass || (public.vsat__vps_calculated(null, 65, d1) = 7.4 and public.vsat__vps_calculated(null, 100, d1) = 9.8
                         and public.vsat__vps_calculated(null, 35, d1) = 3.98 and public.vsat__vps_calculated(null, null, d1) is null);
    t_det := t_det || format('%s %s %s', public.vsat__vps_calculated(null, 65, d1), public.vsat__vps_calculated(null, 100, d1), public.vsat__vps_calculated(null, 35, d1));
    t_name := t_name || text 'B a stored vps_score wins over the curve';
    t_pass := t_pass || (public.vsat__vps_calculated(8.43, 65, d1) = 8.43); t_det := t_det || public.vsat__vps_calculated(8.43, 65, d1)::text;
    t_name := t_name || text 'B a VSAT with no curve uses the Exam Center default curve';
    t_pass := t_pass || (public.vsat__vps_calculated(null, 80, d2)
                         = public.vsat_calc_vps(80, (select s2.vps_anchors from public.vsat_exam_settings s2 order by s2.id limit 1)));
    t_det := t_det || public.vsat__vps_calculated(null, 80, d2)::text;
    r := public.vsat__effective(g_id);
    t_name := t_name || text 'B effective: calculated 7.4 from the curve, source "curve", percentile carried';
    t_pass := t_pass || ((r->'vps'->>'calculated')::numeric = 7.4 and r->'vps'->>'source' = 'curve' and (r->'vps'->>'value')::numeric = 7.4
                         and (r->'vps'->>'percentile')::numeric = 65 and (r->'eligible'->>'value')::boolean);
    t_det := t_det || r::text;
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_set_override', jsonb_build_object('application_id', g_id, 'field', 'vps', 'value', 8, 'reason', 'zz test')));
    t_name := t_name || text 'B an admin override still wins (value 8, calculated 7.4 kept)';
    t_pass := t_pass || ((r->'vps'->>'value')::numeric = 8 and (r->'vps'->>'calculated')::numeric = 7.4); t_det := t_det || r::text;
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_clear_override', jsonb_build_object('application_id', g_id, 'field', 'vps', 'reason', 'zz test')));

    -- ════ C. sections and percentage ════
    t_name := t_name || text 'C sections: Wheebox spec names (Quantitative Aptitude / Logical Reasoning / Computer Science)';
    r := '{"Quantitative Aptitude": "10", "Logical Reasoning": "9", "Computer Science": "9"}';
    t_pass := t_pass || (public.vsat__section_marks(r, 'maths') = 10 and public.vsat__section_marks(r, 'lr') = 9 and public.vsat__section_marks(r, 'cs') = 9);
    t_det := t_det || format('%s/%s/%s', public.vsat__section_marks(r, 'maths'), public.vsat__section_marks(r, 'lr'), public.vsat__section_marks(r, 'cs'));
    t_name := t_name || text 'C sections: the sheet''s names, numbers / text / object values';
    r := '{"Maths VSAT": 40, "Logical and Aptitude": "35.5", "CS": {"markObtainInSection": "12"}}';
    t_pass := t_pass || (public.vsat__section_marks(r, 'maths') = 40 and public.vsat__section_marks(r, 'lr') = 35.5 and public.vsat__section_marks(r, 'cs') = 12);
    t_det := t_det || format('%s/%s/%s', public.vsat__section_marks(r, 'maths'), public.vsat__section_marks(r, 'lr'), public.vsat__section_marks(r, 'cs'));
    t_name := t_name || text 'C sections: non-numbers and non-objects give nothing (never an error)';
    t_pass := t_pass || (public.vsat__section_marks('{"Maths": "n/a", "Logic": null}', 'maths') is null and public.vsat__section_marks('{"Maths": "n/a"}', 'lr') is null
                         and public.vsat__section_marks('[1,2]', 'maths') is null and public.vsat__section_marks(null, 'cs') is null
                         and public.vsat__section_marks('{"Maths": 5}', 'other') is null);
    t_det := t_det || text '';
    t_name := t_name || text 'C percentage = obtained / max × 100; no max → nothing';
    t_pass := t_pass || (public.vsat__exam_pct(130, 200) = 65 and public.vsat__exam_pct(130, 0) is null and public.vsat__exam_pct(null, 200) is null);
    t_det := t_det || public.vsat__exam_pct(130, 200)::text;

    -- ════ E. proctoring verdicts (run before D/F/G so the DQ fixture is set through the RPC) ════
    r := pg_temp.call_as(null, pg_temp.rpc('vsat_set_proctoring_bulk', jsonb_build_object('application_ids', jsonb_build_array(dq_id), 'verdict', 'disqualified', 'reason', 'zz')), true);
    t_name := t_name || text 'E anon cannot set proctoring'; t_det := t_det || r::text; t_pass := t_pass || (r->>'sqlstate' = '42501');
    r := pg_temp.call_as(int1, pg_temp.rpc('vsat_set_proctoring_bulk', jsonb_build_object('application_ids', jsonb_build_array(dq_id), 'verdict', 'disqualified', 'reason', 'zz test')));
    t_name := t_name || text 'E an interviewer cannot set proctoring'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_set_proctoring_bulk', jsonb_build_object('application_ids', jsonb_build_array(dq_id), 'verdict', 'disqualified')));
    t_name := t_name || text 'E disqualifying needs a reason'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'REASON_REQUIRED');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_set_proctoring_bulk', jsonb_build_object('application_ids', jsonb_build_array(dq_id), 'verdict', 'disqualified', 'reason', 'zz tab switching')));
    t_name := t_name || text 'E admin disqualifies with a reason → changed 1'; t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'changed')::int = 1 and public.vsat__proctoring_of(dq_id) = 'disqualified');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_set_proctoring_bulk', jsonb_build_object('application_ids', jsonb_build_array(dq_id), 'verdict', 'disqualified', 'reason', 'zz again')));
    t_name := t_name || text 'E the same verdict again → unchanged'; t_det := t_det || r::text; t_pass := t_pass || ((r->>'unchanged')::int = 1 and (r->>'changed')::int = 0);
    r := pg_temp.call_as(adm_pune, pg_temp.rpc('vsat_set_proctoring_bulk', jsonb_build_object('application_ids', jsonb_build_array(g_id, p_id), 'verdict', 'cleared')));
    t_name := t_name || text 'E Pune admissions: own campus cleared (no reason needed for a first "cleared"), Gurugram student skipped';
    t_det := t_det || r::text;
    t_pass := t_pass || ((r->>'changed')::int = 1 and r->'skipped' @> jsonb_build_array(jsonb_build_object('application_id', g_id, 'code', 'FORBIDDEN'))
                         and public.vsat__proctoring_of(p_id) = 'cleared' and public.vsat__proctoring_of(g_id) is null);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_set_proctoring_bulk', jsonb_build_object('application_ids', jsonb_build_array(p_id), 'verdict', null)));
    t_name := t_name || text 'E removing a verdict without a reason is skipped'; t_det := t_det || r::text;
    t_pass := t_pass || (r->'skipped' @> jsonb_build_array(jsonb_build_object('application_id', p_id, 'code', 'REASON_REQUIRED')) and public.vsat__proctoring_of(p_id) = 'cleared');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_set_proctoring_bulk', jsonb_build_object('application_ids', jsonb_build_array(p_id), 'verdict', null, 'reason', 'zz marked by mistake')));
    t_name := t_name || text 'E … with a reason it is removed'; t_det := t_det || r::text; t_pass := t_pass || ((r->>'changed')::int = 1 and public.vsat__proctoring_of(p_id) is null);
    select count(*) into n from public.vsat_proctoring_log l where l.application_id in (dq_id, p_id);
    t_name := t_name || text 'E every change is logged (1 for the DQ, 2 for the cleared-then-removed)'; t_det := t_det || n::text; t_pass := t_pass || (n = 3);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_set_proctoring_bulk', jsonb_build_object('application_ids', jsonb_build_array(p_id), 'verdict', 'banned', 'reason', 'zz')));
    r2 := pg_temp.call_as(adm, pg_temp.rpc('vsat_set_proctoring_bulk', jsonb_build_object('application_ids', jsonb_build_array(p_id), 'reason', 'zz')));
    t_name := t_name || text 'E unknown verdict or no verdict key is refused'; t_det := t_det || (r::text || ' | ' || r2::text);
    t_pass := t_pass || (r->>'message' = 'BAD_VALUE: verdict' and r2->>'message' = 'BAD_VALUE: verdict');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_set_proctoring_bulk', jsonb_build_object('application_ids', '[]'::jsonb, 'verdict', 'cleared')));
    r2 := pg_temp.call_as(adm, pg_temp.rpc('vsat_set_proctoring_bulk', jsonb_build_object('application_ids', jsonb_build_array(p_id), 'verdict', 'cleared', 'x', 1)));
    t_name := t_name || text 'E empty selection / unexpected key refused'; t_det := t_det || (r::text || ' | ' || r2::text);
    t_pass := t_pass || (r->>'message' = 'BAD_VALUE: application_ids' and r2->>'message' like 'UNKNOWN_KEY%');

    -- ════ D. grid ════
    r := pg_temp.call_as(adm, 'select public.vsat_grid_columns()');
    cols := r->'columns';
    t_name := t_name || text 'D column list: new result columns are filterable; stage is not; old per-attempt copies have their own group';
    t_pass := t_pass || (cols @> '[{"key":"exam_percentage","filterable":true,"virtual":true},{"key":"proctoring","filterable":true},{"key":"vps_effective","filterable":true},
                                   {"key":"vps_calculated","filterable":true},{"key":"class12_result","filterable":true,"group":"Academics"},{"key":"exam_section_lr","filterable":true},
                                   {"key":"stage","filterable":false},{"key":"vps_score_1","group":"Old sheet (per attempt)"},{"key":"vsat_percentile_2","group":"Old sheet (per attempt)"},
                                   {"key":"class12_percentage","filterable":true,"virtual":false},{"key":"vps_score","group":"Exam"}]'::jsonb);
    t_det := t_det || left(cols::text, 200);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', jsonb_build_object('exam_date_ids', jsonb_build_array(d1), 'search', jsonb_build_object('column', '_any', 'values', jsonb_build_array(g_id)),
           'columns', '["exam_percentage","exam_section_maths","exam_section_lr","exam_section_cs","vps_calculated","vps_effective","class12_result","class10_eligible","class12_eligible","proctoring"]'::jsonb)));
    t_name := t_name || text 'D a row carries %, the three sections, VPS from the curve and the eligibility parts';
    t_det := t_det || left(r::text, 400);
    t_pass := t_pass || ((r->>'total')::int = 1 and (r->'rows'->0->>'exam_percentage')::numeric = 65 and (r->'rows'->0->>'exam_section_maths')::numeric = 40
                         and (r->'rows'->0->>'exam_section_lr')::numeric = 35.5 and (r->'rows'->0->>'exam_section_cs')::numeric = 12
                         and (r->'rows'->0->>'vps_calculated')::numeric = 7.4 and (r->'rows'->0->>'vps_effective')::numeric = 7.4
                         and r->'rows'->0->>'class12_result' = 'pass' and (r->'rows'->0->>'class10_eligible')::boolean and (r->'rows'->0->>'class12_eligible')::boolean
                         and r->'rows'->0->'proctoring' = 'null'::jsonb);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', jsonb_build_object('exam_date_ids', jsonb_build_array(d1), 'filters', '[{"column":"proctoring","op":"eq","v":"disqualified"}]'::jsonb, 'columns', '["proctoring"]'::jsonb)));
    t_name := t_name || text 'D filter proctoring = disqualified → the 1 DQ student'; t_det := t_det || left(r::text, 200);
    t_pass := t_pass || ((r->>'total')::int = 1 and r->'rows'->0->>'application_id' = dq_id and r->'rows'->0->>'proctoring' = 'disqualified');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', jsonb_build_object('exam_date_ids', jsonb_build_array(d1), 'filters', '[{"column":"exam_percentage","op":"gte","v":"90"}]'::jsonb)));
    t_name := t_name || text 'D filter exam % ≥ 90 → 9 (as in the sheet)'; t_det := t_det || (r->>'total'); t_pass := t_pass || ((r->>'total')::int = 9);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', jsonb_build_object('exam_date_ids', jsonb_build_array(d1), 'filters', '[{"column":"vps_effective","op":"gte","v":"7.4"}]'::jsonb)));
    t_name := t_name || text 'D filter VPS ≥ 7.4 → the 27 with percentile ≥ 65'; t_det := t_det || (r->>'total'); t_pass := t_pass || ((r->>'total')::int = 27);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', jsonb_build_object('exam_date_ids', jsonb_build_array(d1), 'filters', '[{"column":"vps_effective","op":"between","v":["3","4"]},{"column":"class12_result","op":"eq","v":"pass"}]'::jsonb)));
    t_name := t_name || text 'D VPS between 3 and 4 AND 12th = pass → 3 (percentiles 30, 31, 33)'; t_det := t_det || (r->>'total'); t_pass := t_pass || ((r->>'total')::int = 3);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', jsonb_build_object('exam_date_ids', jsonb_build_array(d1), 'filters', '[{"column":"eligible_effective","op":"false"}]'::jsonb)));
    r2 := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', jsonb_build_object('exam_date_ids', jsonb_build_array(d1), 'filters', '[{"column":"class10_eligible","op":"true"},{"column":"exam_section_maths","op":"notnull"}]'::jsonb)));
    t_name := t_name || text 'D boolean virtual filters: ineligible → 0; 10th ok AND has a maths section → 1'; t_det := t_det || format('%s %s', r->>'total', r2->>'total');
    t_pass := t_pass || ((r->>'total')::int = 0 and (r2->>'total')::int = 1);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', jsonb_build_object('exam_date_ids', jsonb_build_array(d1), 'filters', '[{"column":"proctoring","op":"eq","v":"x'' or 1=1 --"}]'::jsonb)));
    t_name := t_name || text 'D a quote in a virtual-filter value is just a value (0 rows, no error)'; t_det := t_det || left(r::text, 160); t_pass := t_pass || ((r->>'total')::int = 0);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', jsonb_build_object('exam_date_ids', jsonb_build_array(d1), 'filters', '[{"column":"vps_effective","op":"gte","v":"abc"}]'::jsonb)));
    r2 := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', jsonb_build_object('exam_date_ids', jsonb_build_array(d1), 'filters', '[{"column":"vsat","op":"eq","v":"x"}]'::jsonb)));
    t_name := t_name || text 'D bad value on a virtual column / a virtual column without an expression → BAD_VALUE: filters'; t_det := t_det || (r::text || ' | ' || r2::text);
    t_pass := t_pass || (r->>'message' = 'BAD_VALUE: filters' and r2->>'message' = 'BAD_VALUE: filters');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_grid_list', jsonb_build_object('exam_date_ids', jsonb_build_array(d1), 'filters', '[{"column":"vps_effective","op":"contains","v":"7"}]'::jsonb)));
    t_name := t_name || text 'D an operator not allowed for the type is refused on virtual columns too'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'BAD_VALUE: filters');

    -- ════ F. VSAT analysis (sheet parity) ════
    r := pg_temp.call_as(null, pg_temp.rpc('vsat_exam_analysis', jsonb_build_object('exam_date_ids', jsonb_build_array(d1))), true);
    r2 := pg_temp.call_as(int1, pg_temp.rpc('vsat_exam_analysis', jsonb_build_object('exam_date_ids', jsonb_build_array(d1))));
    t_name := t_name || text 'F anon and interviewers cannot see the analysis'; t_det := t_det || (r::text || ' | ' || r2::text);
    t_pass := t_pass || (r->>'sqlstate' = '42501' and r2->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_exam_analysis', jsonb_build_object('exam_date_ids', jsonb_build_array(d1), 'percentile', 35)));
    t_name := t_name || text 'F takers 32 · average % 75.84 · > 70: 24 · 1 disqualified'; t_det := t_det || left(r::text, 300);
    t_pass := t_pass || ((r->>'takers')::int = 32 and (r->>'avg_percentage')::numeric = 75.84 and (r->>'above_70')::int = 24 and (r->>'disqualified')::int = 1);
    t_name := t_name || text 'F non-DQ slabs 0 / 4 / 1 / 8 / 18 and gender 24 male / 7 female';
    t_det := t_det || ((r->'slabs')::text || ' ' || (r->'gender')::text);
    t_pass := t_pass || ((select array_agg((e->>'n')::int order by o) from jsonb_array_elements(r->'slabs') with ordinality a(e, o)) = array[0, 4, 1, 8, 18]
                         and (r->'gender'->>'male')::int = 24 and (r->'gender'->>'female')::int = 7 and (r->'gender'->>'other')::int = 0);
    t_name := t_name || text 'F at 35: male 21 / female 6 = 27 · Pune 12 / 4 · Gurugram 9 / 2 · VPS 3.98';
    t_det := t_det || (r->'cutoff')::text;
    t_pass := t_pass || ((r->'cutoff'->'overall'->>'male')::int = 21 and (r->'cutoff'->'overall'->>'female')::int = 6 and (r->'cutoff'->>'total')::int = 27
                         and (r->'cutoff'->'by_campus'->'pune'->>'male')::int = 12 and (r->'cutoff'->'by_campus'->'pune'->>'female')::int = 4
                         and (r->'cutoff'->'by_campus'->'gurugram'->>'male')::int = 9 and (r->'cutoff'->'by_campus'->'gurugram'->>'female')::int = 2
                         and (r->'cutoff'->>'vps')::numeric = 3.98);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_exam_analysis', jsonb_build_object('exam_date_ids', jsonb_build_array(d1), 'percentile', 65)));
    t_name := t_name || text 'F at 65: male 20 / female 6 · Pune 11 / 4 · Gurugram 9 / 2 · VPS 7.4'; t_det := t_det || (r->'cutoff')::text;
    t_pass := t_pass || ((r->'cutoff'->'overall'->>'male')::int = 20 and (r->'cutoff'->'overall'->>'female')::int = 6
                         and (r->'cutoff'->'by_campus'->'pune'->>'male')::int = 11 and (r->'cutoff'->'by_campus'->'pune'->>'female')::int = 4
                         and (r->'cutoff'->'by_campus'->'gurugram'->>'male')::int = 9 and (r->'cutoff'->'by_campus'->'gurugram'->>'female')::int = 2
                         and (r->'cutoff'->>'vps')::numeric = 7.4);
    r := pg_temp.call_as(adm_pune, pg_temp.rpc('vsat_exam_analysis', jsonb_build_object('exam_date_ids', jsonb_build_array(d1), 'percentile', 35)));
    t_name := t_name || text 'F Pune admissions only count Pune students (20 takers, no Gurugram block)'; t_det := t_det || left(r::text, 300);
    t_pass := t_pass || ((r->>'takers')::int = 20 and not (r->'cutoff'->'by_campus' ? 'gurugram') and (r->'cutoff'->>'total')::int = 16);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_exam_analysis', jsonb_build_object('exam_date_ids', '[]'::jsonb)));
    r2 := pg_temp.call_as(adm, pg_temp.rpc('vsat_exam_analysis', jsonb_build_object('exam_date_ids', jsonb_build_array(d1), 'percentile', 101)));
    t_name := t_name || text 'F no VSAT / percentile above 100 refused'; t_det := t_det || (r::text || ' | ' || r2::text);
    t_pass := t_pass || (r->>'message' = 'BAD_VALUE: exam_date_ids' and r2->>'message' = 'BAD_VALUE: percentile');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_exam_analysis', jsonb_build_object('exam_date_ids', jsonb_build_array(d1))));
    t_name := t_name || text 'F without a percentile the cut-off block is empty'; t_det := t_det || coalesce(r->>'cutoff', 'null'); t_pass := t_pass || (r->'cutoff' = 'null'::jsonb);

    -- ════ G. Select for PI ════
    r := pg_temp.call_as(adm_pune, pg_temp.rpc('vsat_select_for_pi', jsonb_build_object('exam_date_id', d1, 'percentile', 35)));
    t_name := t_name || text 'G admissions cannot run Select for PI (admins only)'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'FORBIDDEN');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_select_for_pi', jsonb_build_object('exam_date_id', d1, 'percentile', 35)));
    t_name := t_name || text 'G preview at 35: 27 selected (21 male / 6 female, Pune 16 / Gurugram 11), 4 below, 1 DQ — the sheet''s list';
    t_det := t_det || left((r - 'candidates')::text, 400);
    t_pass := t_pass || (not (r->>'applied')::boolean and (r->'selected'->>'total')::int = 27 and (r->'selected'->>'male')::int = 21 and (r->'selected'->>'female')::int = 6
                         and (r->'selected'->>'pune')::int = 16 and (r->'selected'->>'gurugram')::int = 11
                         and (r->'counts'->>'below_cutoff')::int = 4 and (r->'counts'->>'disqualified')::int = 1 and (r->'counts'->>'no_result')::int = 0
                         and jsonb_array_length(r->'candidates') = 27 and (r->'candidates'->0->>'percentile')::numeric = 98 and (r->>'vps_cutoff')::numeric = 3.98);
    select count(*) into n from public.vsat_pipeline vp where vp.application_id = any(ids) and vp.stage = 'exam_taken' and vp.status = 'active';
    t_name := t_name || text 'G preview moves nobody'; t_det := t_det || n::text; t_pass := t_pass || (n = 32);
    -- one on hold, one marked ineligible by an admin → they drop out with their own reason
    perform public.vsat__move('PIX07', 'exam_taken', 'on_hold', 'zz test', 'system', null, null);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_set_override', jsonb_build_object('application_id', 'PIX17', 'field', 'eligible', 'value', false, 'reason', 'zz test')));
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_select_for_pi', jsonb_build_object('exam_date_id', d1, 'percentile', 35)));
    t_name := t_name || text 'G on hold → not_active, overridden ineligible → not_eligible (25 left)'; t_det := t_det || (r->'counts')::text;
    t_pass := t_pass || ((r->'selected'->>'total')::int = 25 and (r->'counts'->>'not_active')::int = 1 and (r->'counts'->>'not_eligible')::int = 1);
    perform public.vsat__move('PIX07', 'exam_taken', 'active', 'zz test', 'system', null, null);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_clear_override', jsonb_build_object('application_id', 'PIX17', 'field', 'eligible', 'reason', 'zz test')));
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_select_for_pi', jsonb_build_object('exam_date_id', d1, 'percentile', 35, 'apply', true, 'expected_count', 26)));
    t_name := t_name || text 'G apply refuses when the count changed since the preview'; t_det := t_det || r::text; t_pass := t_pass || (r->>'message' = 'COUNT_CHANGED');
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_select_for_pi', jsonb_build_object('exam_date_id', d1, 'percentile', 35, 'apply', true, 'expected_count', 27, 'note', 'zz note')));
    t_name := t_name || text 'G apply: 27 moved, none skipped'; t_det := t_det || left((r - 'candidates')::text, 400);
    t_pass := t_pass || ((r->>'applied')::boolean and (r->>'moved')::int = 27 and jsonb_array_length(r->'skipped') = 0);
    select count(*) into n from public.vsat_pipeline vp where vp.application_id = any(ids) and vp.stage = 'vsat_cleared' and vp.status = 'active';
    select h.reason into s from public.vsat_stage_history h where h.application_id = g_id and h.to_stage = 'vsat_cleared' order by h.id desc limit 1;
    t_name := t_name || text 'G 27 now at VSAT cleared, each with the reason in history'; t_det := t_det || format('%s · %s', n, s);
    t_pass := t_pass || (n = 27 and s = 'Selected for PI · ZZTEST VSAT-PI · percentile ≥ 35 (VPS ≥ 3.98) · zz note');
    select count(*) into n from public.vsat_pipeline vp where vp.application_id = any(ids) and vp.stage = 'exam_taken';
    t_name := t_name || text 'G the other 5 stay where they were'; t_det := t_det || n::text; t_pass := t_pass || (n = 5);
    select count(*) into n from public.vsat_settings_audit a where a.target = d1::text and a.area = 'vsat' and a.after->>'source' = 'select_for_pi' and a.user_id = adm;
    t_name := t_name || text 'G the VSAT keeps the cut-off (VPS 3.98) and the change is audited';
    t_det := t_det || format('%s audit, cutoff %s', n, (select d.cleared_vps_cutoff from public.vsat_exam_dates d where d.id = d1));
    t_pass := t_pass || (n = 1 and (select d.cleared_vps_cutoff from public.vsat_exam_dates d where d.id = d1) = 3.98);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_select_for_pi', jsonb_build_object('exam_date_id', d1, 'percentile', 35)));
    t_name := t_name || text 'G running it again finds nobody new (27 already selected)'; t_det := t_det || (r->'counts')::text;
    t_pass := t_pass || ((r->'selected'->>'total')::int = 0 and (r->'counts'->>'already_selected')::int = 27);
    r := pg_temp.call_as(adm, pg_temp.rpc('vsat_select_for_pi', jsonb_build_object('exam_date_id', d1, 'percentile', '35')));
    r2 := pg_temp.call_as(adm, pg_temp.rpc('vsat_select_for_pi', jsonb_build_object('exam_date_id', gen_random_uuid(), 'percentile', 35)));
    t_name := t_name || text 'G percentile as text / unknown VSAT refused'; t_det := t_det || (r::text || ' | ' || r2::text);
    t_pass := t_pass || (r->>'message' = 'BAD_VALUE: percentile' and r2->>'message' = 'BAD_VALUE: exam_date_id');

    -- ════ H. grants ════
    t_name := t_name || text 'H new RPCs: authenticated only, security definer, empty search_path';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat_set_proctoring_bulk', 'vsat_exam_analysis', 'vsat_select_for_pi')
       and not (has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
                and p.prosecdef and p.proconfig = array['search_path=""']);
    t_det := t_det || coalesce(s, 'all ok'); t_pass := t_pass || (s is null);
    t_name := t_name || text 'H helpers and the formulas are not callable by browsers; all have an empty search_path';
    select string_agg(p.proname, ',') into s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname in ('vsat__elig', 'vsat__vps_calculated', 'vsat__override_of', 'vsat__exam_pct', 'vsat__section_marks',
                                                   'vsat__proctoring_of', 'vsat__grid_virt_expr', 'vsat_calc_eligibility', 'vsat__effective', 'vsat__grid', 'vsat__grid_catalog')
       and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')
            or p.proconfig is distinct from array['search_path=""']);
    t_det := t_det || coalesce(s, 'all ok'); t_pass := t_pass || (s is null);
    t_name := t_name || text 'H proctoring tables: RLS on, browsers have no access';
    t_pass := t_pass || ((select relrowsecurity from pg_class where oid = 'public.vsat_proctoring'::regclass)
                         and (select relrowsecurity from pg_class where oid = 'public.vsat_proctoring_log'::regclass)
                         and not has_table_privilege('authenticated', 'public.vsat_proctoring', 'select,insert,update,delete')
                         and not has_table_privilege('anon', 'public.vsat_proctoring', 'select,insert,update,delete')
                         and not has_table_privilege('authenticated', 'public.vsat_proctoring_log', 'select,insert,update,delete')
                         and not has_sequence_privilege('authenticated', 'public.vsat_proctoring_log_id_seq', 'usage'));
    t_det := t_det || text '';

    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_vsat_exam_results_pi_tests();
