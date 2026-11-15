# Production cutover runbook — Vedam One (vedam-superapp)

**Status:** NOT STARTED. Production is untouched and stable.
**Owner sign-off required before every step marked ⚠️.**
**Golden rule:** staging → test → production. Never change production first.

---

## 1. Why this is a big release (read first)

Production (`obtzrqgoiqemnalmehdx`) is **not a few migrations behind** staging
(`kyhakenhbgcissmaacws`). An object-level diff on 15 Nov 2026 showed **production is
missing ~200 database objects** — whole platforms that have **never been deployed to
production**:

- The **entire VSAT platform**: payments, payment orders, form builder, exam centre,
  pipeline, scholarship engine, team/roles, stage engine, and this session's work
  (My payments/communications dashboard, stage comms).
- The **entire Calling CRM** (`calling_*`).
- The **entire Communication Manager** (`comm_*` — flows, lists, doc templates,
  suppressions, automation reads).
- `app_flags` itself (many features read it), several insights dashboards, the Elevate
  outbox, and more.

Production currently runs an **older, divergent schema**. It still works for what it has
(events, PYQ, CodeSprint, Product Users, existing dashboards). Those must keep working.

**Consequence:** you cannot simply "merge staging → main." The code on staging references
tables/functions that do not exist on production, so the production deploy would 500 on
those routes. The database must be brought up to date **first**, and verified, before any
code deploy.

**This is why it must be a planned, tested cutover — not a quick push.**

---

## 2. The safe method (summary)

1. **Snapshot / backup production** (point-in-time restore confirmed available).
2. **Make a throwaway clone of production** and run the *entire* migration on the clone
   first. Prove it applies clean end-to-end and the existing data survives.
3. Only then, in a low-traffic window, apply the **same** migration to real production.
4. Deploy the code (`staging → main`), with the new VSAT/comms features **toggled OFF**.
5. Smoke-test production. Keep rollback ready.
6. Go-live toggles (making VSAT public, enabling comms) are a **separate, later** decision.

Because the two databases have **divergent migration histories**, do **not** blindly replay
the numbered files. Use a **schema diff** to produce one reviewed catch-up migration.

---

## 3. Pre-flight checklist (⚠️ owner confirms each)

- [ ] ⚠️ **Production database backup / PITR** confirmed (Supabase dashboard → Database →
      Backups). Note the restore point.
- [ ] ⚠️ **Production Vercel env vars** present in the **Production** environment (not just
      Preview): `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
      `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`,
      Cashfree (`CASHFREE_APP_ID`/`SECRET_KEY`/`ENV` — **production** creds for real money),
      TrustSignal (`TRUSTSIGNAL_*`), SMTP2GO (`SMTP2GO_*`), Wheebox (`WHEEBOX_*`),
      Sentry (optional). *(Owner stated these exist — verify in the Production tab specifically.)*
- [ ] Decide the **maintenance window** (low traffic; existing prod features briefly at risk
      during the migration).
- [ ] Confirm **production git branch** that Vercel deploys to production from (expected: `main`).
- [ ] All target code is on `staging` and green (it is — this session's work is merged).

---

## 4. Build the migration (on the clone, not prod)

Recommended tooling: `supabase db diff` (or `migra` / `pg_dump --schema-only` + diff).

1. `pg_dump --schema-only` of **staging** and of **production** → compare.
2. Generate a **single consolidated catch-up migration** (prod schema → staging schema).
3. **Review it by hand**, especially:
   - Any `DROP` / `RENAME` / `ALTER COLUMN TYPE` on tables with **live prod data**
     (`profiles`, `lead_manager`, `application_manager`, `events`, `event_registrations`,
     `email_events`, `whatsapp_sends`). These must be data-safe. Additive `ADD COLUMN` is fine.
   - `app_flags` seed rows — production needs the flags seeded with **safe defaults**
     (`vsat_public = off`, `peerpath_eligibility = off`, `vsat_comm_enabled` off, etc.).
   - Security: every new function is `SECURITY DEFINER` + `search_path ''` + `revoke
     public/anon` + `grant authenticated` (per CLAUDE.md). The diff must not grant browsers
     table access.
   - RLS: every new table ships **RLS on, no policies** (access via functions only).
4. Write the matching **rollback** for the catch-up migration.

> Alternative (more auditable): apply the **missing numbered migration files** in order on
> the clone, skipping the ones prod already has, fixing any that assume a different base.
> Slower, but each file already has a tested rollback in `supabase/rollback/`.

Known-missing on prod include (not exhaustive — the diff is the source of truth):
`0031 app_flags`, `0032 vsat_payments`, `0037 vsat_payment_orders`, `0038 lock lead/app`,
`0039 form builder`, `0040 exam center`, `0041 enrollment`, `0042 school search`,
`0047/0048 exam admin`, the Calling CRM (`0070–0073, 0077`), Comm Manager slices
(`0060, 0061, 0064–0067, 0069`), `0076 elevate outbox`, and `0079–0091` (pipeline,
achievements, auto-step, jee floor, profile analyser, coupons, public flag, landing
toggles, coupon harden, My-dashboard, comms). Verify against the live diff.

---

## 5. Dry run on the clone (⚠️)

- [ ] Create a clone of production (Supabase branch / restored copy).
- [ ] Apply the consolidated catch-up migration to the clone.
- [ ] Confirm it applies **with zero errors** end-to-end.
- [ ] Spot-check that existing prod data is intact (row counts on `profiles`,
      `lead_manager`, `application_manager`, `events`, `email_events`).
- [ ] Run the DB test SQL in `supabase/tests/*.test.sql` against the clone.
- [ ] Rollback-test the catch-up migration on the clone (down → up → compare).

If anything fails here, **stop and fix** — do not touch real production.

---

## 6. Apply to production (⚠️ owner go, in the window)

- [ ] ⚠️ Final backup / note PITR point.
- [ ] Apply the **same** consolidated catch-up migration to production.
- [ ] Create the **`vsat-docs` storage bucket** on production (public read, service-role
      write only — mirror staging). Re-upload brochures/sample papers.
- [ ] Verify `app_flags` seeded safe: `vsat_public = off`, `vsat_legacy_public` as desired,
      `vsat_comm_enabled` off, `environment` **not** 'staging'.
- [ ] Verify object counts now match staging (re-run the diff → empty).

---

## 7. Deploy the code

- [ ] Fetch latest `main`; merge `staging → main` (fast-forward if possible; otherwise a
      reviewed merge). This ships **all** staging code, not just VSAT — so smoke-test the
      existing features too (§8).
- [ ] Wait for the Vercel **production** build to go green.
- [ ] Register production cron routes if not already (same `vercel.json`): the comms
      reminder piggybacks on `comms-journeys`, so **no new cron** is added.

---

## 8. Smoke test production (nothing breaks)

Existing features (must still work):
- [ ] Home / events / event registration + payment
- [ ] PYQ, CodeSprint, College Predictor, Product Users, dashboards
- [ ] Email sending (events confirmation) + any existing WhatsApp

New (should exist, still OFF to students):
- [ ] `/apply` and `/vsat` gated (vsat_public off → admin-only)
- [ ] Admin: VSAT Exam Center loads (coupons, landing toggles, doc uploader, **comms panel**)
- [ ] `/apply/dashboard`, `/apply/dashboard/payments`, `/apply/dashboard/communications`
      load for an admin
- [ ] A test VSAT payment on production Cashfree (**sandbox first if possible**) →
      receipt + `vsat_payments` row
- [ ] Comms master switch OFF → confirm **no** emails/WhatsApp fire

---

## 9. Go-live (separate, deliberate — after cutover is verified)

These stay OFF until the owner explicitly flips them:
- [ ] `vsat_public = on` (makes `/apply` public)
- [ ] `vsat_legacy_public` as desired
- [ ] Comms: submit the 4 WhatsApp utility templates → wait for approval → set each step's
      `wa_template_id` → set test recipient → test in **test mode** → then flip step +
      master ON.

---

## 10. Rollback

- Database: restore from the pre-cutover PITR point (fastest, clean).
- Per-object: each numbered migration has a `supabase/rollback/NNNN_*_down.sql`; the
  consolidated catch-up gets its own reviewed down script.
- Code: revert the `staging → main` merge and redeploy the previous production commit.

---

## 11. What is already done (this session, on staging)

All merged to `staging` and verified (lint, typecheck, migration rollback-tests):
coupons (0086), vsat_public flag (0087), landing toggles (0088), coupon harden (0089),
My payments/communications dashboard (0090), **stage comms** (0091) + send engine +
receipt PDF + triggers + 24h reminder (piggybacked, no new cron) + admin panel +
template-submit action. Landing fixes (image, schedule, brochures, video links),
lead-on-OTP-verify fix, post-payment banner fix, and the submit-flow fixes are also on
staging. **None of this is on production yet.**
