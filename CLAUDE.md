# CLAUDE.md — working on Vedam One (vedam-superapp)

Notes for anyone (human or AI) changing this repo. Read `CONTRIBUTING.md` and `supabase/MIGRATIONS.md` too.

## Hard rules

- **Never touch production** (Supabase `obtzrqgoiqemnalmehdx`, branch `main`) without the owner's explicit OK. That includes reads you don't need, migrations, config and deploys.
- **Staging first, always.** Staging Supabase is `kyhakenhbgcissmaacws`; the long-lived `staging` branch and every feature branch deploy as Vercel Preview on the staging DB. Teammates share both: fetch first, check what changed.
- **Ask before every commit and push.** Branch off `staging` (feature/…), never commit to `main` or `staging` directly.
- **Don't add features on your own.** Suggest, explain the impact, ask.
- **Security checks live in the database function**, not only in the UI. Browsers never get table access: RLS on, no policies, everything through `SECURITY DEFINER` functions with `set search_path to ''` and explicit `revoke … from public, anon` / `grant … to authenticated`.
- **Every DB change is a numbered migration in `supabase/migrations/` with a rollback in `supabase/rollback/NNNN_*_down.sql`.** Test the rollback on staging (down → compare `md5(pg_get_functiondef)` + ACLs with a snapshot → up). Never edit a migration that already ran on production.
- **Secrets:** never print, log or commit a key. Staging keys only, through environment variables.
- **Never edit a test to make it pass. Never skip tests.**

## Commands

```bash
pnpm install
pnpm test          # vitest unit tests + node:test (LinkedIn) tests
pnpm typecheck     # tsc --noEmit — 13 old errors in event-editor / events-page / vsat-apply-form are known; add no new ones
pnpm exec eslint <changed files> --max-warnings=0
pnpm build         # needs network for next/font (Google Fonts)
```

DB tests: `supabase/tests/*.test.sql`. Paste into the **staging** SQL editor (or run through the Supabase MCP). Each file rolls itself back and returns one row per test (`test | pass | detail`).

## PeerPath ("Talk to a Senior") — current rules

- Pages are admin-only while `PEERPATH_LIVE = false` in `src/lib/peerpath/gate.ts`. Don't flip it without the owner.
- **Booking needs a login.** `pp_book(p jsonb)` uses `auth.uid()` only and refuses unknown request keys. Contact (`pp_contact_for`, 0036): **email = the user's own `application_manager.registered_email`** (else the OTP-verified login email); **phone = the OTP-verified login phone** (optional, `applicant_phone` nullable). Phone-OTP users never see an email step. No email anywhere → `EMAIL_MISSING` (the popup lets them add one by code). Typed request values and profile `*_verified` flags are never trusted. Direct calls to `pp_book` through the Supabase API with a user's own token are allowed (same checks; no per-IP limit there — accepted). The API route `/api/peerpath/book` calls it **as the user** (cookie session or `Authorization: Bearer`), checks Origin (CSRF) on cookie requests, and applies a per-IP limit with the trusted Vercel IP.
- **Eligibility:** `app_flags.peerpath_eligibility` = `off` (closed) | `registered` (has `application_manager` row) | `paid` (also has `vsat_payments` row). Admins skip the VSAT part. "Paid" is **only** `vsat_payments` — never `payment_stage_*`.
- **`vsat_payments` is write-once** and written only by the future payment webhook (service role). Contract: `docs/peerpath/vsat-payment-webhook.md`. Staging test helper: `scripts/staging/simulate-vsat-payment.sql` (refuses to run unless `app_flags.environment = 'staging'`).
- **Codes → popups:** `src/lib/peerpath/booking-codes.ts`. Popup links live in `PEERPATH_LINKS` (`src/lib/peerpath/constants.ts`); December's payment page = change `completePayment` (one line).
- Ownership of view / cancel / feedback / my bookings = `applicant_user_id = auth.uid()` or admin. Pre-login bookings are admin-only.
- Every booking attempt is logged in `pp_book_attempts` (90-day cleanup: `pp_cleanup_logs`, pg_cron `peerpath-log-cleanup`). Private limiter: `pp_rate_hit` (not callable by browsers).
- Migration 0031 seeds the flag as `off` on a fresh database (production stays closed until someone opens it).
- Decision record: `docs/decisions/0001-peerpath-vsat-eligibility-gate.md`.

Flag switch (staging first; production only with approval):

```sql
update public.app_flags set value = 'paid', updated_at = now(), updated_by = '<name>' where key = 'peerpath_eligibility';
```
