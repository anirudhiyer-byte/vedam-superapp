import type { SupabaseClient, User } from "@supabase/supabase-js";

/** PYQ is now public (launched 29 Oct 2026). Everyone — logged out or logged in —
 *  may use the page and the PYQ APIs. A completed profile is still required before
 *  starting a test (see /api/pyq/attempt/start); admins (@vedam.org) stay exempt.
 *  To re-lock to admins only, set this back to `process.env.VERCEL_ENV === "production"`. */
export const PYQ_ADMIN_ONLY = false;

/** Same admin rule as the College Predictor gate: a confirmed @vedam.org email, or the
 *  `admin` role. `sb` must be the signed-in user's server client (not the service role),
 *  because `is_admin()` reads the caller's identity. */
export async function isPyqAdmin(sb: SupabaseClient, user: User | null): Promise<boolean> {
  if (!user) return false;
  const email = (user.email ?? "").toLowerCase();
  if (email.endsWith("@vedam.org") && !!user.email_confirmed_at) return true;
  const { data } = await sb.rpc("is_admin");
  return data === true;
}

/** May this visitor use PYQ right now? */
export async function canUsePyq(sb: SupabaseClient, user: User | null): Promise<boolean> {
  if (!PYQ_ADMIN_ONLY) return true;
  return isPyqAdmin(sb, user);
}
