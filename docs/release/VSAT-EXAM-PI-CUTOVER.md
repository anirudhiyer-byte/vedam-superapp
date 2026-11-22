# VSAT Exam/PI + Insights cutover (staging → production)

Ships the pending slice that is on `staging` but not on `main`/prod: the **Insights funnel** (0129),
the **VSAT exam results / VPS / proctoring / Select-for-PI** feature (0135), and the **grid Payment-status
fix** (0139). Everything else (comm, calling, growth, marketing code) already matches `main`.

Prod project: `obtzrqgoiqemnalmehdx` · Staging project: `kyhakenhbgcissmaacws`.

## Scope confirmed
- Code: **full `staging` → `main`** (the 32-file delta = Insights UI + VSAT exam/PI UI + 0139 `grid.ts`).
- Eligibility policy value on prod: **match staging** — 10th `2024–2025`, 12th `{2026,2027}`, each PCM ≥ 50, overall ≥ 50 (`class12_min_overall:50`).

## Gap (verified against prod, 2026-11-22)
| Migration | On prod? | Action |
|-----------|----------|--------|
| 0103 / 0106 / 0112 | objects present (files differ only) | repo-sync via code merge; **no DB action** |
| 0129 insights_funnel | **missing** (`ins_funnel` absent) | apply |
| 0135 vsat_exam_results_pi | **missing** (no `vsat_proctoring`, `vsat_select_for_pi`, vps/proctoring fns; 1 eligibility overload) | apply |
| 0139 grid payment_status hide | **missing** (catalog still 0127) | apply (after 0135) |
| eligibility settings value | prod `min_year10:2023`, no overall gate | update to staging policy |

Prod deps for 0135 all present: `vsat_exam_results`, `application_manager`, `vsat_pipeline`,
`vsat__campus_key`, `vsat__move`, `vsat_exam_settings`, enums `vm_app_stage`/`vm_form_stage`/`vm_payment_stage`.

## DB apply order (prod) — one migration at a time, verify after each
1. **0129** `supabase/migrations/0129_insights_funnel.sql` → verify `md5(ins_funnel) = 361d2dd257f611cdbf19c7dacac71d95`.
2. **0135** `supabase/migrations/0135_vsat_exam_results_pi.sql` → verify:
   - `vsat_proctoring` + `vsat_proctoring_log` tables exist, RLS on.
   - `vsat_calc_eligibility` overloads = 2.
   - `md5(vsat__grid) = d5a1b109d04a26cba155a418eff3ef01`
   - `md5(vsat_grid_columns) = 70b0042c6a5c69821d2aa17a82e86a31`
   - `md5(vsat__effective) = 98da3e31c5d3897c427d34ad6a65114b`
   - `md5(vsat_select_for_pi) = 24148e55015fdd553275298583bb0276`
3. **0139** `supabase/migrations/0139_vsat_grid_hide_legacy_payment_status.sql` → verify `md5(vsat__grid_catalog) = 9a90c138ff1413eca9a194d2df6b0939`, `payment_status` sens = `hidden`.
4. **Eligibility value**: `update public.vsat_exam_settings set eligibility = jsonb_build_object('min_year10',2024,'max_year10',2025,'class12_years',jsonb_build_array(2026,2027),'pending_year',2027,'pcm_min_total',150,'pcm_min_each',50,'class12_min_overall',50) where id=1;`

All md5s are `md5(pg_get_functiondef(...))` and must be produced by applying the **exact committed file bytes**
(inline comments included — Postgres preserves them; a comment-stripped paste yields a different md5).

## Clone-test first
Spin a throwaway Supabase branch off prod, confirm it reflects prod's pre-cutover state (lacks `vsat_proctoring`),
apply steps 1–4, confirm the md5s above + no errors, then delete the branch. Only then touch real prod.

## Rollback (reverse order; each tested on staging)
- 0139 → `supabase/rollback/0139_*_down.sql` (restores 0127-era catalog body… note: on prod the pre-state is the 0127 catalog, md5 `164d4402ae9d4d66ad5302728ab73236` — the 0139 down restores the **0135** catalog, so after a 0135 rollback the catalog returns to 0127 anyway).
- 0135 → `supabase/rollback/0135_*_down.sql`.
- 0129 → `supabase/rollback/0129_*_down.sql`.
- Eligibility value: re-set to the previous JSON.

## Code deploy
- Full `staging` → `main` PR (squash — repo enforces). CI `Build` must pass.
- Merge **after** the DB chain is on prod (expand-then-deploy; the new UI needs 0135/0139/0129).
- Prod Vercel deploy on `main` → verify `success`.

## Env / storage checklist (prod)
- Vercel prod env vars present (confirmed earlier): Cashfree, Wheebox, TrustSignal, SMTP2GO, SITE_URL, CRON_SECRET.
- `vsat-docs` storage bucket — verify it exists on prod (document uploads); create if missing.

## Post-deploy verification
- Admin VSAT Applications grid loads; exam/VPS/proctoring columns render; "Payment status" column shows `payment_stage_1`.
- Insights funnel page loads.
- Eligibility calc reflects the new policy.
