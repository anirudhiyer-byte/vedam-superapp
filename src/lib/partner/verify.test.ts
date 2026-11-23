import { describe, it, expect } from "vitest";
import { partnerSignature, verifyPartnerRequest } from "./verify";

const SECRET = "test-secret-abc";
const NOW = 1_793_450_000_000; // fixed clock (ms)
const body = JSON.stringify({ phone: "+91 9876543210", name: "Aarav", utm_campaign: "BDM Asha" });

function signedHeaders(rawBody: string, nowMs = NOW, secret = SECRET) {
  const ts = Math.floor(nowMs / 1000).toString();
  return { timestamp: ts, signature: partnerSignature(secret, ts, rawBody) };
}

describe("verifyPartnerRequest", () => {
  it("accepts a correctly signed request", () => {
    expect(verifyPartnerRequest(body, signedHeaders(body), SECRET, NOW)).toEqual({ ok: true });
  });

  it("rejects a tampered body", () => {
    const h = signedHeaders(body);
    const r = verifyPartnerRequest(body + " ", h, SECRET, NOW);
    expect(r.ok).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const r = verifyPartnerRequest(body, signedHeaders(body), "other-secret", NOW);
    expect(r.ok).toBe(false);
  });

  it("rejects a stale timestamp (> 5 min)", () => {
    const h = signedHeaders(body, NOW - 6 * 60_000); // signed 6 min ago
    const r = verifyPartnerRequest(body, h, SECRET, NOW);
    expect(r).toEqual({ ok: false, reason: "timestamp outside the allowed window" });
  });

  it("accepts a timestamp within the 5-min window", () => {
    const h = signedHeaders(body, NOW - 4 * 60_000);
    expect(verifyPartnerRequest(body, h, SECRET, NOW).ok).toBe(true);
  });

  it("rejects missing headers", () => {
    expect(verifyPartnerRequest(body, { timestamp: null, signature: null }, SECRET, NOW).ok).toBe(false);
  });
});
