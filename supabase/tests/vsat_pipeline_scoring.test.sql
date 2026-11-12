-- VSAT pipeline scoring · tests for migration 0079 (STAGING ONLY)
--
-- How to run: paste into the staging SQL editor (or run through the Supabase MCP). The last
-- statement returns one row per test: test | pass | detail. Nothing is written.
--
-- Fixtures are NUMBERS ONLY taken from the real sheets (no names, emails or IDs):
--   VSAT-14 Mastersheet'26 · Test Result (percentile → VPS, anchor 65), 14th July (eligibility),
--   Selected For Counselling Pune / GGN (scholarship score + category);
--   VSAT Student Details 2026 · Interview Responses (5 parts + date → weighted score).
-- Only cells the sheet CALCULATED are used. Left out: 5 VPS cells and 5 "10th Eli" cells that
-- were typed over the formula by hand (manual overrides), and blank rows in the counselling tabs.

create or replace function pg_temp.run_vsat_scoring_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $t$
declare
  t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}';
  fx_vps jsonb := '[[65.0,7.4],[92.0,9.25],[73.0,7.95],[78.0,8.29],[26.0,2.96],[82.0,8.57],[92.0,9.25],[74.0,8.02],[80.0,8.43],[88.0,8.98],[30.0,3.42],[95.0,9.46],[80.0,8.43],[88.0,8.98],[75.0,8.09],[82.0,8.57],[91.0,9.18],[80.0,8.43],[82.0,8.57],[70.0,7.74],[95.0,9.46],[95.0,9.46],[68.0,7.61],[92.0,9.25],[33.0,3.76],[85.0,8.77],[78.0,8.29]]';
  fx_el  jsonb := '[[2023,2025,81.0,86.0,80.0,"pass",true],[2024,2026,53.0,48.0,26.0,"fail",false],[2024,2026,43.0,37.0,46.0,"fail",false],[2024,2026,75.0,79.0,88.0,"pass",true],[2024,2026,61.0,51.0,44.0,"pass",true],[2023,2025,58.0,61.0,49.0,"pass",true],[2023,2025,59.0,55.0,55.0,"pass",true],[2023,2025,68.0,55.0,60.0,"pass",true],[2024,2026,0.0,0.0,0.0,"yet_to_graduate",true],[2024,2026,55.0,60.0,44.0,"pass",true],[2023,2025,69.0,89.0,72.0,"pass",true],[2023,2025,68.0,79.0,53.0,"pass",true],[2024,2026,74.0,70.0,63.0,"pass",true],[2024,2026,87.0,89.0,100.0,"pass",true],[2024,2026,78.0,82.0,69.0,"pass",true],[2023,2025,78.0,86.0,75.0,"pass",true],[2023,2025,74.0,90.0,68.0,"pass",true],[2024,2026,149.0,144.0,293.0,"pass",true],[2024,2026,73.0,81.0,75.0,"pass",true],[2023,2025,59.0,49.0,49.0,"pass",true],[2023,2025,75.0,83.0,75.0,"pass",true],[2023,2025,68.0,53.0,61.0,"pass",true],[2024,2026,63.0,74.0,72.0,"pass",true],[2023,2025,88.0,82.0,88.0,"pass",true],[2023,2025,66.0,71.0,72.0,"pass",true],[2024,2026,68.0,75.0,89.0,"pass",true],[2023,2025,75.0,79.0,67.0,"pass",true],[2023,2026,52.0,53.0,46.0,"pass",true],[2023,2025,67.0,58.0,70.0,"pass",true],[2024,2026,67.0,82.0,79.0,"pass",true],[2023,2025,67.0,64.0,89.0,"pass",true],[2023,2025,53.0,55.0,48.0,"pass",true],[2024,2026,52.0,60.0,60.0,"pass",true],[2024,2026,46.0,52.0,57.0,"pass",true],[2024,2026,58.0,63.0,64.0,"pass",true],[2023,2026,60.0,71.0,79.0,"pass",true]]';
  fx_sc  jsonb := '[["pune",{"vsat_pct":82.0,"class10_pct":91.0,"class12_pct":81.0,"interview_score":2.15,"cs_passion":2.0,"jee_pct":89.0,"jee_maths_pct":64.0,"class10_maths_pct":80.0,"class12_maths_pct":67.0},71.5,6],["pune",{"vsat_pct":91.0,"class10_pct":94.4,"class12_pct":83.6,"interview_score":2.4,"cs_passion":2.0,"jee_pct":77.0,"jee_maths_pct":33.0,"class10_maths_pct":95.0,"class12_maths_pct":63.0},67.33,7],["pune",{"vsat_pct":92.5,"class10_pct":74.0,"class12_pct":61.4,"interview_score":2.95,"cs_passion":2.0,"jee_pct":44.0,"jee_maths_pct":78.0,"class10_maths_pct":69.0,"class12_maths_pct":46.0},63.115,8],["pune",{"vsat_pct":80.0,"class10_pct":94.8,"class12_pct":72.0,"interview_score":2.8,"cs_passion":2.0,"jee_pct":70.0,"jee_maths_pct":78.0,"class10_maths_pct":91.0,"class12_maths_pct":72.0},71.79,6],["pune",{"vsat_pct":80.0,"class10_pct":87.0,"class12_pct":97.0,"interview_score":3.4,"cs_passion":1.0,"jee_pct":49.0,"jee_maths_pct":56.5,"class10_maths_pct":75.0,"class12_maths_pct":70.0},66.275,7],["pune",{"vsat_pct":69.5,"class10_pct":92.2,"class12_pct":83.0,"interview_score":2.65,"cs_passion":2.0,"jee_pct":null,"jee_maths_pct":null,"class10_maths_pct":92.0,"class12_maths_pct":72.0},72.31,6],["pune",{"vsat_pct":87.5,"class10_pct":93.0,"class12_pct":86.0,"interview_score":3.55,"cs_passion":3.0,"jee_pct":null,"jee_maths_pct":null,"class10_maths_pct":96.0,"class12_maths_pct":80.0},82.95,4],["pune",{"vsat_pct":85.0,"class10_pct":95.0,"class12_pct":0.8897,"interview_score":4.0,"cs_passion":4.0,"jee_pct":null,"jee_maths_pct":null,"class10_maths_pct":99.0,"class12_maths_pct":75.0},68.0279,7],["pune",{"vsat_pct":56.5,"class10_pct":93.2,"class12_pct":62.0,"interview_score":2.35,"cs_passion":1.0,"jee_pct":null,"jee_maths_pct":null,"class10_maths_pct":92.0,"class12_maths_pct":67.0},62.61,8],["pune",{"vsat_pct":70.0,"class10_pct":96.0,"class12_pct":98.0,"interview_score":3.6,"cs_passion":2.0,"jee_pct":96.18,"jee_maths_pct":97.4,"class10_maths_pct":100.0,"class12_maths_pct":100.0},86.746,3],["gurugram",{"vsat_pct":65.0,"class10_pct":85.2,"class12_pct":64.0,"interview_score":2.95,"cs_passion":2.0,"jee_pct":61.0,"jee_maths_pct":55.0,"class10_maths_pct":59.0,"class12_maths_pct":49.0},59.56,8],["gurugram",{"vsat_pct":74.0,"class10_pct":56.8,"class12_pct":47.0,"interview_score":2.2,"cs_passion":3.0,"jee_pct":33.0,"jee_maths_pct":55.0,"class10_maths_pct":52.0,"class12_maths_pct":0.0},45.69,8],["gurugram",{"vsat_pct":67.5,"class10_pct":78.0,"class12_pct":68.0,"interview_score":2.25,"cs_passion":3.0,"jee_pct":54.0,"jee_maths_pct":87.0,"class10_maths_pct":63.0,"class12_maths_pct":64.0},63.975,8],["gurugram",{"vsat_pct":95.0,"class10_pct":71.66,"class12_pct":62.0,"interview_score":1.8,"cs_passion":1.0,"jee_pct":69.33,"jee_maths_pct":55.0,"class10_maths_pct":63.0,"class12_maths_pct":48.0},60.499,8],["gurugram",{"vsat_pct":95.5,"class10_pct":81.6,"class12_pct":70.0,"interview_score":1.5,"cs_passion":1.0,"jee_pct":null,"jee_maths_pct":null,"class10_maths_pct":69.0,"class12_maths_pct":60.0},63.53,8],["gurugram",{"vsat_pct":92.5,"class10_pct":62.5,"class12_pct":76.0,"interview_score":1.15,"cs_passion":1.0,"jee_pct":null,"jee_maths_pct":null,"class10_maths_pct":61.0,"class12_maths_pct":89.0},64.925,8],["gurugram",{"vsat_pct":75.0,"class10_pct":90.2,"class12_pct":73.0,"interview_score":3.55,"cs_passion":3.0,"jee_pct":61.0,"jee_maths_pct":49.0,"class10_maths_pct":88.0,"class12_maths_pct":72.0},67.86,7],["gurugram",{"vsat_pct":77.5,"class10_pct":83.0,"class12_pct":79.0,"interview_score":3.0,"cs_passion":1.0,"jee_pct":null,"jee_maths_pct":null,"class10_maths_pct":45.0,"class12_maths_pct":44.0},61.8,8],["gurugram",{"vsat_pct":95.0,"class10_pct":90.0,"class12_pct":80.0,"interview_score":2.45,"cs_passion":2.0,"jee_pct":null,"jee_maths_pct":null,"class10_maths_pct":95.0,"class12_maths_pct":88.0},78.75,5],["gurugram",{"vsat_pct":77.5,"class10_pct":58.6,"class12_pct":79.2,"interview_score":2.35,"cs_passion":1.0,"jee_pct":82.0,"jee_maths_pct":87.0,"class10_maths_pct":48.3,"class12_maths_pct":75.0},69.89,7],["gurugram",{"vsat_pct":31.0,"class10_pct":80.1,"class12_pct":56.2,"interview_score":2.35,"cs_passion":2.0,"jee_pct":66.0,"jee_maths_pct":77.0,"class10_maths_pct":74.0,"class12_maths_pct":54.0},57.175,8]]';
  fx_iv  jsonb := '[["2025-12-29",3.0,1.0,2.0,2.0,2.0,1.9],["2025-12-29",4.0,3.0,3.0,3.0,3.0,3.1],["2025-12-29",4.0,4.0,2.0,3.0,3.0,3.15],["2025-12-29",4.0,5.0,3.0,3.0,3.0,3.6],["2025-12-29",2.0,1.0,1.0,3.0,3.0,1.7],["2025-12-29",5.0,4.0,3.0,4.0,4.0,3.85],["2025-12-29",2.0,2.0,1.0,2.0,2.0,1.7],["2025-12-29",3.0,2.0,2.0,2.0,3.0,2.3],["2025-12-29",3.0,4.0,3.0,4.0,3.0,3.2],["2025-12-29",2.0,4.0,2.0,1.0,2.0,2.3],["2025-12-29",2.0,3.0,2.0,3.0,2.0,2.25],["2025-12-29",5.0,4.0,2.0,4.0,3.0,3.5],["2025-12-29",4.0,2.0,2.0,5.0,3.0,2.85],["2025-12-29",3.0,1.0,2.0,5.0,2.0,2.2],["2025-12-29",3.0,1.0,2.0,5.0,4.0,2.5],["2025-12-29",3.0,3.0,1.0,1.0,3.0,2.25],["2025-12-29",1.0,1.0,1.0,1.0,1.0,0.95],["2025-12-29",4.0,4.0,5.0,5.0,5.0,4.25],["2025-12-29",2.0,3.0,2.0,2.0,2.0,2.15],["2025-12-29",5.0,5.0,2.0,3.0,4.0,3.8],["2026-04-02",5.0,5.0,3.0,1.0,5.0,4.0],["2026-04-02",2.0,1.0,1.0,1.0,2.0,1.4],["2026-04-02",5.0,3.0,3.0,1.0,5.0,3.5],["2026-04-02",4.0,1.0,1.0,1.0,2.0,1.9],["2026-04-02",3.0,1.0,1.0,3.0,4.0,2.25],["2026-04-02",4.0,4.0,1.0,2.0,3.0,2.95],["2026-04-02",2.0,3.0,3.0,1.0,4.0,2.6],["2026-04-02",3.0,1.0,2.0,3.0,3.0,2.3],["2026-04-02",2.0,1.0,1.0,1.0,1.0,1.25],["2026-04-02",3.0,1.0,1.0,3.0,3.0,2.1],["2026-04-02",3.0,3.0,3.0,3.0,3.0,3.0],["2026-04-02",2.0,1.0,1.0,1.0,3.0,1.55],["2026-04-02",3.0,4.0,1.0,4.0,3.0,3.0],["2026-04-02",3.0,4.0,3.0,3.0,3.0,3.25],["2026-04-02",4.0,1.0,1.0,1.0,3.0,2.05],["2026-04-02",4.0,4.0,3.0,3.0,3.0,3.5],["2026-04-02",3.0,2.0,1.0,3.0,4.0,2.5],["2026-04-02",3.0,3.0,2.0,1.0,2.0,2.35],["2026-04-02",4.0,2.0,1.0,3.0,4.0,2.75],["2026-04-02",4.0,2.0,4.0,3.0,4.0,3.35]]';
  rules jsonb := '{"min_year10": 2023, "class12_years": [2025, 2026], "pending_year": 2026, "pcm_min_total": 150}';
  anchors jsonb := '[{"percentile":0,"vps":0},{"percentile":65,"vps":7.4},{"percentile":100,"vps":9.8}]';
  x jsonb; r jsonb; n int; bad int; bads text; e text; v numeric;
begin
  -- 1. VPS
  n := 0; bad := 0; bads := '';
  for x in select * from jsonb_array_elements(fx_vps) loop
    n := n + 1; v := public.vsat_calc_vps((x->>0)::numeric, anchors);
    if abs(v - (x->>1)::numeric) > 0.006 then bad := bad + 1; bads := bads || format('p%s→%s(sheet %s) ', x->>0, v, x->>1); end if;
  end loop;
  t_name := t_name || text 'VPS matches VSAT-14 sheet for every student'; t_pass := t_pass || (bad = 0 and n > 0); t_det := t_det || format('%s/%s %s', n - bad, n, bads);
  t_name := t_name || text 'VPS edges: 0→0, 65→7.4, 100→9.8, 120 clamps, null stays null';
  t_pass := t_pass || (public.vsat_calc_vps(0, anchors) = 0 and public.vsat_calc_vps(65, anchors) = 7.4 and public.vsat_calc_vps(100, anchors) = 9.8
                       and public.vsat_calc_vps(120, anchors) = 9.8 and public.vsat_calc_vps(null, anchors) is null);
  t_det := t_det || text '';
  t_name := t_name || text 'VPS with the Exam Center default anchors (50→7.5) matches the app code';
  t_pass := t_pass || (public.vsat_calc_vps(75, '[{"percentile":0,"vps":0},{"percentile":50,"vps":7.5},{"percentile":100,"vps":10}]') = 8.75);
  t_det := t_det || public.vsat_calc_vps(75, '[{"percentile":0,"vps":0},{"percentile":50,"vps":7.5},{"percentile":100,"vps":10}]')::text;

  -- 2. Eligibility
  n := 0; bad := 0; bads := '';
  for x in select * from jsonb_array_elements(fx_el) loop
    n := n + 1;
    r := public.vsat_calc_eligibility((x->>0)::int, (x->>1)::int, (x->>2)::numeric, (x->>3)::numeric, (x->>4)::numeric, rules);
    if r->>'class12' <> x->>5 or (r->>'eligible')::boolean <> (x->>6)::boolean then bad := bad + 1; bads := bads || x::text || '→' || r::text || ' '; end if;
  end loop;
  t_name := t_name || text 'Eligibility matches VSAT-14 sheet for every applicant'; t_pass := t_pass || (bad = 0 and n > 0); t_det := t_det || format('%s/%s %s', n - bad, n, left(bads, 400));
  r := public.vsat_calc_eligibility(2022, 2026, 60, 60, 60, rules);
  t_name := t_name || text 'Eligibility: 10th before 2023 → not eligible'; t_pass := t_pass || not (r->>'eligible')::boolean; t_det := t_det || r::text;
  r := public.vsat_calc_eligibility(2024, 2026, 0, 0, 0, rules);
  t_name := t_name || text 'Eligibility: 12th in 2026 with no marks yet → yet to graduate, eligible'; t_pass := t_pass || (r->>'class12' = 'yet_to_graduate' and (r->>'eligible')::boolean); t_det := t_det || r::text;
  r := public.vsat_calc_eligibility(2023, 2025, 50, 50, 49, rules);
  t_name := t_name || text 'Eligibility: PCM total 149 → fail, not eligible'; t_pass := t_pass || (r->>'class12' = 'fail' and not (r->>'eligible')::boolean); t_det := t_det || r::text;

  -- 3. Interview score (weights by date)
  n := 0; bad := 0; bads := '';
  for x in select * from jsonb_array_elements(fx_iv) loop
    n := n + 1;
    r := public.vsat_calc_interview((x->>1)::numeric, (x->>2)::numeric, (x->>3)::numeric, (x->>4)::numeric, (x->>5)::numeric, (x->>0)::date);
    if abs((r->>'score')::numeric - (x->>6)::numeric) > 0.0001 then bad := bad + 1; bads := bads || x::text || '→' || (r->>'score') || ' '; end if;
  end loop;
  t_name := t_name || text 'Interview score matches the sheet (old weights before Apr 2026, new after)'; t_pass := t_pass || (bad = 0 and n = 40); t_det := t_det || format('%s/%s %s', n - bad, n, left(bads, 400));
  r := public.vsat_calc_interview(4, 3, 3, 3, 3, '2026-11-01');
  t_name := t_name || text 'Interview: ranking = score × 4; lowest part 3 → suggested selected'; t_pass := t_pass || ((r->>'ranking')::numeric = (r->>'score')::numeric * 4 and r->>'suggested_verdict' = 'selected'); t_det := t_det || r::text;
  t_name := t_name || text 'Interview: lowest part 1 → not selected, 2 → maybe';
  t_pass := t_pass || (public.vsat_calc_interview(5, 5, 1, 5, 5, null)->>'suggested_verdict' = 'not_selected' and public.vsat_calc_interview(5, 5, 2, 5, 5, null)->>'suggested_verdict' = 'maybe');
  t_det := t_det || text '';
  begin perform public.vsat_calc_interview(6, 3, 3, 3, 3, null); e := 'ACCEPTED'; exception when others then e := sqlstate || ' ' || sqlerrm; end;
  t_name := t_name || text 'Interview: a part of 6 is refused'; t_pass := t_pass || (e like '22023%'); t_det := t_det || e;

  -- 4. Scholarship score + category (both campuses, default bands = VSAT-14)
  n := 0; bad := 0; bads := '';
  for x in select * from jsonb_array_elements(fx_sc) loop
    n := n + 1; r := public.vsat_calc_scholarship(x->1, x->>0, null);
    if abs((r->>'score')::numeric - (x->>2)::numeric) > 0.01 or (x->3 <> 'null'::jsonb and (r->>'category')::int <> (x->>3)::int) then
      bad := bad + 1; bads := bads || format('%s exp %s/%s got %s/%s; ', x->>0, x->>2, x->>3, r->>'score', r->>'category');
    end if;
  end loop;
  t_name := t_name || text 'Scholarship score and category match VSAT-14 sheet for every counselled student'; t_pass := t_pass || (bad = 0 and n = 21); t_det := t_det || format('%s/%s %s', n - bad, n, left(bads, 400));
  r := public.vsat_calc_scholarship('{"vsat_pct":100,"class10_pct":100,"interview_score":5,"cs_passion":5,"class10_maths_pct":100}', 'pune', null);
  t_name := t_name || text 'Scholarship: perfect inputs → 100, category 1, steps 90/95/100 (Pune)'; t_pass := t_pass || ((r->>'score')::numeric = 100 and (r->>'category')::int = 1 and r->'award_steps' = '[90, 95, 100]'::jsonb); t_det := t_det || r::text;
  r := public.vsat_calc_scholarship('{"vsat_pct":65,"class10_pct":65,"interview_score":3.25,"cs_passion":3.25,"class10_maths_pct":65}', 'gurugram', null);
  t_name := t_name || text 'Scholarship: score exactly 65 → category 7 (lower edge included), steps 30/35/40 (Gurugram)'; t_pass := t_pass || ((r->>'score')::numeric = 65 and (r->>'category')::int = 7 and r->'award_steps' = '[30, 35, 40]'::jsonb); t_det := t_det || r::text;
  r := public.vsat_calc_scholarship('{"vsat_pct":80,"class10_pct":90,"interview_score":3,"cs_passion":2,"class10_maths_pct":85,"jee_pct":93.5}', 'pune', null);
  t_name := t_name || text 'Scholarship: JEE only → case jee_only, JEE floor 40, missing JEE Maths flagged'; t_pass := t_pass || (r->>'case' = 'jee_only' and (r->>'jee_floor')::numeric = 40 and r->'missing' ? 'jee_maths_pct'); t_det := t_det || r::text;
  t_name := t_name || text 'Scholarship: JEE floor steps 89.99→none, 90→30, 97→60, 98.5→70';
  t_pass := t_pass || (public.vsat_calc_scholarship('{"jee_pct":89.99}', 'pune', null)->'jee_floor' = 'null'::jsonb
                       and (public.vsat_calc_scholarship('{"jee_pct":90}', 'pune', null)->>'jee_floor')::numeric = 30
                       and (public.vsat_calc_scholarship('{"jee_pct":97}', 'pune', null)->>'jee_floor')::numeric = 60
                       and (public.vsat_calc_scholarship('{"jee_pct":98.5}', 'pune', null)->>'jee_floor')::numeric = 70);
  t_det := t_det || text '';
  begin perform public.vsat_calc_scholarship('{"vsat_pct":120}', 'pune', null); e := 'ACCEPTED'; exception when others then e := sqlstate || ' ' || sqlerrm; end;
  t_name := t_name || text 'Scholarship: a % above 100 is refused'; t_pass := t_pass || (e like '22023%'); t_det := t_det || e;
  begin perform public.vsat_calc_scholarship('{"vsat_pct":"90"}', 'pune', null); e := 'ACCEPTED'; exception when others then e := sqlstate || ' ' || sqlerrm; end;
  t_name := t_name || text 'Scholarship: text instead of a number is refused'; t_pass := t_pass || (e like '22023%'); t_det := t_det || e;
  begin perform public.vsat_calc_scholarship('{}', 'delhi', null); e := 'ACCEPTED'; exception when others then e := sqlstate || ' ' || sqlerrm; end;
  t_name := t_name || text 'Scholarship: unknown campus is refused'; t_pass := t_pass || (e like '22023%'); t_det := t_det || e;

  -- 5. Final scholarship % (JEE floor off by default = what the sheets actually did)
  r := public.vsat_calc_final_scholarship(25, 60, null, 'pune');
  t_name := t_name || text 'Final %: JEE floor OFF (default) → weightage kept (sheet: JEE 98.4, 25% stayed 25%)'; t_pass := t_pass || ((r->>'pct')::numeric = 25 and not (r->>'jee_floor_applied')::boolean); t_det := t_det || r::text;
  r := public.vsat_calc_final_scholarship(25, null, 5, 'gurugram');
  t_name := t_name || text 'Final %: special rating 5 and ≤30% → +10'; t_pass := t_pass || ((r->>'pct')::numeric = 35 and (r->>'bonus_applied')::boolean); t_det := t_det || r::text;
  r := public.vsat_calc_final_scholarship(35, null, 5, 'gurugram');
  t_name := t_name || text 'Final %: special rating 5 but above 30% → no bonus'; t_pass := t_pass || ((r->>'pct')::numeric = 35 and not (r->>'bonus_applied')::boolean); t_det := t_det || r::text;
  begin
    update public.vsat_campus_settings set jee_floor_enabled = true where campus = 'pune';
    r := public.vsat_calc_final_scholarship(25, 60, null, 'pune');
    t_name := t_name || text 'Final %: JEE floor ON → raised to 60'; t_pass := t_pass || ((r->>'pct')::numeric = 60 and (r->>'jee_floor_applied')::boolean); t_det := t_det || r::text;
    raise exception using errcode = 'ZDONE';
  exception when sqlstate 'ZDONE' then null;
  end;

  -- 6. Access: formulas and settings are not reachable from a browser
  t_name := t_name || text 'Browsers cannot call the formulas or read the settings tables';
  t_pass := t_pass || (not has_function_privilege('authenticated', 'public.vsat_calc_scholarship(jsonb,text,uuid)', 'execute')
                       and not has_function_privilege('anon', 'public.vsat_calc_vps(numeric,jsonb)', 'execute')
                       and not has_function_privilege('authenticated', 'public.vsat_has_role(text)', 'execute')
                       and not has_table_privilege('authenticated', 'public.vsat_scholarship_bands', 'select')
                       and not has_table_privilege('anon', 'public.vsat_team', 'select')
                       and has_function_privilege('authenticated', 'public.vsat_my_roles()', 'execute')
                       and not has_function_privilege('anon', 'public.vsat_my_roles()', 'execute'));
  t_det := t_det || text '';

  return query select a.n, a.p, a.d from unnest(t_name, t_pass, t_det) as a(n, p, d);
end $t$;

select test, coalesce(pass, false) as pass, detail from pg_temp.run_vsat_scoring_tests();
