import { createHmac } from "crypto";

/**
 * Elevate Admissions Portal — request signing (outbound CRM webhook).
 *
 * Auth is the signature, not a login. Each call carries two headers:
 *   x-elevate-timestamp : unix SECONDS, must be within 5 min of Elevate's clock
 *   x-elevate-signature : hex of HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
 *
 * Sign the EXACT bytes you send: serialise the JSON once, sign that string, send
 * that same string. Re-serialising after signing (pretty-print, key re-order, BOM)
 * breaks the signature.
 */
export function elevateSignature(secret: string, timestamp: string | number, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export type ElevateHeaders = {
  "content-type": "application/json";
  "x-elevate-timestamp": string;
  "x-elevate-signature": string;
};

/** Build the headers for a body you've already serialised. nowMs lets tests pin the clock. */
export function elevateHeaders(secret: string, rawBody: string, nowMs: number = Date.now()): ElevateHeaders {
  const timestamp = Math.floor(nowMs / 1000).toString();
  return {
    "content-type": "application/json",
    "x-elevate-timestamp": timestamp,
    "x-elevate-signature": elevateSignature(secret, timestamp, rawBody),
  };
}
