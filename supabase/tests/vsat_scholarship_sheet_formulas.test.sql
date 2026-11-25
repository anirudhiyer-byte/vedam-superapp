-- VSAT scholarship engine = the formulas in sir's sheet (Phase 5 check, 25 Nov 2026) (STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the Supabase MCP.
-- The last statement returns one row per test: test | pass | detail.
--
-- Source: sir's master sheet, tabs "Selected For Counselling Pune / GGN" and "Buckets Pune / GGN". Each formula below
-- is copied from the sheet and compared with the engine (vsat_calc_scholarship + vsat_calc_final_scholarship):
--   A. Scholarship Score (column AC), all 4 cases: 12th + JEE, 12th only, JEE only, neither
--   B. Scholarship Category (column AF) at every band edge, both campuses (bands from the Buckets sheets)
--   C. JEE slab (Pune BL / GGN BM) and Max Scholarship (Pune BM / GGN BN): the higher of the bucket % and the JEE %,
--      +10 when achievements = 5 and that higher value is 30 % or less — every slab edge, both campuses
--   D. both campuses take the JEE slab, as both sheets do
-- The sample students themselves are checked in vsat_pune_band3_fix.test.sql. Only 2 of them have a JEE of 90+ or
-- achievements = 5, so C checks the rule itself on every edge.
--
-- Note: in the sheet, the JEE column returns text ("30%"), and Google Sheets' MAX skips text in a range, so in the
-- sheet itself the JEE % can never win. C follows what the formula is meant to do (and what sir said): the higher of the two.
--
-- Read-only: nothing is written.

create or replace function pg_temp.run_vsat_sheet_formula_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}'; s text; n int; k text;
begin
  -- A: column AC, copied from the sheet (N = VSAT %, Q = 10th %, R = 12th %, T = PI × 20, U = JEE, Z = JEE maths,
  --    AA = 10th maths, AB = 12th maths, W = CS × 20). 40 input sets per case, both campuses.
  for k in select unnest(array['both', '12th only', 'JEE only', 'neither']) loop
    t_name := t_name || ('A score = sheet column AC, case ' || k)::text;
    with g as (
      select i, c.campus,
             round((35 + (i * 7) % 65)::numeric, 2) nn, round((40 + (i * 11) % 60)::numeric, 2) q,
             case when k in ('both', '12th only') then round((45 + (i * 13) % 55)::numeric, 2) end r,
             round((1 + (i % 9) * 0.5)::numeric, 2) pi, round((1 + (i % 5))::numeric, 2) cs,
             case when k in ('both', 'JEE only') then round((30 + (i * 17) % 70)::numeric, 2) end u,
             case when k in ('both', 'JEE only') then round((20 + (i * 19) % 80)::numeric, 2) end z,
             round((40 + (i * 23) % 60)::numeric, 2) aa,
             case when k in ('both', '12th only') then round((35 + (i * 29) % 65)::numeric, 2) end ab
        from generate_series(1, 40) i cross join (values ('pune'), ('gurugram')) c(campus)),
    x as (
      select g.*, pi * 20 t, cs * 20 w,
             public.vsat_calc_scholarship(jsonb_strip_nulls(jsonb_build_object('vsat_pct', nn, 'class10_pct', q, 'class12_pct', r,
               'interview_score', pi, 'cs_passion', cs, 'jee_pct', u, 'jee_maths_pct', z, 'class10_maths_pct', aa, 'class12_maths_pct', ab)),
               g.campus, null) e
        from g),
    y as (
      select x.*, case
        when u is null and r is null then nn*0.25 + q*0.2 + t*0.35 + aa*0.1 + w*0.1
        when u is not null and r is not null then nn*0.15 + q*0.05 + aa*0.05 + ab*0.1 + r*0.1 + t*0.15 + u*0.2 + z*0.15 + w*0.05
        when r is not null and u is null then nn*0.2 + q*0.05 + r*0.2 + t*0.2 + ab*0.15 + aa*0.15 + w*0.05
        else nn*0.2 + q*0.05 + u*0.2 + z*0.15 + t*0.2 + aa*0.15 + w*0.05 end sheet
        from x)
    select count(*) filter (where round((e->>'score')::numeric, 4) is distinct from round(sheet, 4)),
           string_agg(format('%s #%s: sheet %s, engine %s', campus, i, round(sheet, 4), e->>'score'), '; ')
             filter (where round((e->>'score')::numeric, 4) is distinct from round(sheet, 4))
      into n, s from y;
    t_det := t_det || coalesce('differs (' || n || '): ' || left(s, 400), '80 of 80 match'); t_pass := t_pass || (n = 0);
  end loop;

  -- B: column AF — category from the Buckets sheet: score >= Min and < Max (category 1: <= 100). Every edge, both campuses.
  t_name := t_name || text 'B category = sheet column AF at every band edge (Pune + Gurugram)';
  with sheet(campus, category, mn, mx) as (values
    ('pune', 1, 95, 100), ('pune', 2, 90, 95), ('pune', 3, 85, 90), ('pune', 4, 80, 85),
    ('pune', 5, 75, 80), ('pune', 6, 70, 75), ('pune', 7, 65, 70), ('pune', 8, 0, 65),
    ('gurugram', 1, 95, 100), ('gurugram', 2, 90, 95), ('gurugram', 3, 85, 90), ('gurugram', 4, 80, 85),
    ('gurugram', 5, 75, 80), ('gurugram', 6, 70, 75), ('gurugram', 7, 65, 70), ('gurugram', 8, 0, 65)),
  sc as (select c.campus, v.x
           from (values ('pune'), ('gurugram')) c(campus)
          cross join unnest(array[0, 10, 50, 64.99, 65, 67.5, 69.99, 70, 74.99, 75, 79.99, 80, 84.99, 85, 89.99, 90, 94.99, 95, 99.99, 100]::numeric[]) v(x)),
  e as (select sc.*, public.vsat_calc_scholarship(jsonb_build_object('vsat_pct', x, 'class10_pct', x, 'class10_maths_pct', x,
                       'interview_score', x / 20, 'cs_passion', x / 20), sc.campus, null) e from sc),
  w as (select e.*, (select s2.category from sheet s2 where s2.campus = e.campus
                       and e.x >= s2.mn and (e.x < s2.mx or (s2.category = 1 and e.x <= s2.mx))) want from e)
  select count(*) filter (where (e->>'score')::numeric <> x or (e->>'category')::int is distinct from want),
         string_agg(format('%s score %s: sheet %s, engine %s', campus, x, want, e->>'category'), '; ')
           filter (where (e->>'score')::numeric <> x or (e->>'category')::int is distinct from want)
    into n, s from w;
  t_det := t_det || coalesce('differs (' || n || '): ' || left(s, 400), '40 of 40 match'); t_pass := t_pass || (n = 0);

  -- C: JEE slab + Max Scholarship, copied from the sheet:
  --    JEE  = IF(U="N/A",step, IF(U<90,step, 90–<93 → 30, 93–<95 → 40, 95–<97 → 50, 97–<98.5 → 60, >=98.5 → 70))
  --    Max  = IF(AND(ach=5, MAX(step, JEE) <= 30), MAX(step, JEE) + 10, MAX(step, JEE))
  t_name := t_name || text 'C JEE slab, higher of bucket and JEE %, +10 bonus = sheet (every edge, both campuses)';
  with grid as (
    select c.campus, u.u, st.st, a.ach
      from (values ('pune'), ('gurugram')) c(campus)
     cross join unnest(array[null, 0, 50, 89, 89.99, 90, 91.5, 92.99, 93, 94.99, 95, 96.18, 96.99, 97, 98.49, 98.5, 99.9, 100]::numeric[]) u(u)
     cross join unnest(array[5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 90, 100]::numeric[]) st(st)
     cross join unnest(array[null, 1, 2, 3, 4, 5]::int[]) a(ach)),
  e as (
    select grid.*,
           (public.vsat_calc_scholarship(jsonb_strip_nulls(jsonb_build_object('vsat_pct', 80, 'class10_pct', 80, 'class12_pct', 80,
              'interview_score', 3, 'cs_passion', 3, 'jee_pct', u, 'jee_maths_pct', 80, 'class10_maths_pct', 80, 'class12_maths_pct', 80)),
              grid.campus, null)->>'jee_floor')::numeric floor
      from grid),
  f as (
    select e.*,
           case when u is null or u < 90 then st when u < 93 then 30 when u < 95 then 40 when u < 97 then 50
                when u < 98.5 then 60 else 70 end sheet_jee
      from e),
  h as (
    select f.*,
           case when ach = 5 and greatest(st, sheet_jee) <= 30 then greatest(st, sheet_jee) + 10 else greatest(st, sheet_jee) end sheet_max,
           (public.vsat_calc_final_scholarship(st, floor, ach, campus)->>'pct')::numeric engine
      from f)
  select count(*) filter (where engine is distinct from sheet_max),
         string_agg(format('%s JEE %s step %s ach %s: sheet %s, engine %s', campus, coalesce(u::text, 'N/A'), st, coalesce(ach::text, '-'), sheet_max, engine), '; ')
           filter (where engine is distinct from sheet_max)
    into n, s from h;
  t_det := t_det || coalesce('differs (' || n || '): ' || left(s, 400),
                             format('%s of %s match', 2 * 18 * 17 * 6, 2 * 18 * 17 * 6)); t_pass := t_pass || (n = 0);

  -- D: both sheets apply the JEE slab, so both campuses must have it on
  t_name := t_name || text 'D JEE slab is on for Pune and Gurugram (as in both sheets)';
  select string_agg(c.campus, ', ') into s from public.vsat_campus_settings c
   where c.campus in ('pune', 'gurugram') and c.jee_floor_enabled is not true;
  select count(*) into n from public.vsat_campus_settings c where c.campus in ('pune', 'gurugram');
  t_det := t_det || coalesce('off for: ' || s, case when n = 2 then 'on for both' else 'campus row missing' end);
  t_pass := t_pass || (s is null and n = 2);

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, pass, detail from pg_temp.run_vsat_sheet_formula_tests();
