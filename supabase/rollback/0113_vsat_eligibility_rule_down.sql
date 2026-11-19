-- Rollback for 0113 — restore the original eligibility calc (no per-subject floor, no 10th
-- upper bound) and the previous settings policy. Function body is byte-identical to pre-0113.

create or replace function public.vsat_calc_eligibility(p_year10 integer, p_year12 integer, p_physics numeric, p_chemistry numeric, p_maths numeric, p_rules jsonb)
returns jsonb language plpgsql immutable set search_path to '' as $function$
declare r jsonb := coalesce(p_rules, '{}'::jsonb); total numeric; c12 text; e10 boolean; e12 boolean;
begin
  total := coalesce(p_physics, 0) + coalesce(p_chemistry, 0) + coalesce(p_maths, 0);
  if p_year12 is not null and p_year12 = (r->>'pending_year')::int and total = 0 then c12 := 'yet_to_graduate';
  elsif p_year12 is not null and to_jsonb(p_year12) <@ coalesce(r->'class12_years', '[]'::jsonb)
        and total >= coalesce((r->>'pcm_min_total')::numeric, 150) then c12 := 'pass';
  else c12 := 'fail';
  end if;
  e10 := p_year10 is not null and p_year10 >= coalesce((r->>'min_year10')::int, 2023);
  e12 := p_year12 is not null and c12 <> 'fail'
         and p_year12 >= coalesce((select min(y::int) from jsonb_array_elements_text(r->'class12_years') y), 2025);
  return jsonb_build_object('class12', c12, 'class10_ok', e10, 'class12_ok', e12, 'eligible', e10 and e12, 'pcm_total', total);
end $function$;

update public.vsat_exam_settings
   set eligibility = jsonb_build_object(
         'min_year10', 2023, 'pending_year', 2026,
         'class12_years', jsonb_build_array(2025, 2026),
         'pcm_min_total', 150)
 where id = 1;
