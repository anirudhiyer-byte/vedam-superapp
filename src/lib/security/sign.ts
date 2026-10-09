import crypto from "crypto";

/** Short HMAC tag of a value, for tamper-proof links (unsubscribe, etc.). */
export function sign(value: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(value).digest("hex").slice(0, 32);
}

/** Constant-time string compare (avoids timing oracles on secret/token checks). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
