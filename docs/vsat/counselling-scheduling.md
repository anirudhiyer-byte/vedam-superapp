# VSAT counselling scheduling (Phase 3, migration 0145)

Counselling now works exactly like the PI interview (see `interview-scheduling.md`): the same rules, the same
Google Meet + email + attendance jobs, the same row booking. Only the names differ. The two are kept in step by
one config: `src/lib/vsat/tracks.ts` (`TRACKS.interview`, `TRACKS.counselling`).

## For admissions

| What | Where |
|---|---|
| Book many | Counselling panel → on each student's row pick **Counsellor**, **Date** and **Time** (saved as you type, not sent) → select rows → **Send**. Each row gets its own Google Meet and emails (student + counsellor). |
| Fill times | Selection bar → Fill times: counsellor + start → back-to-back 30-minute times for the selected rows (busy times skipped). Only fills the rows. |
| Clash | Two rows (or a row and a booking) with the same counsellor at overlapping times show "Clashes with …" and are not sent. |
| Move | Change the row's counsellor / date / time → Send → "moved" emails. Or from the student drawer. |
| One student | Drawer → Counselling & scholarship → **Schedule counselling session**: counsellor, date, time, length, Google Meet or own link. |
| Cancel | Drawer → Cancel counselling session (reason) → Google invite removed, both told, student back to **PI cleared**. |
| Attendance | Read from Google Meet after the session (not joined → no-show, student marked absent). The counsellor can mark it once; admissions can change it with a reason. |
| Retry Meet | Drawer → Meeting "Failed" → Try again. |
| Emails | VSAT comms: 6 steps (Counselling scheduled / moved / cancelled → student; → counsellor). OFF and in test mode until an admin turns them on. Same placeholders as the interview steps. |

The counselling form (Save counselling → scholarship %) and the offer (`offers.md`) are unchanged in how they
work; Save counselling still needs the student at **Counselling scheduled**.

## For the student

The dashboard card that showed the interview now also follows the student after it:

| Where the student is | Card |
|---|---|
| Interview done, waiting for the result | "Your interview is done" · We'll email you the result. |
| PI cleared (active), no session yet | "You've cleared the interview" · We'll book your counselling session soon and email you the time. |
| Session booked | "Your counselling session is booked" + date tile, countdown, Join button (opens 10 minutes before) |
| Live / missed / done | Same as the interview card, with "counselling session" |

On hold at PI cleared → the neutral "Your interview is done" card (the student is not told they cleared).
Copy: `counsellingCardCopy` in `src/lib/vsat/interviews.ts` (needs the owner's approval like the interview copy).

## Database (0145)

- `counselling_assignments` + the interview columns (duration, Meet mode / sync, version, cancel, attendance source).
  The link column stays `zoom_link` (Google Meet or own link). One row per student + attempt (unique index).
- `vsat_counselling_events` (history + email outbox), `vsat_counselling_drafts` (typed row values).
- Functions: as 0140 / 0143 with `counselling` names. `vsat_assign_counsellor` keeps its request keys
  (`meeting_link`) and gains `duration_min`, `auto_meet`. New error codes: `ALREADY_COUNSELLED`, `NO_COUNSELLING`.
- `vsat_my_counselling()`: the student's session, plus `step` (interview / interviewed / pi_cleared / counselling).
- Existing counselling rows (120 on staging, all with a hand-pasted link) are `manual`: no Google event, no email,
  unless someone reschedules them.

Server: `/api/vsat/counselling/sync` (send now after a save; shared code `src/lib/vsat/sync-route.ts`) and the VSAT
cron `/api/cron/vsat-interviews` (now also runs the counselling Google, attendance and email jobs).

## Tests

- DB: `supabase/tests/vsat_counselling_scheduling.test.sql` (42 tests, staging).
- Unit: `src/lib/vsat/counselling.test.ts` (+ all interview tests unchanged).
- Rollback `supabase/rollback/0145_vsat_counselling_scheduling_down.sql` tested on staging inside one transaction:
  down → function / ACL / column / index / constraint / data snapshot identical → rolled back (0145 stays applied).

## Grid: Counsellor dropdown and Counselling Meet column (0158)

- Counselling panel (admin / admissions): a **Counsellor** dropdown next to the others: every counsellor in the panel
  by name with a count, then **No counsellor**. Works with every other dropdown and filter, and with CSV export.
- New column **Counselling Meet** (shown by default after the slot): Meet ready / Creating Meet… / Meet failed /
  Own link / Cancelled, the same words and colours as Interview Meet. A saved column choice from before does not get
  it automatically: add it from Columns.
- Database: `vsat__grid` takes `counsellor_ids` (user ids or `none`, up to 50) and returns the `counsellor` /
  `counsellor_name` counts; the catalogue has `counselling_meet`. Who sees which rows did not change.
- Tests: `supabase/tests/vsat_grid_counsellor.test.sql` (17), `vsat_grid.test.sql` still 76/76; unit tests in
  `src/lib/vsat/grid.test.ts`. Rollback `supabase/rollback/0158_vsat_grid_counsellor_down.sql` (puts back the 0140
  functions; tested on staging: down → same md5 and grants as before → rolled back).

## Production release (only with the owner's OK)

Apply 0140 → 0143 → 0144 → **0145**. Uses the same `ADMISSIONS_*` Google account as the interviews. Then turn on
the 6 counselling steps in VSAT comms (test mode first). The grid change is **0158** (after 0140; no settings).
