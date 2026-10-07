// Signup smoke test — verifies the full signup chain is healthy end to end.
// Calls the DB-side preflight (simulates a signup, checks a profile + lead
// row appear, rolls it all back). Exits non-zero if registration is broken.
//
// Usage (locally or in CI, against STAGING):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/smoke/signup.mjs
//
// Wire this into CI as a required check once the staging service-role key is
// added to GitHub Actions secrets. Keep it pointed at STAGING, never prod.

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const db = createClient(url, key);
const { data, error } = await db.rpc("preflight_signup_test");

if (error) {
  console.error("Smoke test could not run:", error.message);
  process.exit(1);
}

const row = Array.isArray(data) ? data[0] : data;
console.log("Signup preflight:", row?.detail ?? row);

if (!row?.ok) {
  console.error("SIGNUP IS BROKEN — blocking.");
  process.exit(1);
}
console.log("OK — signup chain healthy.");
