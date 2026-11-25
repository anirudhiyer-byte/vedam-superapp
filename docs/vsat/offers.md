# VSAT offers — release, email, lapse (Phase 3, migration 0144)

## What was wrong before

Nothing in the app filled `application_manager.offer_released_at` / `offer_expires_at`. Moving a student to
**Offer sent** only changed the stage, so:

- the enrollment fee route (`/api/payments/enroll-create-order`, gate `offerPayable` in
  `src/lib/payments/enroll-fee.ts`) answered `no_offer`;
- the student dashboard never showed the offer;
- **Offer cancelled** did not stop the fee (the gate reads `offer_cancelled`, which nothing set).

Only the staging dummy seed (`scripts/staging/seed-vsat-pipeline-dummy.sql`) filled those columns.

## How it works now

| What | Where |
|---|---|
| Release | Counselling panel → select students at **Counselled** → **Release offer** → preview (deadline, who is left out) → **Yes, release**. Also from the student drawer (Offer box). |
| What releasing does | The student moves to **Offer sent**. A trigger on `vsat_pipeline` (`vsat__on_offer_stage`) fills the offer: released now, deadline, `offer_cancelled = false`, `offer_status = 'released'` (+ the old columns `offer_released_date`, `offer_expiry_date`, `offer_pay_timeline_days`), and queues the offer email. |
| Deadline | Campus **Days to pay** (VSAT settings → campus, `vsat_campus_settings.offer_days`), until **11:59:59 pm IST** of that day. Released on 23 Nov with 5 days → pay by 28 Nov, 11:59 pm IST. |
| Needs | The scholarship % saved by **Save counselling** (`vsat_submit_counselling`). Without it the move is refused: "Save the counselling first: the offer needs the scholarship %." |
| Other paths | Move stage (drawer) and the bulk move do exactly the same (same trigger). |
| Lapse | pg_cron job `vsat-offer-lapse` (minutes 7, 22, 37, 52 of every hour) moves **Offer sent** (active) students past the deadline, fee not paid, to **Offer lapsed** (history: "The offer deadline passed", by the system). On hold students are left alone. |
| Paid late | A fee paid after the lapse (the payment was started before the deadline: the order route refuses expired offers) still moves the student to **Enrolled**. |
| Re-open a lapsed offer | Drawer → Move stage → **Offer sent**, with a reason. The offer is issued again with a new deadline and a new email. |
| Cancel | Move to **Offer cancelled**, or back to an earlier stage → `offer_cancelled = true` → the fee can't be paid. |
| Back into Offer sent before the deadline | Nothing changes (same deadline, no new email). |
| Email | VSAT comms → **Offer released → student** (email only; OFF and in test mode until an admin turns it on). Sent straight after a release (`/api/vsat/offers/notify`) and by the VSAT cron (`/api/cron/vsat-interviews`, every 10 minutes, production only). An email for an offer that is no longer current (cancelled, re-issued, past the deadline) is never sent. With the step off, jobs are closed as skipped (no late emails when it is turned on). |
| History | `vsat_offer_events` (release / lapse / cancel; who, when, %, deadline). Server only. |

Placeholders for the offer email: `{{name}}` (first name), `{{student_name}}`, `{{application_no}}`,
`{{campus}}` (Pune / Gurugram), `{{scholarship}}` (e.g. 37.5), `{{amount}}` (enrollment fee, e.g. 50,000),
`{{deadline_date}}` (Sat, 28 Nov 2026), `{{deadline_time}}` (11:59 pm), `{{offer_days}}` (days the offer is
valid, e.g. 2), `{{dashboard_link}}`. Since 0156 the email has the admissions team's wording and carries the
Acceptance Letter (below).

## Acceptance Letter (PDF, migration 0156)

| What | Where |
|---|---|
| The letter | 4 pages like the approved samples (letterhead, letter, fee table, refund policy, T&C, signature lines). Drawn on demand by `src/lib/vsat/offer-letter-pdf.ts` (pdfkit, Nunito Sans with ₹, logo in `src/lib/vsat/offer-letter-assets/`). Never stored. |
| Personalised | Name, campus, university, degree, campus address, scholarship (total and Year 1), days the offer is valid, and the fee table. |
| Fee table | Seat blocking amount and deposit as they are; each of the 8 semesters shows Course fee, Scholarship and Amount payable. Scholarship = scholarship % × campus programme fee (VSAT settings), split equally over the 8 semesters (whole rupees). Year 1 = semesters 1 + 2. 0% → the plain 3-column table. Gurugram keeps the semester amounts of its sample letter (decided 23 Nov 2026). |
| Content per season | `src/lib/vsat/offer-letter.ts` (`SEASON`, `CAMPUS_LETTER`): class of, due dates, joining, semester amounts, university text. Now the class of 2027 (fee 2027 - 2031; the sample letters' dates moved one year on). No MacBook line (not given any more). Update once a season, with its tests. |
| Days valid | The campus **Days to pay** (Pune 2, Gurugram 5 — set in VSAT settings). The same number is in the email, the letter, the table's seat-blocking due date and the auto-lapse. |
| Email | Attached to **Offer released → student** (file `Acceptance_Letter_<NAME>.pdf`). If it cannot be drawn, the email is not sent and the job is marked failed (retried). |
| Student | Dashboard → offer card (and the Enrolled card) → **Download your Acceptance Letter (PDF)**. |
| Admin / admissions | Student drawer → Offer box → **Download Acceptance Letter (PDF)** (any released offer on a campus they manage). |
| Route | `GET /api/vsat/offer-letter` (student's own) or `?application_id=…` (admin). Who sees what is decided by `vsat_offer_letter(p)` in the database. |

Tests: `src/lib/vsat/offer-letter.test.ts`, `src/lib/vsat/offer-sync.test.ts`, `src/app/api/vsat/offer-letter/route.test.ts`,
DB `supabase/tests/vsat_offer_letter.test.sql` (18 tests). Rollback `supabase/rollback/0156_vsat_offer_letter_down.sql`
(tested on staging inside one transaction).

## Last-day reminder and lapsed email (migration 0157)

> **Replaced by 0189:** the last-day reminder below was replaced by sir's two reminders (see Phase 6). The lapsed email is unchanged.

| What | Where |
|---|---|
| Reminder | VSAT comms → **Offer: last day reminder → student**. One email at **10:00 am IST on the offer's last day** (the deadline is 11:59 pm IST that day), only if the student is still at Offer sent (active, not on hold), the offer is not cancelled and the enrollment fee is not paid. Not sent for an offer released after 10 am on its last day. One per offer: a re-issued offer gets its own. Queued by pg_cron job `vsat-offer-remind` (minutes 1, 16, 31, 46), sent by the same offer job as the release email. |
| Lapsed email | VSAT comms → **Offer lapsed → student**. One email when the student moves to Offer lapsed (by the lapse job or by hand). Not sent if the fee was paid after all (Enrolled) or the offer was re-opened before it went out. Lapses from before 0157 get no email. |
| Steps | Both OFF and in test mode until an admin turns them on; email only; the same placeholders as the offer email. The copy is a draft for the admissions team. Neither carries the Acceptance Letter (the student can download it from the dashboard). |
| Each step on its own | The offer email, the reminder and the lapsed email follow only their own step: turning one on does not send the others. |

Tests: `supabase/tests/vsat_offer_reminders.test.sql` (23, staging), `src/lib/vsat/offer-sync.test.ts`.
`vsat_offer_release.test.sql` now expects the lapse event to queue an email (it expected none before 0157).
Rollback `supabase/rollback/0157_vsat_offer_reminders_down.sql` (tested on staging: down → the 0144 functions,
grants, constraints and steps exactly as before → rolled back).

## Phase 6 — the offer letter as sir asked (migration 0189)

From sir's review (24 Nov 2026) and the owner's decisions (25 Nov: "do as sir said").

| What | How |
|---|---|
| Release once counselling is Done | Counselling panel → select students → **Release offer**, or the drawer. A student can be released at **Counselled**, or still at **Counselling scheduled** when the counselling Status is **Done** and the counselling form is saved. The release then moves them Counselling scheduled → Counselled → Offer sent (both moves are in the stage history). The % is the counsellor's (Actual Scholarship Awarded, with the ±5). |
| Validity | **7 days** by default on both campuses, as sir said (migration 0190). Can still be set per student at release (**Days to pay**) or changed on Scholarship & Scoring. The last date is 11:59:59 pm IST. |
| **OL Date Increase** | Drawer → Offer → **Extend last date**: days to add (1–90) and a reason → confirm (shows the new last date) → the offer's last date moves on. Only for a live offer (Offer sent, active, not cancelled, not paid, before its last date). A lapsed offer is still re-opened with Move stage → Offer sent. **No email** to the student (sir asked for email only for the reminders). The payment gate, the auto-lapse, the dashboard, the letter and the reminders follow the new date. History: `vsat_offer_events` kind `extended` (days, old / new date, reason, who). |
| **OL Reminder 1 / 2** | Emails at **10:00 am IST, 3 days and 1 day before the last date** (VSAT comms → "Offer: reminder 1 (3 days before)" / "Offer: reminder 2 (1 day before)", OFF and in test mode, email only, draft copy until sir's templates in Phase 7). One each per offer. Not sent when that time had already passed at release (a 2-day offer has no Reminder 1), when the fee is paid, the offer is cancelled / lapsed / on hold, or after the last date. Reminder 1 is not sent late once Reminder 2 is due. After an extension, a reminder not sent yet goes at the new time. Same pg_cron job `vsat-offer-remind` (every 15 minutes) and the same email job. |
| **Seat Block Status / Date** | **Done** and the payment date as soon as the ₹50,000 enrollment (seat blocking) fee is paid (`enrollment_stage = approved`, `enrollment_paid_at`). |
| **OL Cancelled** | "OL Cancelled" when the offer lapsed (not paid by the last date) or was cancelled, unless the fee was paid after all. |
| Counselling table | The sheet's columns, in its order, before the fee columns: OL sending date, OL last date, OL date increase (days), Seat block status, Seat block date, OL reminder 1, OL reminder 2, OL cancelled. All can be filtered. Reminder values: Sent · Queued · Failed · Not sent (email off) · Not sent (no longer live) · Due <day> · Not needed · On hold. |

Database (0189): `vsat_offer_extend(p)` (admin / admissions, campus rules, `authenticated` only); `vsat_offers_release` (0180 body + the Done rule); `vsat__offers_remind` (two reminders); `vsat_offer_notices_claim` (0157 body + the reminder kinds; the offer and reminder emails carry the current last date); private `vsat__offer_cols`, `vsat__offer_reminder_state`, `vsat__offer_reminder_due`; the grid functions (0186 / 0184 bodies + the six columns). Comms steps: + `offer_reminder_1`, `offer_reminder_2`; − `offer_reminder` (its waiting jobs closed as `replaced`).

Tests (staging): `supabase/tests/vsat_offer_phase6.test.sql` (33), `vsat_offer_reminders.test.sql` (updated for the two reminders, 23; since 0190 it pins Pune 2 / Gurugram 5 days inside its rolled-back block, as its checks are built on those). Rollback `supabase/rollback/0189_vsat_offer_phase6_down.sql` (tested on staging inside one block: the six functions, grants, steps and constraints back exactly; the new functions, index and rows gone).

**0190 (default validity 7 days):** sir said the offer is valid for 7 days; Pune and Gurugram `vsat_campus_settings.offer_days` = 7 (staging was Pune 2, Gurugram 5). Offers already released keep their date. Test `vsat_offer_days_7.test.sql` (4). Rollback `supabase/rollback/0190_vsat_offer_days_7_down.sql` puts back each database's earlier values (tested on staging: down → Pune 2 / Gurugram 5, up → 7 / 7).

## Security

- `vsat_offers_release(p)`: signed-in admin / admissions only; campus rules (a Pune admissions member never
  sees or releases a Gurugram student); unknown request keys refused (no custom deadline from the browser);
  1–100 students.
- The email outbox and its functions are server only (service role). The lapse job can't be called by
  browsers or the API.
- `vsat_offer_events`: RLS on, no browser access.
- `vsat__offers_remind()` (0157): pg_cron only — no browser role and not the server API.
- `vsat_offer_letter(p)` (0156): signed in only; a student gets only their own current offer (Offer sent /
  Enrolled, not cancelled); admin / admissions only on campuses they manage; unknown keys refused.

## Tests

- DB: `supabase/tests/vsat_offer_release.test.sql` (38 tests, staging).
- Unit: `src/lib/vsat/offers.test.ts`, `src/lib/vsat/offer-sync.test.ts`, `src/lib/vsat/pipeline.test.ts`.

## Production release (only with the owner's OK)

1. Check production first (migrations applied, pg_cron present).
2. Apply 0140 → 0143 (both files) → **0144**. 0144 uses `vsat__iv_ids` from 0143.
3. Check `select jobname, schedule from cron.job where jobname = 'vsat-offer-lapse'`.
4. Before turning the job on for real data: review students already at **Offer sent** on production. Their
   offer dates came from the old data; any with a deadline in the past will be lapsed by the first run.
5. Apply **0156** (letter data + email wording) after the other numbers before it (0145, 0148–0155 are other teams' work). Set **Days to pay**: Pune 2, Gurugram 5.
6. Turn on the **Offer released → student** step in VSAT comms (test mode first; check the attached letter).
7. Apply **0157** (reminder + lapsed email). Check `select jobname, schedule from cron.job where jobname = 'vsat-offer-remind'`.
   Turn on **Offer lapsed** in VSAT comms when the copy is approved (test mode first).
8. Apply **0189** after 0188 (Phase 6; it replaces 0157's last-day reminder). Check `vsat-offer-remind` is still scheduled.
   Turn on **Offer: reminder 1** and **Offer: reminder 2** in VSAT comms when sir's wording is in (test mode first).
9. Apply **0190** after 0189: default validity 7 days on both campuses (data only; the earlier values are kept in the column comment for the rollback).

Rollback: `supabase/rollback/0144_vsat_offer_release_down.sql` (tested on staging: down → identical
function / ACL / constraint snapshot → up).

## Left for later

- Sir's wording for the two reminder emails (Phase 7 templates).
