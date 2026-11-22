# Release runbook — Growth marketing channels (Consultants, Telegram, Vedantu)

**Status:** READY FOR REVIEW. Production is untouched.
**Owner sign-off is required before every step marked ⚠️.**
**Golden rule:** staging → test → production. Database first, code second.

## 1. What this release contains

| Part | Files |
| --- | --- |
| Database | 8 migrations: `0130`, `0131`, `0132`, `0133`, `0134`, `0136`, `0137`, `0138` (each has a rollback in `supabase/rollback/`) |
| Screens | `src/components/admin/marketing/{consultants,telegram,vedantu}/`, `src/lib/growth/{consultants,telegram,vedantu}*.ts` |
| Menu | `src/components/admin/vsat-admin-panel.tsx` (three channels switched on), one error text in `src/lib/growth/marketing.ts` |
| Build | `package.json`: Node pinned to `24.x` (separate commit; without it Vercel builds on Node 26 and `next/font` fails) |
| Checks | `scripts/release/growth-channels-pre.sql`, `scripts/release/growth-channels-post.sql` (read only) |

**Not in this release:** `0135` (VSAT exam results), `0103`, `0106`, `0112`, `0129` and their screens. They belong to other
owners and stay on `staging`. This branch was cut from `main`, not from `staging`, so none of that work comes along.

## 2. What was checked before writing this (22 Nov 2026)

- Staging: alpha test 58 / 58, post-check 194 / 194, unit tests 1111 / 1111, lint clean, no new type errors.
- Production, read only: pre-check all rows ok. Everything these migrations need is there (`0120`, the helper functions,
  the tables and columns, `pg_cron`). None of the new tables or functions exists yet. Postgres is 17.6 on both.
- The 8 migration files build the same 75 functions that run on staging (4 differ only in comment lines).

Production fingerprints before the release (first 12 characters of `md5(pg_get_functiondef)`):

| Function | Before | After |
| --- | --- | --- |
| `growth_perf` | `b7580e46c738` | must be the same |
| `growth_weekly` | `b86f0cfca48f` | must be the same |
| `growth_rows_list` | `59ca0ed011e6` | must be the same |
| `growth__owned_leads` | `ed4cf3daf777` | must be the same |
| `growth__leads` | `e154979c56d5` | changes (0133: faster, same result) |
| `growth_campaign_save` | `9932505102be` | changes (0138: new Vedantu check) |
| `growth_campaign_delete` | `6e5416d43cb7` | changes (0132, 0136: refuses a VSAT that Telegram / Vedantu rows use) |

## 3. Why database first

- The new screens call functions that do not exist on production yet. Code first = the three channel pages show errors.
- The old code keeps working on the new database: the three replaced functions give the same answers while the new tables
  are empty. So "database, then code" has no broken moment.

## 4. Steps

1. [ ] ⚠️ **Backup.** Supabase dashboard → Database → Backups: confirm a backup from today (or PITR). Note the time.
2. [ ] **Fetch.** `git fetch origin main`. If `main` moved since this branch was cut, merge `origin/main` into this branch,
       re-run `pnpm test`, `pnpm typecheck`, eslint, and read the diff again. Never force-push, never rebase over others' work.
3. [ ] **Pull request to `main`.** Vercel preview must build green (it runs on the staging database). Do not merge yet.
4. [ ] **Pre-check on production** (read only): run `scripts/release/growth-channels-pre.sql`. Every row `ok = true`.
       Any `false` → stop.
5. [ ] ⚠️ **Apply the 8 migrations to production, one file at a time, in this order:**
       `0130` → `0131` → `0132` → `0133` → `0134` → `0136` → `0137` → `0138`.
       Use the file exactly as it is in the repo (supervised apply, migration name = file name without `.sql`).
       If a file fails: stop, do not continue with the next one, roll back what was applied (section 6).
6. [ ] **Post-check on production** (read only): run `scripts/release/growth-channels-post.sql`. Every row `ok = true`, and
       the four "must NOT change" fingerprints equal the table above. Any `false` → stop, do not deploy the code.
7. [ ] ⚠️ **Merge the pull request** (this deploys the code). Fetch `main` once more just before merging.
8. [ ] **Smoke test on production as an admin:**
       - Growth → Consultants / Telegram / Vedantu: Listing and Performance open, tables are empty, no error.
       - Growth → Overview, Ads, Influencers: numbers are the same as before the release.
       - Add one real row (or a clearly named test row and remove it), check it appears.
9. [ ] Tell the team it is live. Update the status line at the top of this file.

## 5. Stop conditions

Stop and ask the owner when: a pre-check or post-check row is `false`; a migration gives an error; the Vercel build is red;
`main` moved and the merge is not clean; Overview / Ads / Influencers numbers changed.

## 6. Rollback

- **Code:** Vercel → Deployments → promote the previous production deployment (instant). Then revert the merge commit.
- **Database:** run the rollback files in the opposite order:
  `0138` → `0137` → `0136` → `0134` → `0133` → `0132` → `0131` → `0130` (`supabase/rollback/NNNN_*_down.sql`).
  Each was tested on staging (down → compare → up). After all eight, the fingerprints are back to the "Before" column.
- **Careful:** the `0130`, `0131`, `0132`, `0136` rollbacks drop the new tables. Rows typed into Consultants / Telegram /
  Vedantu after the release are lost. Export them first if any exist. Nothing else in the database is touched.

## 7. Known and accepted (not blockers)

- Same UTM on two rows in different VSATs: the all-time columns count the same people on both rows (as the old CRM).
- Telegram rows in overlapping VSATs can count the same people twice.
- Enrolment date falls back to "last updated" when the paid date is empty (shared rule with Overview / Ads; unchanged).
- No load test with heavy traffic yet. Fake test data stays on staging only; production starts empty.
