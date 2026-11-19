-- 0113 · VSAT eligibility rule — per-subject floor + 10th-year upper bound + 2026/2027 years.
--
-- New rule (per the admissions owner): eligible when
--   • 10th cleared between 2023 and 2025 (adds an UPPER bound; was only "≥ 2023")
--   • 12th in 2026 or 2027
--   • each of Physics / Chemistry / Maths ≥ 50%   (NEW per-subject floor)
--   • PCM overall ≥ 50% (pcm_min_total 150, unchanged)
-- Students whose 12th results aren't out yet (pending_year) stay "yet_to_graduate" and are
-- NOT failed by the per-subject floor (that branch is checked first).
--
-- The calc function gains two optional rule keys — max_year10 and pcm_min_each — that default
-- to OFF (no upper bound / 0 floor) when absent, so the function change is backward-compatible;
-- the settings row below turns them on. vsat_exam_settings.eligibility is updated to the new
-- policy (10th 2023–2025, 12th 2026/2027, each ≥ 50, total ≥ 150, pending 2027).
-- Rollback: supabase/rollback/0113_vsat_eligibility_rule_down.sql

create or replace function public.vsat_calc_eligibility(p_year10 integer, p_year12 integer, p_physics numeric, p_chemistry numeric, p_maths numeric, p_rules jsonb)
returns jsonb language plpgsql immutable set search_path to '' as $function$
declare
  r jsonb := coalesce(p_rules, '{}'::jsonb); total numeric; c12 text; e10 boolean; e12 boolean;
  v_each numeric := coalesce((r->>'pcm_min_each')::numeric, 0);  -- per-subject floor; 0 = off
  v_each_ok boolean;
begin
  total := coalesce(p_physics, 0) + coalesce(p_chemistry, 0) + coalesce(p_maths, 0);
  v_each_ok := coalesce(p_physics, 0) >= v_each and coalesce(p_chemistry, 0) >= v_each and coalesce(p_maths, 0) >= v_each;
  if p_year12 is not null and p_year12 = (r->>'pending_year')::int and total = 0 then c12 := 'yet_to_graduate';
  elsif p_year12 is not null and to_jsonb(p_year12) <@ coalesce(r->'class12_years', '[]'::jsonb)
        and total >= coalesce((r->>'pcm_min_total')::numeric, 150)
        and v_each_ok then c12 := 'pass';
  else c12 := 'fail';
  end if;
  e10 := p_year10 is not null and p_year10 >= coalesce((r->>'min_year10')::int, 2023)
         and p_year10 <= coalesce((r->>'max_year10')::int, 2025);
  e12 := p_year12 is not null and c12 <> 'fail'
         and p_year12 >= coalesce((select min(y::int) from jsonb_array_elements_text(r->'class12_years') y), 2025);
  return jsonb_build_object('class12', c12, 'class10_ok', e10, 'class12_ok', e12, 'eligible', e10 and e12, 'pcm_total', total);
end $function$;

-- policy: 10th 2023–2025, 12th 2026/2027, each PCM ≥ 50, total ≥ 150, pending (results not out) = 2027
update public.vsat_exam_settings
   set eligibility = jsonb_build_object(
         'min_year10', 2023, 'max_year10', 2025,
         'class12_years', jsonb_build_array(2026, 2027),
         'pending_year', 2027,
         'pcm_min_total', 150, 'pcm_min_each', 50)
 where id = 1;
