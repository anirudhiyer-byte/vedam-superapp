/**
 * PeerPath · request guards shared by the booking API routes (server only).
 * Pure helpers, unit-tested.
 */

/** Largest request body we read (a booking is ~200 bytes). */
export const MAX_BODY_BYTES = 8192;

/** The only fields a browser may send for a booking. Everything else is dropped. */
export const BOOK_FIELDS = ["seniorId", "start", "type", "duration", "question", "rescheduleOf"] as const;

/**
 * CSRF guard for cookie-authenticated requests: the Origin header must be this
 * site. Browsers always send Origin on cross-site POSTs and cannot fake it.
 * Missing / "null" / malformed Origin → refused.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host || origin === "null") return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** `Authorization: Bearer <jwt>` (API clients). Browsers never attach this on their own, so it is not CSRF-able. */
export function bearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

/** Read the body as one JSON object, at most `max` bytes. Anything else → null. */
export async function readJsonObject(req: Request, max = MAX_BODY_BYTES): Promise<Record<string, unknown> | null> {
  let text: string;
  try {
    text = await req.text();
  } catch {
    return null;
  }
  if (!text || new TextEncoder().encode(text).length > max) return null;
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Copy only the booking fields (own properties only; no prototype tricks). */
export function pickBookFields(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of BOOK_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(o, k)) out[k] = o[k];
  }
  return out;
}
