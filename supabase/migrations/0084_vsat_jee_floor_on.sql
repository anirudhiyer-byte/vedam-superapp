-- 0084 · VSAT pipeline — JEE Mains floor switched on for both campuses
--
-- Decision (13 Nov 2026, Q9): JEE is not needed for admission on any campus; the JEE Mains
-- percentile counts only for scholarship. Sheet column BL ("Scholarship as per JEE Mains") sets a
-- minimum scholarship for 90+ percentile (90 → 30%, 93 → 40%, 95 → 50%, 97 → 60%, 98.5 → 70%).
-- In the sheets BL returns text ("30%"), so "Max Scholarship" (BM) never used it; the floor is now
-- applied as intended, on both campuses. vsat_calc_final_scholarship (0079) already handles it:
--   final % = max(step, floor) (+10 when the interview achievements score is 5 and that is ≤ 30%), max 100.
-- Data change only (vsat_campus_settings); no function changes.
-- Rollback: supabase/rollback/0084_vsat_jee_floor_on_down.sql.

update public.vsat_campus_settings
   set jee_floor_enabled = true, updated_at = now()
 where campus in ('pune', 'gurugram');
