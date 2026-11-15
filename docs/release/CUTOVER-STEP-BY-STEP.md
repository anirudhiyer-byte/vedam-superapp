# Production cutover — exact step-by-step (where to go, what to do)

**Legend:** `[DEV]` = needs a terminal + database passwords (Anirudh / whoever has them).
`[YOU]` = dashboard clicks + coordination (Pawan). Do the steps in order. Don't skip the
review + clone-test steps — they're what guarantee prod won't break.

Project refs: **prod** = `obtzrqgoiqemnalmehdx`, **staging** = `kyhakenhbgcissmaacws`.

---

## 1. Install the tools `[DEV]`
On a Mac/Linux machine:
```bash
# Supabase CLI
brew install supabase/tap/supabase        # or:  npm i -g supabase
# Postgres client (pg_dump / psql / pg_restore)
brew install postgresql@16
# migra — the schema-diff tool
pipx install migra                         # or:  pip install migra   (needs Python 3)
# sanity
supabase --version && pg_dump --version && migra --help
```

## 2. Get the two database connection strings `[YOU + DEV]`
Do this for **both** projects.
1. Go to **https://supabase.com/dashboard** → click the project (prod, then staging).
2. Left sidebar → **Project Settings** (gear icon) → **Database**.
3. Find **Connection string** → tab **URI** → copy it. Click **Reveal** / enter the DB
   password (if unknown, reset it under **Database password** → "Reset database password").
4. Use the **direct** connection (host `db.<ref>.supabase.co:5432`), **not** the pooler.

You now have:
```
PROD_URL=postgresql://postgres:<pwd>@db.obtzrqgoiqemnalmehdx.supabase.co:5432/postgres
STAGING_URL=postgresql://postgres:<pwd>@db.kyhakenhbgcissmaacws.supabase.co:5432/postgres
```

## 3. Back up prod `[YOU]`
- Dashboard → **prod** project → **Database** → **Backups**.
- Confirm a recent daily backup exists, and note the **current timestamp** as your
  Point-in-Time-Recovery (PITR) restore point. **Write it down.** This is your undo button.

## 4. Confirm prod env vars `[YOU]`
- **Vercel** → the vedam-superapp project → **Settings** → **Environment Variables**.
- Switch the environment filter to **Production**. Confirm these exist with **production**
  values (not Preview-only, not sandbox where it says production):
  - `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `CASHFREE_ENV` ← production creds = real money
  - `TRUSTSIGNAL_API_KEY`, `TRUSTSIGNAL_SENDER` (+ any `TRUSTSIGNAL_WABA_ID` / senders)
  - `SMTP2GO_API_KEY`, `SMTP2GO_SENDER`
  - `WHEEBOX_BASE_URL`, `WHEEBOX_COMPANY_CODE`, `WHEEBOX_ACCESS_TOKEN`, `WHEEBOX_PRIVATE_KEY`
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (prod)
  - `NEXT_PUBLIC_SITE_URL` = `https://one.vedam.org`, `CRON_SECRET`
- If any are missing or still sandbox, fix them **before** going further.

## 5. Make a REAL clone of prod to test against `[DEV]`
We need a throwaway copy of prod's **actual schema + data** (the Supabase "branch" method
failed because prod's migrations don't replay — so we clone the real DB).
```bash
# dump prod (schema + data)
pg_dump "$PROD_URL" --no-owner --no-privileges -Fc -f prod.dump
# spin up a scratch Postgres locally
docker run -d --name clone -e POSTGRES_PASSWORD=pw -p 5433:5432 postgres:16
sleep 8
# load the dump into it
pg_restore --no-owner --no-privileges -d "postgresql://postgres:pw@localhost:5433/postgres" prod.dump
CLONE_URL=postgresql://postgres:pw@localhost:5433/postgres
```
*(No Docker? Create a new throwaway Supabase project and `pg_restore` into its URI instead.)*

## 6. Generate the catch-up diff `[DEV]`
```bash
# SQL that makes the clone (= prod) look like staging
migra --unsafe --schema public "$CLONE_URL" "$STAGING_URL" > catchup.sql
```
`catchup.sql` is the **entire production gap** — everything prod is missing.

## 7. Review `catchup.sql` — the safety gate `[DEV + review together]`
Read it top to bottom. It is SAFE only if:
- It's almost all `CREATE TABLE` / `CREATE FUNCTION` / `CREATE INDEX` / `ALTER TABLE … ADD COLUMN`.
- **No `DROP TABLE` / `DROP COLUMN` / `ALTER COLUMN … TYPE`** on tables that hold live prod
  data: `profiles`, `lead_manager`, `application_manager`, `events`, `event_registrations`,
  `email_events`, `whatsapp_sends`. If migra wants to drop/alter any of those → **STOP**,
  send me that section, review line by line. Those are data-loss risks.
- migra may also try to **DROP prod-only objects** (things prod has but staging doesn't) —
  **keep** any you still use; delete those `DROP` lines from `catchup.sql`.
- New tables keep RLS on + no public grants; new functions are `SECURITY DEFINER`.

## 8. Test the catch-up ON THE CLONE `[DEV]`
```bash
psql "$CLONE_URL" -v ON_ERROR_STOP=1 -f catchup.sql   # must finish with ZERO errors
# data still intact?
psql "$CLONE_URL" -c "select count(*) from profiles; select count(*) from application_manager; select count(*) from events;"
# clone now matches staging? (should print ~nothing)
migra --unsafe --schema public "$CLONE_URL" "$STAGING_URL"
```
If step-8 errors: fix ordering/dependencies in `catchup.sql`, rebuild a fresh clone (step 5),
re-test. **Repeat until it applies clean. Never move to prod until this is clean.**

## 9. Apply to REAL prod `[DEV]` — in the maintenance window, after `[YOU]` give the go
```bash
# you have the PITR point from step 3
psql "$PROD_URL" -v ON_ERROR_STOP=1 -f catchup.sql   # must finish with ZERO errors
```

## 10. Check `app_flags` on prod are safe `[DEV]`
```bash
psql "$PROD_URL" -c "select key,value from app_flags order by key;"
psql "$PROD_URL" -c "select * from vsat_comm_settings;"
```
Make sure: `vsat_public='off'`, `vsat_legacy_public` as you want, comms `master=false`,
and `environment` is NOT `'staging'` (absent is fine). Everything student-facing stays OFF.

## 11. Create the `vsat-docs` storage bucket on prod `[YOU]`
- Dashboard → **prod** project → **Storage** → **New bucket** → name `vsat-docs`,
  **Public bucket = ON** → Create.
- Do **not** add anon/authenticated write policies (service-role writes only — same as staging).
- Upload the files (same names as staging): `adypu-pune-brochure.pdf`,
  `sushant-gurugram-brochure.pdf`, `vsat-sample-paper.pdf`, `vsat-prep-kit.pdf`.

## 12. Deploy the code `[DEV]`
This ships **all** staging code to prod.
```bash
git fetch origin
git checkout main && git pull
git merge origin/staging          # resolve conflicts if any; should be clean
git push origin main              # Vercel auto-builds production
```
- Watch **Vercel → Deployments** until the production build is **Ready** (green).

## 13. Smoke test prod `[YOU]`
Open **https://one.vedam.org** and check:
- **Existing still works:** home, events + register, PYQ, CodeSprint, College Predictor, dashboards.
- **New (log in as admin):** VSAT Exam Center loads (coupons, landing toggles, doc uploader,
  **comms panel**); `/apply` and `/apply/dashboard` load; "My payments" / "My communications".
- A **test VSAT payment** → receipt appears + shows in "My payments".
- Comms **master OFF** → confirm **no** emails/WhatsApp fire.
- If anything is broken → **rollback (step 15)**.

## 14. Go live — separate, when you're ready `[YOU]`
- Make `/apply` public: Exam Center → landing toggle `vsat_public` → ON (or SQL
  `update app_flags set value='on' where key='vsat_public'`).
- Comms: admin comms panel → **Submit WhatsApp templates** → wait for TrustSignal/Meta
  approval → paste each step's template id → set a **test email/phone** → test in **test
  mode** → then turn each step + the **master** switch ON.

## 15. Rollback (only if something broke)
- **Database:** Dashboard → prod → Database → **Backups** → **Restore** to the PITR point from step 3.
- **Code:** `git revert <merge-commit>` on `main` and `git push` → Vercel redeploys the old prod.

---

### One-line summary of the division of labour
- **Anirudh (`[DEV]`):** steps 1, 2 (with you), 5, 6, 7, 8, 9, 10, 12.
- **You (`[YOU]`):** steps 2 (reveal strings), 3, 4, 11, 13, 14; you give the "go" before step 9.
- **Non-negotiable:** steps 3 (backup) and 8 (clone-test clean) before step 9 (prod).

The higher-level plan is in `docs/release/PROD-CUTOVER-RUNBOOK.md`. I can also pre-build a
candidate `catchup.sql` from staging to save Anirudh time — just ask.
