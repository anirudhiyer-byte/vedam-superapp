import { createHmac, timingSafeEqual } from "crypto";

/**
 * Inbound partner webhook (Elevate → Vedam) — request verification.
 *
 * Symmetric with our OUTBOUND scheme (lib/elevate/sign.ts), reversed direction. The partner
 * signs each POST and we verify. Two headers:
 *   x-vedam-timestamp : unix SECONDS, must be within 5 min of our clock (replay protection)
 *   x-vedam-signature : hex of HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
 *
 * Verify against the EXACT raw body bytes received, before JSON.parse.
 */
const WINDOW_SECONDS = 300;

export function partnerSignature(secret: string, timestamp: string | number, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export function verifyPartnerRequest(
  rawBody: string,
  headers: { timestamp?: string | null; signature?: string | null },
  secret: string,
  nowMs: number = Date.now(),
): { ok: true } | { ok: false; reason: string } {
  const ts = headers.timestamp;
  const sig = headers.signature;
  if (!ts || !sig) return { ok: false, reason: "missing signature headers" };
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(nowMs / 1000 - tsNum) > WINDOW_SECONDS) {
    return { ok: false, reason: "timestamp outside the allowed window" };
  }
  const expected = partnerSignature(secret, ts, rawBody);
  // constant-time compare; lengths must match for timingSafeEqual
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(sig, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "bad signature" };
  return { ok: true };
}
