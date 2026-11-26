# Counselling: Online / Offline, Zoom, the counselling sheet and Counselling Evaluation (Phase 4, migration 0184)

From the owner's review (24 Nov 2026), counselling part:

- counselling is **online or offline**. The student picks it on the dashboard (0179, a teammate's migration), and
  admissions can set it by hand for students who reply by email;
- **online invites go to online students only**, by hand (Send), on the **counsellor's own Zoom link**
  ("Google Meet nahi hoga"). There is one Zoom link per counsellor, kept on the website;
- the **PI-cleared email** invites the student to counselling, asks for the mode and lists the **offline dates**.
  The dates are set on the Counselling page;
- the Counselling table carries the **"Selected for counselling" sheet's columns** (Pune / GGN): the counsellor's
  feedback, parent present, already connected with existing students, came to know about Vedam from, counsellor
  remarks, the actual scholarship awarded after the counsellor's **±5 %**, the fee, the 1st-year scholarship
  (scholarship ÷ 4) and the fee after scholarship;
- a **Counselling Evaluation** page per VSAT.

Taken as they are (not rebuilt here): 0179 (the student's choice, `application_manager.counselling_mode`,
`vsat_set_counselling_mode`) and 0180 (offer days override), both by a teammate.

Attendance is **not read from Zoom**. Only Google Meet attendance can be read, so the Status (Done / No-show /
Rescheduled) is set by hand, as in the sheet.

## For admins

**Counselling → Zoom links & offline dates → Zoom link per counsellor.** Paste each counsellor's personal Zoom meeting
link (`https://…zoom.us/…`) and press Save. Clear the box and save to remove a link. Links for Chandan and Anuj are
needed before online counselling can be booked: a counsellor without a link can't be booked (**NO_ZOOM_LINK**).
Admissions can see the links but can't change them. Every change is in the settings audit (area "team").

## For admissions and admins

### Counselling table

- **Selection bar → Counselling mode**: set Online, Offline or Not chosen for the selected students (at most 100). Only
  students at PI cleared, Counselling scheduled or Counselling not appeared can be set. A student whose counselling is
  already saved is skipped, and the reason is listed.
- **Booking (Send / drawer)**:
  - Not chosen → **MODE_NOT_CHOSEN** ("set the mode first");
  - Online → on the counsellor's Zoom link; a counsellor with no Zoom link → **NO_ZOOM_LINK**;
  - Offline (0186, see below) → recorded with the counsellor and the offline date and time, with no invite.

  A booked session is on the counsellor's Zoom link. The Meet column shows **Zoom**, Join opens the Zoom link, and the
  calendar invite (Google Calendar, no Google Meet) carries the link. Moving a session that was on Google Meet before
  0184 deletes the old Meet event and sends a new invite with the Zoom link.
- **Default columns**: the booking columns first (student, campus, VSAT, stage, counsellor, slot, Meet, mode, status,
  reschedules), then the sheet left to right:
  - VEDAM ID, state, city, financial capability and why, the five interview remarks, why Vedam should accept you;
  - 10th %, gender, VPS, 12th %, PI score and PI score (×20), JEE Mains, comp science and its ×20, logical
    reasoning and its ×20, JEE maths, 10th / 12th maths;
  - scholarship score, interviewer, verdict, category, award (formula %), the counsellor's adjustment, actual
    scholarship awarded;
  - counsellor feedback, parent present, already connected, came to know from, counsellor remarks, form submitted;
  - programme fee, scholarship amount, 1st-year scholarship, fee after scholarship, offer deadline;
  - (0192) scholarship as per weightage, scholarship as per JEE Mains, max scholarship.

  Everyone opens on this default once; a column choice saved earlier is set aside. **Counsellor feedback** can be
  filtered.
- **Zoom links & offline dates → Offline counselling dates**: add a date per campus (today to a year ahead) with an
  optional note (e.g. "10 am – 4 pm, admissions office"), and remove it again. Admissions limited to one campus manage
  that campus only. The same date can't be on the list twice for a campus.

### PI-cleared email

The step "PI cleared → student" now says the student is invited to counselling, asks them to choose Online or
Offline on the dashboard, lists `{{offline_dates}}` and says the online date, time and Zoom link follow by email.
`{{offline_dates}}` shows the campus's dates from today on (e.g. "Sat, 28 Nov 2026 (10 am, admissions office);
Thu, 3 Dec 2026"), or "to be announced soon" when there are none. The text changed only where the step still had
the 0173 draft. An admin's own edit is kept.

The counselling invite and moved emails say **Where: Zoom** (student) and **Zoom:** (counsellor) instead of Google
Meet. These changed only where the seeded wording was still there.

### Counselling Evaluation (sidebar → VSAT process → Counselling Evaluation)

Admins and admissions only. Admissions limited to one campus see their campus only. Pick a VSAT and, if you want,
one campus.

| Part | What it shows |
|---|---|
| Numbers | reached counselling (PI cleared and after), chose online, chose offline, booked, counselled (form saved), ARPU |
| Online or offline | online / offline / not chosen, with the share |
| Booked sessions | Status: Done / No-show / Rescheduled / not marked yet |
| Counsellor feedback | likely to pay / may or may not / unlikely to pay / not given, of the counselled students |
| Scholarship and ARPU | average formula % and awarded %, highest and lowest; per campus: programme fee, students, counselled, average awarded, **ARPU**; all |
| Students | name, campus, mode, counsellor, slot, status, feedback, formula %, awarded % (with the adjustment), fee after scholarship, stage |

**ARPU** = programme fee − scholarship, averaged over the counselled students. The fees come from Scholarship &
Scoring → campus settings (staging: Pune ₹18,50,000, Gurugram ₹18,00,000, as in the sheet).

## For counsellors

The student drawer → **The counselling call**:

| Field | Values |
|---|---|
| Counsellor feedback | Likely to pay · May or may not · Unlikely to pay |
| Parent present? | No · Yes (Mother / Father / both parents / Guardian / Sibling / someone else) |
| Already connected with existing students? | Yes · No |
| Came to know about Vedam from? | text (up to 300 characters) |
| Counsellor remarks | text (up to 2,000 characters) |
| Adjustment | −5 to +5 whole percentage points on the formula's %, with a reason (needed if not 0) |

The form shows the scholarship awarded (formula % + adjustment, kept within 0–100), and from the programme fee the
scholarship amount, the 1st-year scholarship (÷ 4) and the fee after scholarship. All the answers are optional, as in
the sheet. The form is saved once. The stage does not move.

## Offline sessions and "Offline Form Filled" (0186, owner's decision 25 Nov)

Before 0186 an offline student could not be booked (MODE_OFFLINE), so their counselling form could never be saved.

- Admissions set the counsellor and the offline date and time for an offline student the same way as for an online one
  (drawer or Send). It is **recorded only**: no Zoom link, no calendar invite, no email. The counsellor does not need a
  Zoom link. The Meet column and the drawer show **Offline**; Status (Done / No-show / Rescheduled) is set by hand.
- A booking moved from online to offline loses its Zoom link; its old calendar invite is deleted by the calendar job,
  and no "moved" email goes out.
- The student's card says the session is at the campus, with no Join button and no link.
- The counselling form has **Offline form filled?** (Yes / No, optional), and the Counselling table has the column
  **Offline form filled** (after Counselling reschedules). Everyone opens the Counselling table on the default columns
  once more (saved column choice set aside, `v3`).
- Counselling Evaluation counts a recorded offline session as booked.

| Object | What |
|---|---|
| `counselling_assignments` | + `offline_form_filled`; `meet_mode` may be `offline` |
| `vsat__cs_schedule` (0184 body, patched) | offline student → `meet_mode = 'offline'`, no link, no calendar work |
| `vsat_counselling_notices_claim` (0145, patched) | offline events are skipped (`why: offline`) |
| `vsat_submit_counselling` (0184 body, patched) | + `offline_form_filled` (true / false) |
| `vsat__grid_catalog` / `vsat__grid` (0184 bodies, patched) | + `cs_offline_form_filled`; Meet column value `offline` |
| `vsat_my_counselling` (0168, patched) | + `offline` for the student's card |

- Rollback: `supabase/rollback/0186_vsat_counselling_offline_down.sql` (offline rows become `manual` with no link, as
  0184 had no offline mode; the column is dropped).
- Staging record: `0185_vsat_counselling_offline` (applied before a teammate's 0185 took that number, so this file was
  renumbered 0186).
- Tests: `supabase/tests/vsat_counselling_offline.test.sql` (staging). `vsat_counselling_phase4.test.sql` D and H were
  changed for this decision: the offline student is now recorded (was MODE_OFFLINE), Send records the offline row, and
  booked counts 4 (was 3).

## Sir's three scholarship columns (0192, alpha test 26 Nov)

The alpha test against sir's review found that the Counselling table showed only the final "Calculated %", while sir's
"Selected For Counselling" sheets end with three scholarship columns (Pune BK–BM, GGN BL–BN). They are now columns of
the Counselling table, right after the fee columns, in the sheet's order:

| Column | Sheet | What it shows |
|---|---|---|
| Scholarship as per weightage | Scholarship as Per Weightage | the bucket % for the student's scholarship score |
| Scholarship as per JEE Mains | Scholarship as Per JEE Mains | the JEE slab (90 / 93 / 95 / 97 / 98.5 → 30 / 40 / 50 / 60 / 70 %) when the JEE Mains percentile is 90 or more, else the weightage % |
| Max scholarship | Max Scholarship | the higher of the two, +10 when the interview achievements score is 5 and that is 30 % or less, at most 100 |

- The values are **live**: worked out from the current buckets of the student's VSAT (as on the Buckets page), so they
  follow a bucket change. "Calculated %" stays the % saved with the counselling form.
- Max uses the JEE % only where the campus has the JEE floor on (Scholarship & Scoring); both campuses have it on, as in
  the sheet.
- A student without the data for a score (or not Pune / Gurugram) shows empty cells.
- All three can be filtered (number). Everyone opens the Counselling table on the default columns once more (saved
  column choice set aside, `v5`).

| Object | What |
|---|---|
| `vsat__scholarship_cols` (new, private) | the three values for one student, from `vsat__calc_safe` and `vsat_calc_final_scholarship` |
| `vsat__grid_catalog` / `vsat__grid` / `vsat__grid_virt_expr` (0189 bodies, patched) | + `cs_weightage_pct`, `cs_jee_pct`, `cs_max_pct` (virtual, Counselling group); worked out only when the table asks for them |

- Rollback: `supabase/rollback/0192_vsat_scholarship_columns_down.sql` (puts back the 0189 bodies, drops the helper).
  Tested on staging: the down file ran inside a block that was undone; the three bodies matched 0189 by md5, the ACLs
  were unchanged and the helper was gone.
- Tests: `supabase/tests/vsat_scholarship_columns.test.sql` (staging, 8/8): the sheet's rules worked out on their own for
  every staging student at PI cleared or later (151, of whom 11 with a JEE slab and 14 with the +10), the same values
  from the table, the filter, missing data, and access. `vsat_grid`, `vsat_grid_counsellor`, `vsat_offer_phase6` and
  `vsat_scholarship_sheet_formulas` pass too. Unit: `grid.test.ts`.
- Production (only with the owner's OK): apply **0192** after 0190 and 0191.

## Database (0184)

| Object | What |
|---|---|
| `vsat_counsellor_zoom` | one Zoom link per counsellor (RLS on, no policies, no browser access) |
| `vsat_offline_counselling_dates` | offline dates per campus; a removed date is kept (`removed_at`), a live date is unique per campus |
| `counselling_assignments` | + `counsellor_feedback`, `parent_present`, `connected_students`, `heard_from`, `adjust_pct`; `meet_mode` may be `zoom` |
| `vsat__cs_schedule` (0167 body, patched) | online students only, on the counsellor's Zoom link (`meet_mode = 'zoom'`); calendar invite queued |
| `vsat_counselling_sync_claim` (0145, patched) | + `zoom_link`, so the calendar job makes the invite without Google Meet |
| `vsat_counselling_meet_retry` (0145, patched) | a Zoom booking's failed calendar invite can be retried |
| `vsat_submit_counselling` (0166, patched) | + the sheet's counsellor fields and the ±5 adjustment (the reason is kept in `actual_reason`) |
| `vsat_stage_notices_claim` (0173, patched) | + `offline_dates` of the student's campus for the PI-cleared email |
| `vsat__grid_catalog` / `vsat__grid` / `vsat__grid_virt_expr` (0173, patched) | the sheet's columns; Counsellor feedback filterable |
| `vsat_counsellor_zoom_list` / `_set` | the links (admins and admissions read; admins set) |
| `vsat_offline_dates_list` / `vsat_offline_date_add` / `_remove` | the offline dates (campus scope) |
| `vsat_counselling_mode_staff` | admissions set Online / Offline / none for up to 100 students |
| `vsat_counselling_analysis` | Counselling Evaluation |

All new functions are `SECURITY DEFINER`, `search_path ''`, revoked from `public` / `anon`, granted to
`authenticated`. The server jobs stay server-only.

- Rollback: `supabase/rollback/0184_vsat_counselling_phase4_down.sql`. It puts back the patched bodies (checked by
  md5), drops the new functions, tables and columns, turns Zoom bookings into `manual` (the link is kept), and puts
  back the step and email wording if unchanged.
- Tests: `supabase/tests/vsat_counselling_phase4.test.sql` (staging).
- Staging records: `0182_vsat_counselling_phase4_part1` (applied before a teammate's 0182 / 0183 took those numbers, so
  this file was renumbered 0184), `0184_vsat_counselling_phase4_part2a` … `part2e`. For production, apply the single
  file `0184_vsat_counselling_phase4.sql`.

### Old tests updated (approved by the owner: setup only, Meet → Zoom)

Every booking now needs an online student and a counsellor with a Zoom link, so the old counselling DB tests got
these setup lines:

- after each `insert into public.application_manager` in a test's student helper:
  `update … set counselling_mode = 'online' …`;
- after each `insert into public.vsat_team … 'counsellor'`: `insert into public.vsat_counsellor_zoom …` with a test
  Zoom link.

These assertions changed from Google Meet to Zoom:

| File | Change |
|---|---|
| `vsat_meet_only` | C: a counselling booking (new, and an old pasted one when moved) is `zoom` on the counsellor's link |
| `vsat_counselling_scheduling` | A: booking and move are `zoom` on the (new) counsellor's link. B: sent rows are `zoom`. E: the calendar result keeps the counsellor's Zoom link, and the email job carries it |
| `vsat_attendance_any_stage` | `ended_cs` setup marks the row as an old Google Meet booking (`meet_mode = 'auto'`): the Meet attendance stage rule is for bookings from before 0184 |

Setup lines only: `vsat_achievements_bonus`, `vsat_auto_step`, `vsat_grid`, `vsat_manual_stages`,
`vsat_pipeline_panels`, `vsat_profile_analyser`, `vsat_student_sees_booking`.

Unit test: `stage-notices.test.ts` "placeholders: a missing name reads Student" now also expects the new
`offline_dates` placeholder (the exact placeholder set is what it checks).

## Testing

- DB (staging): `vsat_counselling_phase4.test.sql`. It covers A Zoom links, B offline dates, C mode set by admissions,
  D booking (online only, Zoom, calendar job, emails, no Meet attendance, Try again, Send), E counselling form and ±5,
  F table columns and the feedback filter, G PI-cleared email dates and wording, H Counselling Evaluation, and I access.
  The ten older counselling tests above all pass on staging.
- Rollback (staging): the down file runs inside a block that is always undone, then checks the md5 of every restored
  body against its original and the ACLs, that no new object is left, and that the wording is back.
- Unit: `counselling-form.test.ts`, `grid.test.ts`, `interview-sync.test.ts` (Zoom events), `google/account.test.ts`
  (an event without Meet), `stage-notices.test.ts` (`{{offline_dates}}`).

## Production release (only with the owner's OK)

After 0179 and 0180 (the teammate's counselling mode and offer days): apply **0184** by name
(`0184_vsat_counselling_phase4.sql`, the single file), then **0186** (`0186_vsat_counselling_offline.sql`). No new env: the calendar invite uses the same `ADMISSIONS_*`
Google account. Before booking online counselling on production:

1. an admin adds each counsellor's Zoom link (Counselling → Zoom links & offline dates);
2. admissions add the offline dates per campus;
3. check the programme fee per campus (Scholarship & Scoring);
4. turn on the PI-cleared email when sir's wording is final (VSAT → Comms, off test mode).
