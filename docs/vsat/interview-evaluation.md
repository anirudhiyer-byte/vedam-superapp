# Interview form, Interview table and Interview Evaluation (Phase 3, migration 0173)

From the owner's review (24 Nov 2026):

- the interview form must be an exact copy of sir's Google Form: every question, a mark and a remark for each part,
  "Why should Vedam accept your application…", and **no verdict from the interviewer**;
- every answer, mark and remark is its own column in the Interview table (the "Interview Responses" sheet);
- an **Interview Evaluation** page, one VSAT at a time: weighted score, highest / mean / lowest, how many in each range;
- on that page the "Selected" and "Maybe" scores are set; the verdict then shows in the Interview table;
- admissions moves the student to **PI cleared** by hand, and the student gets the PI-cleared email.

Not in this phase: the question bank with a timer (waits on sir's decision).

## For interviewers

The student drawer → **Interview form** asks the Google Form's questions in its order. Every question is required, as
in the form:

1. Communication & Behavioral Skills (1–5, with the form's 1 / 3 / 5 help) → remark
2. Guesstimate & Logical Reasoning (1–5) → *Did you find the student cheating while solving questions?*
   (No / *Yes, and hence Reject Straight Away*) → remark
3. Passion & Motivation for Computer Science (1–5, with the 1–5 help) → *Is this student a possible coding talent?…* → remark
4. Achievements & Extracurricular Activities (1–5, with the 1–5 help) → *If the student is a national-level certificate
   holder…* → remark
5. Why This Program? (1–5, with the 1 / 3 / 5 help) → remark
6. Drop year, previous year's JEE percentile, JEE Mains percentile, JEE Mains maths percentile, expected JEE percentile,
   other exam score, Class 12 / 11 / 10 % — numbers are 0–100 or **N/A**
7. Financial capability (High / Medium / Low, with the form's descriptions) → why
8. Why should Vedam accept your application and what could the batch learn from you?

Wording: the questions are sir's, with small grammar fixes only (e.g. "Did you find the student cheating while solving
questions?", "basic etiquettes"). The form has no "overall remarks" question, so there is none here.

Submitting saves the form once (the database refuses a second submit). The stage does not change. The reply shows the
weighted score, the final score and the verdict if the VSAT's scores are already decided.

## For admissions and admins

### Interview table

Opens with the booking columns (student, campus, VSAT, stage, interviewer, slot, Meet, status, reschedules), then the
sheet's columns in its order: form submitted (IST), app no., the five marks each with its remark, cheating, coding
talent, certificate asked, drop year, previous JEE, JEE / JEE maths / expected JEE percentile, other exams, Class 12 /
11 / 10 %, financial capability and why, **Verdict**, why Vedam should accept, weighted score (out of 5) and **final
score (out of 20)**. Everyone opens on this new default once (a column choice saved before is set aside).

- **Verdict** and **Final score** can be filtered (e.g. Verdict = Selected), so the selected students can be picked and
  moved to PI cleared with the selection bar.
- The interviewer's old verdict and the old "lowest part" verdict columns are gone.
- A line on top links to Interview Evaluation (admins and admissions).

### Interview Evaluation (sidebar → VSAT process → Interview Evaluation)

Admins and admissions (campus-limited admissions see their campus only). Interviewers don't see it.

| Part | What it shows |
|---|---|
| Numbers | booked, interviewed (form submitted), form not submitted yet, cheating, average final score |
| Weighted score | highest · mean · lowest (out of 5) |
| Final score table | Everyone / Selected / Maybe / Rejected × students, average, highest, lowest, median (out of 20) |
| Verdict scores | "Selected from" and "Maybe from" (final score, 0–20). **Show counts** previews the ranges without saving; **Save verdicts** (admins) saves them |
| Students | everyone interviewed, highest final score first: interviewer, weighted, final, cheating, saved verdict, the verdict with the scores in the boxes, stage |

The sheet's formulas: weighted score = the five marks × the weights in force on the interview day (from 1 Apr 2026:
.25 / .25 / .20 / .15 / .15); final score = weighted × 4.

The verdict rule (the same in the page and the database): cheating → **Rejected**; final score ≥ Selected score →
**Selected**; ≥ Maybe score → **Maybe**; otherwise **Rejected**. Before the scores are saved, a student has no verdict
("Not decided yet") unless cheating was seen.

**Save verdicts** saves both scores on the VSAT and gives every interviewed student of that VSAT (latest interview of
the current attempt, not cancelled) their verdict. It is logged in the settings audit (area `vsat`, the VSAT's id).
Students interviewed later get their verdict from these scores when their form is submitted. No stage changes.

### PI cleared → email

Moving a student to **PI cleared** (drawer **Move**, or the selection bar) queues one email for that student and attempt.
It is sent straight away (the "send now" route) and otherwise by the VSAT cron within 10 minutes. The email goes only if
the student is still PI cleared and active at sending time.

The step is in *VSAT → Comms → PI cleared → student*: **off and in test mode** like every other new step. Placeholders:
`{{name}}`, `{{application_no}}`, `{{dashboard_link}}`. The draft copy says the next step is counselling; sir's final
wording comes with the other templates.

## Database (0173)

- New columns: `interview_assignments.verdict` (selected / maybe / not_selected), and on `vsat_exam_dates`
  `interview_select_min`, `interview_maybe_min` (both or neither, 0–20, Maybe ≤ Selected), `interview_verdicts_at`,
  `interview_verdicts_by`.
- `vsat__interview_verdict` (private, immutable): the verdict rule.
- `vsat_interview_analysis(p)` — admins and admissions (campus scope); keys `exam_date_id`, `select_min` + `maybe_min`
  (a preview, both or neither).
- `vsat_interview_set_verdicts(p)` — admins only; same keys, both required.
- `vsat_submit_interview` (0166 body, patched): the verdict when the VSAT's scores are decided; `interview_result_1/2`
  now carry that verdict. `result` and `calc_verdict` keep their 0166 meaning.
- `vsat__grid_catalog` / `vsat__grid` / `vsat__grid_virt_expr` (0172 / 0135 bodies, patched): 27 interview columns;
  Verdict and Final score filterable; the two old verdict columns removed.
- `vsat_profile_start` (0085 body): "Final Verdict" = the new verdict, else the older form's verdict.
- PI-cleared email outbox: table `vsat_stage_notices` (RLS on, no policies, no browser access), trigger
  `vsat_stage_notice` on `vsat_pipeline`, `vsat_stage_notices_claim` / `vsat_stage_notice_done` (service role only),
  comms step `pi_cleared`.

All functions: security definer, empty search_path, every request key checked, revoked from public / anon.

On staging the five existing functions were patched in place with the same replacements as the file, then every
function's md5 was compared with the file (all eleven equal).

## Tests

- DB: `supabase/tests/vsat_interview_evaluation.test.sql` (36): the rule, submit, analysis, saving verdicts, grid
  columns and filters, the PI-cleared queue, the profile's Final Verdict, access. Re-run after the change:
  `vsat_manual_stages` (25), `vsat_pipeline_panels` (40), `vsat_profile_analyser` (29).
- Rollback `supabase/rollback/0173_vsat_interview_evaluation_down.sql` tested on staging inside an undone block: down →
  the five bodies equal the 0172 / 0135 / 0166 / 0085 md5, grants unchanged, new functions / table / trigger / step /
  columns gone → staging back on 0173.
- Unit: `src/lib/vsat/interview-form.test.ts`, `interview-evaluation.test.ts`, `stage-notices.test.ts`,
  `stage-notices-client.test.ts`, `grid-interview.test.ts`.

## Production release (only with the owner's OK)

After 0172 (Exam Evaluation) and 0166 (stages by hand): apply **0173** by name (`0173_vsat_interview_evaluation`; on
staging it went in as `vsat_interview_evaluation` + two small fixes, all inside the one file). No env. Then, when sir's
wording is in, turn on *PI cleared → student* in VSAT → Comms and take it off test mode.

Note: the repo now has two 0172 files (`0172_partner_materialize`, a teammate's, and `0172_vsat_exam_evaluation`), as it
has two 0169 files, so release by name.
