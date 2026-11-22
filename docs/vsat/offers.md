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
`{{deadline_date}}` (Sat, 28 Nov 2026), `{{deadline_time}}` (11:59 pm), `{{dashboard_link}}`.

## Security

- `vsat_offers_release(p)`: signed-in admin / admissions only; campus rules (a Pune admissions member never
  sees or releases a Gurugram student); unknown request keys refused (no custom deadline from the browser);
  1–100 students.
- The email outbox and its functions are server only (service role). The lapse job can't be called by
  browsers or the API.
- `vsat_offer_events`: RLS on, no browser access.

## Tests

- DB: `supabase/tests/vsat_offer_release.test.sql` (38 tests, staging).
- Unit: `src/lib/vsat/offers.test.ts`, `src/lib/vsat/offer-sync.test.ts`, `src/lib/vsat/pipeline.test.ts`.

## Production release (only with the owner's OK)

1. Check production first (migrations applied, pg_cron present).
2. Apply 0140 → 0143 (both files) → **0144**. 0144 uses `vsat__iv_ids` from 0143.
3. Check `select jobname, schedule from cron.job where jobname = 'vsat-offer-lapse'`.
4. Before turning the job on for real data: review students already at **Offer sent** on production. Their
   offer dates came from the old data; any with a deadline in the past will be lapsed by the first run.
5. Turn on the **Offer released → student** step in VSAT comms (test mode first).

Rollback: `supabase/rollback/0144_vsat_offer_release_down.sql` (tested on staging: down → identical
function / ACL / constraint snapshot → up).

## Left for later

- Offer letter PDF (needs the official template).
- Reminder email before the deadline; email when an offer lapses.
- Choosing a custom deadline per student.
