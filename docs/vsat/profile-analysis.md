# Profile Analysis and the VSAT sender (Phase 7, migration 0191)

From the owner's review (24 Nov 2026, transcript).

## What sir asked for

- **Profile Analysis** page, under Buckets. Like the "Profile Analyzer" tab of the VSAT Student Details sheet: search the student by application ID and pick the VSAT, so they are easy to find. All the fields fill in by themselves from the different places the data lives.
- The AI writes a comprehensive summary that is "not biased towards making it look positive, neither negative": a logical, rational, structured analysis the counsellors can talk about.
- VSAT emails go from **admissions@vedam.org**, kept apart from PeerPath. Sir: "a second level problem", just point the emails to it.
- The email templates are to be replaced with sir's content when he sends it (left for later).

## For admins, admissions and counsellors (sidebar → VSAT process → Profile Analysis)

| Part | What |
|---|---|
| VSAT | dropdown (opens on the last one picked, else the latest whose exam day has come) |
| Application ID or name | search box. The list shows the VSAT's students that match (25 at most, "Showing 25 of N" when cut). Admin / admissions see their campus; a counsellor sees only their own students |
| Student | name, application no, campus, VSAT, stage |
| AI summary for the counsellor | the existing analyser (0085): **Generate / Regenerate profile**, saved on the counselling record. Needs a counselling record (a session booked); before that the page says so and still shows the fields |
| Student profile | the sheet's Profile Analyzer fields (44, empty ones left out): application, 10th / 12th, JEE, VSAT score and sections, interview marks and remarks, financial capability, scholarship, verdict. No email, phone or address. These are exactly the fields the AI reads |

The summary prompt is the sheet's prompt with one change for Phase 7: the line "balanced, realistic, and slightly conservative — avoid over-optimism" is replaced by sir's words (neutral, neither positive nor negative; logical, rational, structured). The same prompt is used from the student drawer.

## VSAT sender

Every VSAT email (stage comms, interview / counselling invites, offers and reminders, PI-cleared and stage emails, the VSAT confirmation) passes `fromEmail` from `src/lib/vsat/sender.ts`, which reads the server env **`VSAT_SENDER_EMAIL`**.

- Set `VSAT_SENDER_EMAIL=admissions@vedam.org` once that address is a verified sender on SMTP2GO (or its domain is).
- Empty or not set: VSAT emails keep today's sender, so nothing breaks before then.
- The Gmail fallback (only when SMTP2GO is not configured) always sends as its own account.

## Database (0191)

| Object | What |
|---|---|
| `vsat__profile_fields(app)` | private: the sheet's fields for one student, moved out of `vsat_profile_start` unchanged |
| `vsat_profile_start` | 0173 body; reads the fields from the helper. Access, NEEDS_COUNSELLOR, limits and run log unchanged |
| `vsat_profile_lookup(p)` | `{exam_date_id?, q?}` → the VSAT list, and the matching students of that VSAT. The search words are matched as text, never as a pattern |
| `vsat_profile_get(p)` | `{application_id, exam_date_id?}` → one student: header, fields, saved summary. A student not in the picked VSAT → `WRONG_VSAT` |

Both page functions are `SECURITY DEFINER`, `search_path ''`, refuse unknown keys, revoked from `public` / `anon`, granted to `authenticated`, with access checked per student (unknown or hidden students → `FORBIDDEN`). No table changes.

- Rollback: `supabase/rollback/0191_vsat_profile_analysis_down.sql` puts back the 0173 body of `vsat_profile_start` and drops the three functions (tested on staging: `pg_get_functiondef` md5 and ACL as before 0191, the new functions gone).
- Tests (staging): `vsat_profile_analysis.test.sql` (21) and `vsat_profile_analyser.test.sql` (unchanged).
- Unit: `profile-analysis.test.ts`, `sender.test.ts`, `profile-prompt.test.ts`.

## Left for later

- Sir's email templates (all VSAT emails).
- Set `VSAT_SENDER_EMAIL` after the admissions address is verified on SMTP2GO; connect the admissions Google account (Phase 1) for calendar invites.

## Production release (only with the owner's OK)

Apply **0191** after 0190. Set `VSAT_SENDER_EMAIL` on production only after it works on staging.
