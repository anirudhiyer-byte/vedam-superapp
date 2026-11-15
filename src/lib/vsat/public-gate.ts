import { createClient as createSvc } from "@supabase/supabase-js";

/**
 * VSAT landing visibility flags (server-side, service role — no client access).
 *   applyPublic  = app_flags.vsat_public === 'on'        → /apply new signup landing is public
 *   legacyPublic = app_flags.vsat_legacy_public === 'on' → /vsat old early-reg is public
 * Admins always get access regardless; callers OR these with their own isAdmin check.
 */
export async function readVsatGate(): Promise<{ applyPublic: boolean; legacyPublic: boolean }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { applyPublic: false, legacyPublic: false };
  try {
    const svc = createSvc(url, key);
    const { data } = await svc.from("app_flags").select("key,value").in("key", ["vsat_public", "vsat_legacy_public"]);
    const m = new Map((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
    return {
      applyPublic: (m.get("vsat_public") ?? "").toLowerCase() === "on",
      legacyPublic: (m.get("vsat_legacy_public") ?? "").toLowerCase() === "on",
    };
  } catch {
    return { applyPublic: false, legacyPublic: false };
  }
}
