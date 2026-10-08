import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Update the current user's `profiles` row and CONFIRM the write actually landed.
 *
 * Why this exists: a Supabase `update()` that RLS matches to 0 rows returns NO
 * error — the client thinks it succeeded while nothing was written. That silent
 * failure (an update firing before the fresh session/JWT is attached, so
 * `auth.uid()` is still null and the row isn't matched) is exactly what dropped
 * email + mobile_verified for real users on 2026-10-08.
 *
 * We `.select()` the row back to prove the write happened. On 0 rows or a
 * transient error we let the session settle and retry once, then return the
 * error. Callers MUST check `error` and must NOT proceed on failure.
 */
export async function saveProfile(
  supabase: SupabaseClient,
  id: string | undefined | null,
  patch: Record<string, unknown>,
): Promise<{ error: string | null }> {
  if (!id) return { error: "Your session isn't ready yet — please wait a moment and try again." };
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase.from("profiles").update(patch).eq("id", id).select("id");
    if (!error && data && data.length > 0) return { error: null };
    if (attempt === 0) {
      // session/JWT race: auth.uid() still null => update matched 0 rows. Let it
      // settle and retry once.
      try { await supabase.auth.getSession(); } catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    return { error: error?.message || "Couldn't save your details — please try again." };
  }
  return { error: "Couldn't save your details — please try again." };
}
