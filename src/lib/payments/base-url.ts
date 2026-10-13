/**
 * Resolve the base URL for payment callbacks + emailed links from the ACTUAL request
 * origin — so staging stays on staging and prod on prod, instead of a hard-coded domain.
 * Allowlisted to our own hosts so a spoofed Origin header can never be turned into an
 * open redirect; falls back to env/prod when the origin is missing or untrusted.
 */
export function safeBaseUrl(req: Request): string {
  const envSite = (process.env.NEXT_PUBLIC_SITE_URL || "https://one.vedam.org").replace(/\/+$/, "");
  const allow = (h: string) => {
    h = (h || "").toLowerCase();
    return h === "vedam.org" || h.endsWith(".vedam.org") || h.endsWith(".vercel.app");
  };
  // 1) Origin header — modern browsers send it on same-origin POST
  const origin = req.headers.get("origin");
  if (origin) {
    try { const u = new URL(origin); if (u.protocol === "https:" && allow(u.hostname)) return `${u.protocol}//${u.host}`; } catch { /* */ }
  }
  // 2) forwarded host (server-to-server / no Origin)
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = (req.headers.get("x-forwarded-proto") || "https").split(",")[0].trim();
  if (host) {
    try { const u = new URL(`${proto}://${host}`); if (allow(u.hostname)) return `${u.protocol}//${u.host}`; } catch { /* */ }
  }
  return envSite;
}
