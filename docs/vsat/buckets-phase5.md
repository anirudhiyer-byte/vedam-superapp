# Buckets: ARPU target, suggested buckets, lock and live ARPU (Phase 5, migrations 0187 + 0188)

From the owner's review (24 Nov 2026, transcript) and decisions (25 Nov).

## What sir asked for

- A **Buckets** page under Counselling Evaluation, for Pune and Gurugram (Bangalore later), one VSAT at a time.
- Per VSAT and campus, set the **ARPU**. ARPU means average revenue per user: programme fee − scholarship, averaged over the students. The system rearranges the buckets so the ARPU is met. The scholarship score stays the same; the category and % can change. An admin can change anything by hand.
- **"Jitna bucket, utna range"**: every bucket is 5%. So 3 buckets = 90 / 95 / 100, and 4 buckets = 85–100.
- **Lock** a VSAT, so changes made later do not touch it.
- **Tiles** for Pune ARPU, Gurugram ARPU and overall ARPU. They change as the buckets change, and only that campus's students are recalculated.

## Checked against sir's sheet (0187)

- 21 sample students from "Selected For Counselling Pune / GGN" were run through the engine. Score and category matched 21/21.
- The only Pune % mismatch was the default **Pune category 3** band: it was 50–70% (seeded by 0079), while the sheet says 60–70%. 0187 sets it to 60–70%. After that, all 16 sample students that follow the bucket rule match.
- In 5 Gurugram rows, the sheet's % was typed by hand, and it does not follow the bucket rule. One example is 30% in category 8, whose max is 25%. Owner's decision: keep the rule plus the counsellor's ±5. **These 5 cases need to be shown to sir.**
- **Sir's own "Buckets Pune" sheet breaks the 5-points rule in category 5** (2 buckets, 35–45%). The rule is checked when buckets are saved on this page. So Pune buckets can only be saved after category 5 is changed, for example to 35–40% or to 3 buckets. **This needs sir's call.**

## For admins and admissions (sidebar → VSAT process → Buckets)

Admins edit; admissions see the page read only. Admissions limited to one campus see that campus only.

| Part | What |
|---|---|
| VSAT | dropdown (opens on the last one picked, else the latest whose exam day has come) |
| Tiles | Pune ARPU, Gurugram ARPU, overall ARPU (weighted by students), with students, average scholarship and the target. While editing, the edited campus shows the draft's ARPU, marked "not saved" |
| Buckets table | category, score from / to, buckets, award from / to %, the bucket values, and the students and average % per category |
| ARPU target (lakh) | for example 12.5. **Suggest buckets for this target** moves every category's award range up or down in 5-point steps. Bucket counts and score ranges stay. It picks the most scholarship that still meets the target. If no shift can meet it, it says so and offers the highest ARPU possible |
| Save | saves the VSAT's own buckets for that campus, plus the target. Sir's 5-points rule is checked here. The campus's students then get their % from these buckets |
| Lock / Unlock | Lock freezes the VSAT's buckets for that campus. If the VSAT has none of its own yet, the default is copied first, so later changes to the default don't touch it. While locked, the buckets can't be changed here or on Scholarship & Scoring (**LOCKED**). Unlock needs a reason, which is kept in the settings audit |

**ARPU** is counted over the VSAT's students at PI cleared and every stage after it (the same students as Counselling Evaluation). It uses the system % from the scholarship score, as sir said: bucket step, the higher of that and the JEE floor (if the campus uses it), and +10 when achievements = 5 and the % is 30 or less. Counselling forms already saved keep the % they were saved with.

The Scholarship & Scoring page keeps its own rules (0098). The 5-points rule is checked only on this page.

## Database (0188)

| Object | What |
|---|---|
| `vsat_bucket_sets` | per VSAT + campus: ARPU target, locked at / by (RLS on, no policies, no browser access) |
| `vsat_settings_bands_set` (0098 body, replaced) | same rules and result; refuses a locked VSAT (**LOCKED**) |
| `vsat__bands_check` | private: 0098's band rules, plus the 5-points rule when the Buckets page saves |
| `vsat__bands_in_use`, `vsat__calc_safe`, `vsat__bucket_pop`, `vsat__bucket_cat`, `vsat__bucket_pct`, `vsat__bucket_arpu`, `vsat__bucket_viewer`, `vsat__bucket_args` | private helpers |
| `vsat_buckets_get` | admins and admissions (campus scope) |
| `vsat_buckets_preview` / `_suggest` / `_save` / `_lock` | admins |

Every page function is `SECURITY DEFINER`, `search_path ''`, revoked from `public` / `anon`, and granted to `authenticated`. The helpers are closed to browsers.

- Rollback: `supabase/rollback/0188_vsat_buckets_down.sql` puts back the 0098 body (checked by md5) and drops the functions and the table. A VSAT's own bands saved from this page stay as ordinary per-VSAT bands.
- Tests (staging):
  - `vsat_buckets.test.sql`, 19 checks: access, ARPU = the engine's %, preview, 5-points rule, suggestion, save, lock / unlock, grants.
  - `vsat_pune_band3_fix.test.sql`: sir's bands and sample students.
  - `vsat_settings_team.test.sql` (0098) still passes, 50/50.
- Unit: `buckets.test.ts`.

## Production release (only with the owner's OK)

Apply **0187** and then **0188** by name, after 0184 and 0186. No new env.
