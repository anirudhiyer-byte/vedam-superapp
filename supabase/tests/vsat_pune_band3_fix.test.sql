-- VSAT scholarship · Pune category 3 band = sir's sheet (60–70 %) — tests for migration 0187 (STAGING ONLY)
--
-- How to run: paste this whole file into the staging SQL editor, or run it through the Supabase MCP.
-- The last statement returns one row per test: test | pass | detail.
--
-- A. the default Pune bands equal sir's "Buckets Pune" sheet · B. the Gurugram bands equal "Buckets GGN" (unchanged)
-- C. sir's sample students: score, category, bucket % and final % as in the sheet (Pune all 10; Gurugram the 6 that
--    follow the bucket rule — the other 5 were typed by hand in the sheet, owner's decision 25 Nov: keep the rule + ±5)
--
-- Read-only: nothing is written.

create or replace function pg_temp.run_vsat_pune_band3_tests()
returns table (test text, pass boolean, detail text) language plpgsql as $$
declare t_name text[] := '{}'; t_pass boolean[] := '{}'; t_det text[] := '{}'; s text; k text;
begin
  -- A / B: category, min score, max score, buckets, min award, max award — as in the sheets
  for k in select 'A' union all select 'B' loop
    t_name := t_name || (case k when 'A' then 'A default Pune bands = sir''s "Buckets Pune" sheet' else 'B default Gurugram bands = sir''s "Buckets GGN" sheet' end)::text;
    with sheet(campus, category, mn, mx, st, a0, a1) as (values
      ('pune', 1, 95, 100, 3, 90, 100), ('pune', 2, 90, 95, 3, 75, 85), ('pune', 3, 85, 90, 3, 60, 70), ('pune', 4, 80, 85, 2, 50, 55),
      ('pune', 5, 75, 80, 2, 35, 45), ('pune', 6, 70, 75, 2, 30, 35), ('pune', 7, 65, 70, 3, 15, 25), ('pune', 8, 0, 65, 2, 5, 10),
      ('gurugram', 1, 95, 100, 2, 95, 100), ('gurugram', 2, 90, 95, 2, 85, 90), ('gurugram', 3, 85, 90, 2, 75, 80), ('gurugram', 4, 80, 85, 2, 65, 70),
      ('gurugram', 5, 75, 80, 2, 55, 60), ('gurugram', 6, 70, 75, 2, 45, 50), ('gurugram', 7, 65, 70, 3, 30, 40), ('gurugram', 8, 0, 65, 5, 5, 25)),
    want as (select * from sheet where campus = case k when 'A' then 'pune' else 'gurugram' end),
    have as (select b.campus, b.category, b.min_score mn, b.max_score mx, b.steps st, b.min_award a0, b.max_award a1
               from public.vsat_scholarship_bands b where b.exam_date_id is null and b.campus = case k when 'A' then 'pune' else 'gurugram' end)
    select string_agg(coalesce(w.category, h.category)::text, ',') into s
      from want w full join have h on h.category = w.category
     where w.category is null or h.category is null or (w.mn, w.mx, w.st, w.a0, w.a1) is distinct from (h.mn, h.mx, h.st, h.a0, h.a1);
    t_det := t_det || coalesce('differs: ' || s, 'all 8 categories match'); t_pass := t_pass || (s is null);
  end loop;

  -- C: sir's sample students (sheet "Selected For Counselling Pune / GGN": inputs N, Q, R, S, V, U, Z, AA, AB; achievements BQ / BR)
  t_name := t_name || text 'C sir''s sample students: score, category, bucket % and final % equal the sheet';
  with smp(campus, r, inp, score, cat, step, fin, ach) as (values
    ('pune', 2, '{"vsat_pct":82,"class10_pct":91,"class12_pct":81,"interview_score":2.15,"cs_passion":2,"jee_pct":89,"jee_maths_pct":64,"class10_maths_pct":80,"class12_maths_pct":67}'::jsonb, 71.5, 6, 30, 40, 5),
    ('pune', 3, '{"vsat_pct":91,"class10_pct":94.4,"class12_pct":83.6,"interview_score":2.4,"cs_passion":2,"jee_pct":77,"jee_maths_pct":33,"class10_maths_pct":95,"class12_maths_pct":63}', 67.33, 7, 20, 20, 2),
    ('pune', 4, '{"vsat_pct":92.5,"class10_pct":74,"class12_pct":61.4,"interview_score":2.95,"cs_passion":2,"jee_pct":44,"jee_maths_pct":78,"class10_maths_pct":69,"class12_maths_pct":46}', 63.115, 8, 10, 10, 4),
    ('pune', 5, '{"vsat_pct":80,"class10_pct":94.8,"class12_pct":72,"interview_score":2.8,"cs_passion":2,"jee_pct":70,"jee_maths_pct":78,"class10_maths_pct":91,"class12_maths_pct":72}', 71.79, 6, 30, 30, 4),
    ('pune', 6, '{"vsat_pct":80,"class10_pct":87,"class12_pct":97,"interview_score":3.4,"cs_passion":1,"jee_pct":49,"jee_maths_pct":56.5,"class10_maths_pct":75,"class12_maths_pct":70}', 66.275, 7, 15, 15, 3),
    ('pune', 7, '{"vsat_pct":69.5,"class10_pct":92.2,"class12_pct":83,"interview_score":2.65,"cs_passion":2,"jee_pct":null,"jee_maths_pct":null,"class10_maths_pct":92,"class12_maths_pct":72}', 72.31, 6, 30, 30, 1),
    ('pune', 8, '{"vsat_pct":87.5,"class10_pct":93,"class12_pct":86,"interview_score":3.55,"cs_passion":3,"jee_pct":null,"jee_maths_pct":null,"class10_maths_pct":96,"class12_maths_pct":80}', 82.95, 4, 55, 55, 3),
    ('pune', 9, '{"vsat_pct":85,"class10_pct":95,"class12_pct":0.8897,"interview_score":4,"cs_passion":4,"jee_pct":null,"jee_maths_pct":null,"class10_maths_pct":99,"class12_maths_pct":75}', 68.0279, 7, 20, 20, 3),
    ('pune', 10, '{"vsat_pct":56.5,"class10_pct":93.2,"class12_pct":62,"interview_score":2.35,"cs_passion":1,"jee_pct":null,"jee_maths_pct":null,"class10_maths_pct":92,"class12_maths_pct":67}', 62.61, 8, 10, 10, 2),
    ('pune', 11, '{"vsat_pct":70,"class10_pct":96,"class12_pct":98,"interview_score":3.6,"cs_passion":2,"jee_pct":96.18,"jee_maths_pct":97.4,"class10_maths_pct":100,"class12_maths_pct":100}', 86.746, 3, 65, 65, 3),
    ('gurugram', 2, '{"vsat_pct":65,"class10_pct":85.2,"class12_pct":64,"interview_score":2.95,"cs_passion":2,"jee_pct":61,"jee_maths_pct":55,"class10_maths_pct":59,"class12_maths_pct":49}', 59.56, 8, 25, 25, 3),
    ('gurugram', 3, '{"vsat_pct":74,"class10_pct":56.8,"class12_pct":47,"interview_score":2.2,"cs_passion":3,"jee_pct":33,"jee_maths_pct":55,"class10_maths_pct":52,"class12_maths_pct":0}', 45.69, 8, 20, 20, 2),
    ('gurugram', 5, '{"vsat_pct":95,"class10_pct":71.66,"class12_pct":62,"interview_score":1.8,"cs_passion":1,"jee_pct":69.33,"jee_maths_pct":55,"class10_maths_pct":63,"class12_maths_pct":48}', 60.499, 8, 25, 25, 1),
    ('gurugram', 8, '{"vsat_pct":75,"class10_pct":90.2,"class12_pct":73,"interview_score":3.55,"cs_passion":3,"jee_pct":61,"jee_maths_pct":49,"class10_maths_pct":88,"class12_maths_pct":72}', 67.86, 7, 35, 35, 3),
    ('gurugram', 9, '{"vsat_pct":77.5,"class10_pct":83,"class12_pct":79,"interview_score":3,"cs_passion":1,"jee_pct":null,"jee_maths_pct":null,"class10_maths_pct":45,"class12_maths_pct":44}', 61.8, 8, 25, 25, 3),
    ('gurugram', 10, '{"vsat_pct":95,"class10_pct":90,"class12_pct":80,"interview_score":2.45,"cs_passion":2,"jee_pct":null,"jee_maths_pct":null,"class10_maths_pct":95,"class12_maths_pct":88}', 78.75, 5, 60, 60, 1)),
  c as (select smp.*, public.vsat_calc_scholarship(smp.inp, smp.campus, null) e from smp)
  select string_agg(campus || ' row ' || r || format(' (score %s/%s cat %s/%s step %s/%s final %s/%s)', score, round((e->>'score')::numeric, 4),
                    cat, e->>'category', step, e->>'auto_step', fin,
                    public.vsat_calc_final_scholarship((e->>'auto_step')::numeric, (e->>'jee_floor')::numeric, ach, campus)->>'pct'), '; ') into s
    from c
   where round((e->>'score')::numeric, 4) <> score or (e->>'category')::int <> cat or (e->>'auto_step')::numeric <> step
      or (public.vsat_calc_final_scholarship((e->>'auto_step')::numeric, (e->>'jee_floor')::numeric, ach, campus)->>'pct')::numeric <> fin;
  t_det := t_det || coalesce('differs: ' || s, '16 of 16 match'); t_pass := t_pass || (s is null);

  return query select x.n, x.p, x.d from unnest(t_name, t_pass, t_det) as x(n, p, d);
end $$;

select test, pass, detail from pg_temp.run_vsat_pune_band3_tests();
