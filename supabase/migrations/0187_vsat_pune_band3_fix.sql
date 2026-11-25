-- 0187 · VSAT scholarship: Pune category 3 award range = sir's "Buckets Pune" sheet (60–70 %) — staging first.
--
-- 0079 seeded the default Pune category 3 band (score 85–90, 3 buckets) as 50–70 %. Sir's master sheet
-- ("Buckets Pune", row 4) says 60–70 %. Found in the Phase 5 check: 21 sample students from sir's sheet were run
-- through the engine; score and category matched for all 21, and the only % mismatch on Pune was this band
-- (score 86.746 → sheet 65 %, app 60 %). Owner's decision (25 Nov): use the sheet's 60–70 %.
--
-- Data only: the default Pune set (exam_date_id is null), category 3, and only while it still holds the 0079 values
-- (an admin's own edit is left alone). A VSAT with its own band set is not touched. Counselling forms already saved
-- keep the % they were saved with.
--
-- No settings-audit row: that log needs a signed-in admin (user_id not null); this file is the record.
--
-- Rollback: supabase/rollback/0187_vsat_pune_band3_fix_down.sql
-- Tests:    supabase/tests/vsat_pune_band3_fix.test.sql

update public.vsat_scholarship_bands b
   set min_award = 60
 where b.exam_date_id is null and b.campus = 'pune' and b.category = 3
   and b.min_score = 85 and b.max_score = 90 and b.steps = 3 and b.min_award = 50 and b.max_award = 70;
