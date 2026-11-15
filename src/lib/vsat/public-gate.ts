import { createClient as createSvc } from "@supabase/supabase-js";

/**
 * VSAT go-live gate (server-side). `vsatLive` is true when the public VSAT signup
 * should be served at /apply:
 *   - staging is always live (environment flag), for testing;
 *   - production goes live only when app_flags.vsat_public = 'on'.
 * Admins always get the live experience (for preview) regardless — callers OR this
 * with their own isAdmin check. Reads flags with the service role (no client access).
 */
export async function readVsatGate(): Promise<{ isStaging: boolean; vsatPublic: boolean; vsatLive: boolean }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { isStaging: false, vsatPublic: false, vsatLive: false };
  try {
    const svc = createSvc(url, key);
    const { data } = await svc.from("app_flags").select("key,value").in("key", ["environment", "vsat_public"]);
    const m = new Map((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
    const isStaging = (m.get("environment") ?? "").toLowerCase() === "staging";
    const vsatPublic = (m.get("vsat_public") ?? "").toLowerCase() === "on";
    return { isStaging, vsatPublic, vsatLive: isStaging || vsatPublic };
  } catch {
    return { isStaging: false, vsatPublic: false, vsatLive: false };
  }
}
