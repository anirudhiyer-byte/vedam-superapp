-- Rollback of 0187_vsat_pune_band3_fix: the default Pune category 3 band back to 0079's 50–70 %,
-- only while it still holds 0187's 60–70 % (an admin's later edit is left alone).

update public.vsat_scholarship_bands b
   set min_award = 50
 where b.exam_date_id is null and b.campus = 'pune' and b.category = 3
   and b.min_score = 85 and b.max_score = 90 and b.steps = 3 and b.min_award = 60 and b.max_award = 70;
