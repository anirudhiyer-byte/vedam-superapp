# VSAT interviews — scheduling, Google Meet, attendance and emails

Phase 2 of the VSAT admin panel. Migration `0140_vsat_interview_scheduling` (rollback in
`supabase/rollback/0140_vsat_interview_scheduling_down.sql`), DB tests in
`supabase/tests/vsat_interview_scheduling.test.sql`.

Booking from the panel rows: migration `0143_vsat_interview_inline_schedule` (rollback in
`supabase/rollback/0143_vsat_interview_inline_schedule_down.sql`), DB tests in
`supabase/tests/vsat_interview_inline_schedule.test.sql`.

Phase 3 reuses all of this for counselling (`counselling-scheduling.md`, migration 0145) through one config,
`src/lib/vsat/tracks.ts`; the offer release is in `offers.md` (migration 0144). The interview behaviour and copy
are unchanged. The VSAT cron now also runs the counselling jobs and the offer emails; the interview Google step
stops claiming new work after 2 minutes (was 2.5) to leave time for them.

## What staff can do (Interview panel)

| Action | Who | What happens |
|---|---|---|
| Schedule one student (drawer) | admin, admissions | Picks interviewer and date/time (IST). Since 0166 this only fills the student's row (*Not sent*); the invite goes out from the list with **Send**, like every other row. Google Meet only (no own link, 30 min). |
| Book from the rows (like the sheet) | admin, admissions | Each row has **Interviewer**, **Date** and **Time** (IST). What you type is saved as *Not sent* (the whole team sees it, it survives a refresh). Select rows → **Send** (a short confirm in the bar, no popup) → each row is booked with its own time, its own Google Meet and its own emails. Up to 40 per send. |
| Locked rows | admin, admissions | A row can be edited only at *VSAT cleared* / *Interview scheduled* (counselling: *PI cleared* / *Counselling scheduled*), not *Not selected*, and before the meeting is submitted. On other rows the Interviewer, Date and Time cells are plain text with a padlock (the booking, or "—"), not greyed-out dropdowns that look broken (owner's review, 25 Nov 2026), and the status cell says why, for example *Locked: Offer sent*, *Locked: Not selected* or *Locked: Interview done*; hover on any of them shows the rule. Screen only: the database rule (`vsat_interview_plan` / `vsat_counselling_plan`) is unchanged. |
| Fill times | admin, admissions | In the selection bar: interviewer + start → back-to-back 30-minute times for the selected rows that aren't booked yet (busy times skipped). Only fills the rows; nothing is sent. |
| Reschedule | admin, admissions | Change the row (then Send → "moved" emails), or the student page form. The same Google event is moved (the Meet link stays the same). **Undo** on a row drops the change. |
| Cancel | admin, admissions | Needs a reason. The Google event is deleted. Since 0166 the stage does not change. |
| Status (Done / No-show / Rescheduled) | admin, admissions; the interviewer for their own student | From the drawer, or for up to 100 selected rows from the selection bar (**Set status**). Done / No-show only after the slot starts; Rescheduled any time. Changing an earlier mark needs a reason. The stage does not change. |
| Join | admin, admissions; the interviewer for their own student | Each row with a Meet link shows **Join interview** and the link. |
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

## Stages are changed by hand (0166) and the Join link in the row (0165)

The owner's review (24 Nov 2026): after the exam booking, every stage is changed by hand.

- Booking, moving, cancelling, the Status (attendance) and submitting the interview form **only save their data**.
  They no longer move the stage. Admissions moves it with **Move to** in the selection bar or the drawer.
- The exam stages (*Booked*, *Exam taken*) and the payment stages are unchanged.
- The interviewer gives **no verdict** any more (it will come from everyone's scores in the Interview Evaluation page).
  Cheating seen still sets the result to *Not selected*, but the stage stays.
- Each form is still saved **once only**: a second submit is refused (`ALREADY_INTERVIEWED` / `ALREADY_COUNSELLED`).
- Because the stage no longer follows the booking, these work at any stage of the step: interview at *VSAT cleared*,
  *Interview scheduled*, *Interviewed*, *PI not appeared*; counselling at *PI cleared*, *Counselling scheduled*,
  *Counselled*, *Counselling not appeared*.
- New columns: **Interview status** / **Counselling status** (Done / No-show / Rescheduled), **Interview reschedules** /
  **Counselling reschedules** (how many times the time was moved). The row's Meet link (with **Join**) is sent only to
  admissions and the person's own interviewer or counsellor, only `https://` links.
- `vsat_set_attendance_bulk` sets one status for up to 100 selected students; each row goes through the single-row
  function, so every check is the same, and the reply lists the rows it skipped with the reason.

Migrations: `0165_vsat_grid_meet_link`, `0166_vsat_manual_stages` (rollbacks in `supabase/rollback/`, tested on
staging: down inside a block that is undone → every body equals the original md5, ACLs unchanged → staging identical
afterwards). DB tests: `vsat_grid_meet_link.test.sql` (18), `vsat_manual_stages.test.sql` (25). The older suites were
updated so their setup moves the stage by hand, as staff now do.

## Google Meet only (0167) and the student sees the booking at once (0168)

The owner's review (24 Nov 2026): interviews and counselling sessions use Google Meet only, no link of our own.

- The database refuses a pasted link (`meet_link` / `meeting_link`) and `auto_meet: false` with `BAD_VALUE: meet_link`,
  for every way of booking (drawer, row **Send**, the old bulk function). Every new booking is Google Meet.
- Bookings made before 0167 with a pasted link keep it (**Join** still works; the Meet column shows no badge, there is
  no "Own link" word on any screen or in CSV) until they are changed: the next move or re-send turns them into Google Meet (the pasted link goes, Google makes the event).
  Re-sending at the same time sends no "moved" email; Google sends the calendar invite with the new link.
- Screen: the Google failure text no longer says "use your own link", and the "Own link" badge is gone (grid, drawer,
  CSV). The database still returns `own_link` for those old rows; the screen shows no word for it.
- Since 0166 the stage stays at *VSAT cleared* / *PI cleared* until admissions moves it, so 0168 shows the student
  the booking as soon as it is **sent** (owner's choice, 25 Nov 2026): `vsat_my_interview` also at *VSAT cleared*
  (active), `vsat_my_counselling` gives the booked card at *PI cleared* (active) when a session is sent. On hold,
  not selected, cancelled and typed-but-not-sent rows still show nothing. The Join link rule is unchanged.

Migrations: `0167_vsat_meet_only`, `0168_vsat_student_sees_booking` (rollbacks in `supabase/rollback/`, tested on
staging the same way). DB tests: `vsat_meet_only.test.sql` (11), `vsat_student_sees_booking.test.sql` (23); the
interview, row booking, counselling and panel suites were updated where they pasted a link (now: refused, or an old
own-link row made by hand in the test).

## Meet attendance and the team count at any stage (0169)

Found while checking attendance for the owner (25 Nov 2026): since 0166 the stage no longer follows the booking, but
two places still looked for the old automatic stage.

- **Meet attendance** was read only at *Interview scheduled* / *Counselling scheduled*. A booking sent while the
  student is still at *VSAT cleared* / *PI cleared* (normal now) never got its Status from Meet. Now it is read at
  every stage where staff can set the Status: interview at *VSAT cleared*, *Interview scheduled*, *Interviewed*,
  *PI not appeared*; counselling at *PI cleared*, *Counselling scheduled*, *Counselled*, *Counselling not appeared*.
  A row already marked (by hand or by Meet), cancelled, submitted or of another attempt is still never touched.
- **Settings → Team, "open" count** (the warning before switching an interviewer or counsellor off) counted only
  students at the scheduled stage. Now it counts live bookings (not cancelled, not submitted, Status not *Done*) of
  students still at a bookable stage, so a booking sent at *VSAT cleared* / *PI cleared* is counted.

Migration `0169_vsat_attendance_any_stage` (same signatures and grants; rollback
`supabase/rollback/0169_vsat_attendance_any_stage_down.sql` puts back the 0140 / 0145 / 0098 bodies; tested on
staging: down → every body equals the original md5, ACLs unchanged → staging identical afterwards). DB test:
`vsat_attendance_any_stage.test.sql` (12; it failed before the migration). The interview (93), counselling (43) and
settings / team (50) suites still pass.

## Student side

The dashboard interview card calls `vsat_my_interview()` (by login only). It shows the date and time in IST.
Heading per state: *You're selected for the interview* (not booked yet) · *Your interview is booked* · *Your interview is
starting* · *You missed your interview* · *Your interview is done* · *Choose your campus first* (`interviewCardCopy`). Each state
has its own icon (no emoji); the time shows as a date tile with a live countdown ("Starts in 1 h 35 min" → "Live now"), and
"Camera on · Mic on · Quiet place" as chips while the interview is booked or starting.
The **Join interview** button opens from **10 minutes before** the slot **until the slot ends**. The Meet link
is only sent by the server inside that window, and the page uses the server clock, not the phone's.
The card shows the booking as soon as it is sent: at *Interview scheduled*, and since 0168 also while the student is
still at *VSAT cleared* (active), because admissions now moves the stage by hand after **Send**.

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
| Google event | Made, moved or deleted. 5 tries, then *Failed* (staff can retry; since 0167 there is no own link). Not retried when the time has passed, an email is missing, or staging test mode blocks a guest. |
| Attendance | Read from Meet after the slot ends. Both joined together → *done*. Nobody / only one person joined → *no-show* (Status column only; since 0166 the stage and pipeline status do not change). Short call or no Meet record → left for staff to mark. Staff can always change it. |
| Emails | Through the existing **VSAT comms** steps (same sender as the other VSAT emails). Waits up to 20 minutes for the Meet link, then sends with the dashboard link. |

### How attendance is captured (checked in the code, 25 Nov 2026)

Sir asked to confirm this. Attendance is the **Status** column (Done / No-show / Rescheduled). It never moves the stage.

1. **From Google Meet, automatically.** Only for Google Meet bookings (every booking since 0167), and only once
   the admissions Google account is connected (scope `meetings.space.readonly`). Until then nothing is read.
2. **When.** The VSAT job runs every 10 minutes (on production by Vercel cron; on staging only when called by hand).
   It picks bookings that ended at least 10 minutes ago and have no Status yet (`vsat_interview_attendance_due`),
   at any stage where staff can set the Status (since 0169; before, only at *Interview scheduled*).
3. **What it reads.** Google Meet's call records for that meeting code, from 30 minutes before the slot to
   60 minutes after it, and each person's time in the call.
4. **The rule** (`decideAttendance`): a person counts only after 1 minute in the call (between 15 minutes before
   the slot and 60 minutes after it).
   - **Done**: at least 2 people were in the call together for 5 minutes or more.
   - **No-show**: nobody joined, or only one person joined.
   - **Left for staff** (Status stays *Not marked yet*): a shorter call, or no Meet record 2 hours after the end.
5. **Still going.** If the call is still on, it tries again on the next run, up to 12 times or 24 hours. Then it
   leaves the row for staff.
6. **By hand, always.** The interviewer can set the Status of their own student once; admissions can set it for
   one row or up to 100 selected rows, and change an earlier mark with a reason. Done / No-show only after the
   slot starts; Rescheduled any time. A mark made by hand is never overwritten by Meet.
7. **Limit.** Meet reports how many people joined, not who. "Only one person joined" is marked No-show even if
   that person was the student; staff can change it.
8. **Counselling.** The same rules apply today. Once counselling moves to the counsellor's Zoom link (Phase 4),
   Google cannot read Zoom calls, so counselling Status will be marked by hand.

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

**Separate invites (decided 25 Nov 2026).** Each booking is one Google event owned by the admissions account, with the
student and the interviewer (or counsellor) as guests. Google sends each guest their own invite. The guest list is
hidden (`guestsCanSeeOtherGuests: false`) and the title has only the student's name, so the student does not see who
the interviewer or counsellor is before the call. Two separate events sharing one Meet were not used: guests of the
second event may have to "ask to join", and the admissions host never joins. To check in the first real-email test on
staging, with screenshots for the owner. In the Workspace admin console, Meet's **"Host must join before anyone else"**
must stay off for the admissions account.

In test mode, Google invites go out **only** when every guest is on `ADMISSIONS_TEST_EMAILS`; otherwise the row
shows *Failed — staging test mode*. Without these values, interviews still save and emails still go; the Meet
column stays *Creating*.

## Known limits

- Meet does not say *who* joined, only how many people. "Only one person joined" counts as a no-show; staff can change it.
- Moving a student back by hand with the pipeline's bulk move does not delete the Google event. Use **Cancel interview**.
- Column choices saved in a browser need **Reset** once to show the new *Interview Meet* column.
- The 221 interviews booked before this release keep their own Meet links (`meet_mode = manual`); nothing is sent for them
  until one is moved or re-sent, which makes it Google Meet (0167).
- Two booked students can't swap times in one send (each waits for the other's time). Move one to a free time first.
- `vsat_schedule_interviews_bulk` (0140) is still in the database but no screen uses it any more.

## Production release (only with the owner's OK)

1. Apply migrations 0140 and 0143 on production (in that order). With Phase 3: then 0144 (offers) and 0145 (counselling).
   Then 0158, 0165 (Join link + reschedule columns), 0166 (stages by hand, Status, bulk status), 0167 (Google Meet
   only), 0168 (the student sees the booking once it is sent) and 0169 (Meet attendance and the team count at any
   stage).
2. Set the `ADMISSIONS_*` env in Vercel **Production** (`ADMISSIONS_INVITE_MODE=live`).
3. Merge to `main` (the cron entry comes with `vercel.json`).
4. In *VSAT → Comms*, check the six interview steps' copy, then turn them on and off test mode.
