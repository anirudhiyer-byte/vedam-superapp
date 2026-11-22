# VSAT interviews — scheduling, Google Meet, attendance and emails

Phase 2 of the VSAT admin panel. Migration `0140_vsat_interview_scheduling` (rollback in
`supabase/rollback/0140_vsat_interview_scheduling_down.sql`), DB tests in
`supabase/tests/vsat_interview_scheduling.test.sql`.

Booking from the panel rows: migration `0143_vsat_interview_inline_schedule` (rollback in
`supabase/rollback/0143_vsat_interview_inline_schedule_down.sql`), DB tests in
`supabase/tests/vsat_interview_inline_schedule.test.sql`.

## What staff can do (Interview panel)

| Action | Who | What happens |
|---|---|---|
| Schedule one student (drawer) | admin, admissions | Picks interviewer, date/time (IST) and length (default 30 min). Google Meet is made automatically, or staff can paste their own link. |
| Book from the rows (like the sheet) | admin, admissions | Each row has **Interviewer**, **Date** and **Time** (IST). What you type is saved as *Not sent* (the whole team sees it, it survives a refresh). Select rows → **Send** (a short confirm in the bar, no popup) → each row is booked with its own time, its own Google Meet and its own emails. Up to 40 per send. |
| Fill times | admin, admissions | In the selection bar: interviewer + start → back-to-back 30-minute times for the selected rows that aren't booked yet (busy times skipped). Only fills the rows; nothing is sent. |
| Reschedule | admin, admissions | Change the row (then Send → "moved" emails), or the student page form. The same Google event is moved (the Meet link stays the same). **Undo** on a row drops the change. |
| Cancel | admin, admissions | Needs a reason. The Google event is deleted, the student goes back to *VSAT cleared*. |
| Mark joined / no-show | admin, admissions | Only after the slot starts. Changing an earlier mark needs a reason. |
| Retry Meet | admin, admissions | When Google failed 5 times. |
| Filter by interviewer | managers | Panel filter, including "No interviewer". |

All rules are enforced in the database functions, not only in the screen:

- Row status: *Not sent* (new, ready), *Change not sent* (booked + a new time), *Booked*, *Fill all three*, or the problem
  in words, e.g. *Clashes with Tanvi Pillai* (same interviewer, overlapping time — counting other typed rows too). A row with
  a problem is never sent. A student who is moving out of a time frees it for another row in the same send.

- No time in the past; no overlap for the same interviewer (`SLOT_TAKEN`); one live interview per student and attempt.
- A student who already had the interview can't be booked again (`ALREADY_INTERVIEWED`).
- Campus rules from the pipeline apply (`FORBIDDEN` / `NOT_IN_PIPELINE`).
- Saving without a change does nothing (no event, no email).

## Student side

The dashboard interview card calls `vsat_my_interview()` (by login only). It shows the date and time in IST.
Heading per state: *You're selected for the interview* (not booked yet) · *Your interview is booked* · *Your interview is
starting* · *You missed your interview* · *Your interview is done* · *Choose your campus first* (`interviewCardCopy`). Each state
has its own icon (no emoji); the time shows as a date tile with a live countdown ("Starts in 1 h 35 min" → "Live now"), and
"Camera on · Mic on · Quiet place" as chips while the interview is booked or starting.
The **Join interview** button opens from **10 minutes before** the slot **until the slot ends**. The Meet link
is only sent by the server inside that window, and the page uses the server clock, not the phone's.

## How the background work runs

Saving only writes to the database. The Google and email work is queued and done by:

1. **"Sync now"** — `POST /api/vsat/interviews/sync`, called by the panel right after a save (admin / admissions only, same-origin, only students that person can see).
2. **Cron** — `GET /api/cron/vsat-interviews` every 10 minutes (`vercel.json`, needs `CRON_SECRET`).

Both are safe to run at the same time: the database hands each job out once (claim token + version), so an
older run can never undo a newer change.

**Staging:** Vercel runs cron jobs only on production deployments, and staging is a Preview deployment. On
staging, "sync now" still runs after every save, but the 10-minute job (Meet attendance, email retries, emails
waiting for a Meet link) runs only when called by hand: `GET /api/cron/vsat-interviews` with the header
`Authorization: Bearer <CRON_SECRET>` (the staging value, from the Vercel Preview env).

| Job | Rule |
|---|---|
| Google event | Made, moved or deleted. 5 tries, then *Failed* (staff can retry or use their own link). Not retried when the time has passed, an email is missing, or staging test mode blocks a guest. |
| Attendance | Read from Meet after the slot ends. Both joined together → *done*. Nobody / only one person joined → *no-show* (pipeline *absent*). Short call or no Meet record → left for staff to mark. Staff can always change it. |
| Emails | Through the existing **VSAT comms** steps (same sender as the other VSAT emails). Waits up to 20 minutes for the Meet link, then sends with the dashboard link. |

### Who gets which email

| Change | Student | Interviewer |
|---|---|---|
| First booking | `interview_invite` | `interviewer_invite` |
| Time changed | `interview_rescheduled` (with old time) | `interviewer_rescheduled` |
| Interviewer changed, same time | — | old: `interviewer_cancelled`, new: `interviewer_invite` |
| Cancelled | `interview_cancelled` | `interviewer_cancelled` |

Only people who were told about the old time get "moved" or "cancelled" emails. A retry never emails the same person twice.

The six steps are seeded **off and in test mode** (`vsat_comm_steps`). In test mode every email goes to the
comms **test email** address. Turn them on in *VSAT → Comms* after checking the copy.
Placeholders: `{{name}} {{student_name}} {{application_no}} {{date}} {{time}} {{old_date}} {{old_time}} {{join_link}} {{dashboard_link}} {{panel_link}}`.

## Setting up the admissions Google account

A separate Google Workspace account (not the PeerPath one), for example `admissions@…`.

1. In Google Cloud, create an OAuth client (type *Web application*) in a project with the **Google Calendar API** and **Google Meet REST API** turned on.
2. Get a refresh token for the admissions account with these scopes only:
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/meetings.space.readonly`
3. Put these in Vercel **Preview** (staging) env first. Never commit them:

| Name | Value |
|---|---|
| `ADMISSIONS_GOOGLE_CLIENT_ID` | OAuth client id |
| `ADMISSIONS_GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `ADMISSIONS_GOOGLE_REFRESH_TOKEN` | refresh token of the admissions account |
| `ADMISSIONS_ORGANIZER_EMAIL` | the admissions account's email |
| `ADMISSIONS_INVITE_MODE` | `live` in production only. Anything else = test mode. |
| `ADMISSIONS_TEST_EMAILS` | staging: comma-separated emails Google may invite |

In test mode, Google invites go out **only** when every guest is on `ADMISSIONS_TEST_EMAILS`; otherwise the row
shows *Failed — staging test mode*. Without these values, interviews still save and emails still go; the Meet
column stays *Creating*.

## Known limits

- Meet does not say *who* joined, only how many people. "Only one person joined" counts as a no-show; staff can change it.
- Moving a student back by hand with the pipeline's bulk move does not delete the Google event. Use **Cancel interview**.
- Column choices saved in a browser need **Reset** once to show the new *Interview Meet* column.
- The 221 interviews booked before this release keep their own Meet links (`meet_mode = manual`); nothing is sent for them.
- Two booked students can't swap times in one send (each waits for the other's time). Move one to a free time first.
- `vsat_schedule_interviews_bulk` (0140) is still in the database but no screen uses it any more.

## Production release (only with the owner's OK)

1. Apply migrations 0140 and 0143 on production (in that order).
2. Set the `ADMISSIONS_*` env in Vercel **Production** (`ADMISSIONS_INVITE_MODE=live`).
3. Merge to `main` (the cron entry comes with `vercel.json`).
4. In *VSAT → Comms*, check the six interview steps' copy, then turn them on and off test mode.
