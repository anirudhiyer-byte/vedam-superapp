/** Return links (`?next=`) after log-in / sign-up may only point to a page on this site.
 *  Anything else — another host, protocol-relative `//x`, `/\x`, `javascript:`, `@host`
 *  tricks — falls back (to the home page by default). Returns path + query + hash.
 *  Decodes once more like the forms always did, but never throws on bad input. */
export function safeNext(raw: string | null | undefined, fallback = "/"): string {
  if (!raw) return fallback;
  let s = raw;
  try { s = decodeURIComponent(raw); } catch { /* malformed %-escape: use as-is */ }
  if (!s.startsWith("/") || s.startsWith("//") || s.startsWith("/\\")) return fallback;
  try {
    const base = "https://same-site.invalid";
    const u = new URL(s, base);
    if (u.origin !== base) return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}
