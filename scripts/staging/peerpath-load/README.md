# PeerPath staging tests: integration, break-it, load (STAGING ONLY)

These run from a machine that can reach staging: the GitHub Actions workflow `.github/workflows/peerpath-staging-tests.yml` (recommended), or a laptop. The cloud workspace used to build the feature cannot reach staging. Every script refuses to run against anything except staging project `kyhakenhbgcissmaacws`. All keys come from secrets / environment variables and are never printed or committed.

## GitHub Actions (recommended)

The workflow runs after Vercel finishes a **Preview** deployment (never Production). It does nothing until you turn it on.

**Secrets** (repo → Settings → Secrets and variables → Actions → *Secrets*):

| Secret | Value (staging only) |
|---|---|
| `STAGING_SUPABASE_URL` | `https://kyhakenhbgcissmaacws.supabase.co` |
| `STAGING_SUPABASE_ANON_KEY` | Staging anon / publishable key |
| `STAGING_SUPABASE_SERVICE_ROLE_KEY` | Staging service role key (integration checks + flag switch) |
| `STAGING_SUPABASE_JWT_SECRET` | Staging JWT secret (only to sign 2-hour test-user tokens) |
| `STAGING_DB_URL` | Staging Postgres connection string — use the **Session pooler** URI (port 5432, user `postgres.kyhakenhbgcissmaacws`); GitHub runners have no IPv6, so the direct `db.…` host won't connect |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Vercel → Project → Settings → Deployment Protection → Protection Bypass for Automation |

**Variables** (same page → *Variables*):

| Variable | Effect |
|---|---|
| `PP_HTTP_TESTS` = `on` | Integration + break-it over HTTP on each Preview deployment |
| `PP_LOAD_TEST` = `armed` | Also runs the ramped 1,000-user load test (tell the team first; set it back to anything else afterwards) |

To run again without a new push: Actions → *PeerPath staging tests* → latest run → **Re-run all jobs**. Results are in the run's **Summary** and the `peerpath-staging-test-output` artifact (no tokens or keys in either).

Each run: creates the test users → marks `pp-load-0010` as paid (simulated) → mints tokens → integration → (load) → **always** runs `cleanup-test-users.sql`, even when a step fails.

## Manual run (laptop)

| Name | Where it comes from |
|---|---|
| `STAGING_SUPABASE_URL` | `https://kyhakenhbgcissmaacws.supabase.co` |
| `ANON_KEY` | Staging publishable/anon key (public) |
| `SERVICE_ROLE_KEY` | Staging service role key |
| `STAGING_JWT_SECRET` | Staging JWT secret |
| `BASE_URL` | The Vercel preview URL of the feature branch |
| `BYPASS` | Vercel protection-bypass token |

1. **Tell the team** — staging is shared.
2. Staging SQL editor: `create-test-users.sql` → 1,000 `pp-load-*@example.invalid` users (registered, unpaid, verified email, no phone) + 5 unregistered + the `PPLoad` senior. Copy the senior id it prints.
3. Staging SQL editor: `../simulate-vsat-payment.sql` for `pp-load-0010@example.invalid` (the paid user).
4. `node mint-tokens.mjs > /tmp/pp-load-tokens.json` (2-hour tokens).
5. `node integration.mjs` — end-to-end + break-it checks (ends with the per-IP limit test, which blocks your IP on the route for an hour). Restores the flag afterwards.
6. `k6 run -e MODE=db …  k6-book.js` — ramped to 1,000 users on the database path.
7. `k6 run -e MODE=route … k6-book.js` — same through the Vercel route (shows the per-IP limit).
8. Staging SQL editor: `cleanup-test-users.sql`. Delete `/tmp/pp-load-tokens.json`.

Mail / SMS: none. `.invalid` addresses can't receive mail, users are inserted directly (no sign-up flow), and the Google invite step is in test mode for addresses not on `PEERPATH_TEST_EMAILS`.
