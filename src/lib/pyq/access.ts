import type { SupabaseClient, User } from "@supabase/supabase-js";

/** Pre-launch lock for the PYQ module.
 *  - Production: admins only. Everyone else (logged out, or a logged-in non-admin)
 *    is kept out of the page AND every PYQ API — same posture as the College Predictor.
 *  - Staging / preview / local: open to everyone, so the full new-user journey can be tested.
 *  To launch PYQ publicly, make this `false` (one line) and redeploy. */
export const PYQ_ADMIN_ONLY = process.env.VERCEL_ENV === "production";

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
