# VSAT Exam table and Exam Evaluation (Phase 2, migration 0172)

From the owner's review (24 Nov 2026):

- every column of the "14th July" sheet, and the test marks of the "Test Result" sheet, must be on the VSAT Exam
  table, not only inside the student drawer;
- an **Exam Evaluation** page under VSAT Exam, one VSAT at a time, that copies the Test Result sheet's tables exactly;
- after the cut-off is decided, a way to raise one student by hand so the stage follows.

## For admissions and admins

### VSAT Exam table

Opens with the sheet's columns, left to right: Form name, App no., First name, Last name, Email, Mobile, Gender, Date of
birth, Guardian's mobile, Residing city, Campus applied, Country, State, City, Class 10 / 12 year, Class 12 marking
scheme, Class 12 % ("Score / Slabs"), Studied PCM, JEE registered / appeared / score / percentile / maths percentile,
Physics / Chemistry / Maths (12), Class 10 score, Class 10 %, Class 10 maths %, User ID, 12th result, 10th / 12th
eligible, Eligible, Proctoring, Maths / Logical reasoning / CS, Exam marks, Percentile, Exam %. Then the Test Result
sheet: Wheebox login, Test name, Test start, Test end, Total questions, Attempted, Correct, Incorrect, Unattempted,
Exam max marks, Time taken, VPS.

- **First name / Last name**: our form asks the full name once, so the name is split at the first space.
- **User ID**: the student's Vedam One user id (the sheet's NPF "User Id").
- **Test columns** come from the student's latest real (not mock) Wheebox result. Wheebox sends no "Status" or
  "Submit By", so those two sheet columns are not shown. "Time taken" = test end − test start.
- Everyone opens on this new default once (a column choice saved before is set aside). **Columns** still changes it.
- The results analysis is no longer a card on this page: a line links to Exam Evaluation.

### Exam Evaluation (sidebar → VSAT process → Exam Evaluation)

Same people as VSAT Exam (admins and admissions; campus-limited admissions see their campus only).

| Part | What it shows | As in the sheet |
|---|---|---|
| Results | Booked, took the test, disqualified, not disqualified, Average, percentile above 70 | Average and "> 70" count every taker (AF2:AG3) |
| Highest / mean / lowest | Score % and percentile of every taker | added on top |
| Marks slab | 0–20, 20–40, 40–60, 60–80, 80+ (by percentile) | not disqualified (AF6:AG11) |
| Male / Female | counts and female : male | not disqualified (AF13:AG14) |
| Overall / ADYPU Pune / Gurugram Campus | Male, Female, Total at 35, 60 and 65 % and above, with the VPS at each | not disqualified (AF17:AK33) |
| Cut-off | pick 35 / 60 / 65 or another percentile → count, VPS, female : male → **Select for PI** (admins) | Select for PI as before (0135): moves them to VSAT cleared and saves the VSAT's VPS cut-off |
| Below the cut-off | admins: students below the saved cut-off, still waiting → **Raise** | new |

Checked against the sheet: the 32 students of "Test Result" (VSAT 14 July) give exactly the sheet's numbers
(Average 75.84375, > 70 = 24, slabs 0 / 4 / 1 / 8 / 18, Male 24 / Female 7, and every cell of the three tables) —
`supabase/tests/vsat_exam_evaluation.test.sql`, section A.

**Pull test results** (admins) fetches every student's real-exam result for the chosen VSAT from Wheebox, the same as
Exam Center → Exam dates → Pull results (one shared helper, `src/lib/vsat/pull-results.ts`).

**Raise** (admins): a new VPS (at least the cut-off) and a reason. In one step the VPS is saved as an override (the
calculated VPS stays on record next to it) and the student moves to **VSAT cleared**; the history says
"Raised by hand · VSAT · VPS x (cut-off y) · reason". Refused unless the VSAT's cut-off is decided, the student has a
result, is not disqualified, is active, is before VSAT cleared and is not marked ineligible.

## Database (0172)

- `vsat__exam_sheet_cols` (private): first / last name, user id and the Wheebox test fields for one row; the grid calls
  it only when one of those columns is asked for. Index `vsat_exam_results_app_idx`.
- `vsat__grid_catalog` / `vsat__grid` (0165 bodies, md5 checked): 12 new virtual columns (not filterable). Nothing
  else in the grid changes.
- `vsat_exam_analysis` (0135 body, md5 checked): also `not_disqualified`, `max_percentage` / `min_percentage`,
  `max_percentile` / `min_percentile`.
- `vsat_exam_below_cutoff(p)` and `vsat_exam_raise(p)`: admins only, security definer, empty search_path, every request
  key checked. New error codes: `NO_CUTOFF`, `NO_RESULT`, `DISQUALIFIED`, `NOT_ACTIVE`, `ALREADY_SELECTED`,
  `NOT_ELIGIBLE`, `BELOW_CUTOFF`.

On staging the three existing functions were patched in place with the same replacements as the file, then every
function's md5 was compared with the file (all six equal).

## Tests

- DB: `supabase/tests/vsat_exam_evaluation.test.sql` (45). Re-run after the change: `vsat_grid` (76),
  `vsat_exam_results_pi` (57), `vsat_grid_meet_link` (18).
- Rollback `supabase/rollback/0172_vsat_exam_evaluation_down.sql` tested on staging inside an undone block: down →
  the three bodies equal the 0165 / 0135 md5, grants unchanged, helper / RPCs / index gone → staging back on 0172.
- Unit: `src/lib/vsat/exam-evaluation.test.ts`, `src/lib/vsat/pull-results.test.ts` (+ `grid.test.ts` unchanged).

## Production release (only with the owner's OK)

After 0165 (grid) and 0135 (exam results): apply **0172** by name (`0172_vsat_exam_evaluation`). No settings, no env.
