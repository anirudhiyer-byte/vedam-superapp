import { describe, it, expect } from "vitest";
import { computeVsatFee, VSAT_24H_COUPON } from "./vsat-fee";

const T0 = Date.parse("2026-11-01T10:00:00+05:30"); // when the applicant was created

describe("computeVsatFee — 24h early-bird discount", () => {
  it("applies the discount inside the 24h window", () => {
    const f = computeVsatFee({ fee: 1000, discount24h: 200, applicantCreatedAt: new Date(T0).toISOString(), now: T0 + 3_600_000 }); // +1h
    expect(f.base).toBe(1000);
    expect(f.discount).toBe(200);
    expect(f.net).toBe(800);
    expect(f.coupon).toBe(VSAT_24H_COUPON);
    expect(f.within24h).toBe(true);
  });

  it("charges full fee after the window closes", () => {
    const f = computeVsatFee({ fee: 1000, discount24h: 200, applicantCreatedAt: new Date(T0).toISOString(), now: T0 + 25 * 3_600_000 }); // +25h
    expect(f.discount).toBe(0);
    expect(f.net).toBe(1000);
    expect(f.coupon).toBeNull();
    expect(f.within24h).toBe(false);
  });

  it("is exactly inclusive up to the boundary and off just after", () => {
    const justInside = computeVsatFee({ fee: 1000, discount24h: 200, applicantCreatedAt: new Date(T0).toISOString(), now: T0 + 24 * 3_600_000 - 1000 });
    const justOutside = computeVsatFee({ fee: 1000, discount24h: 200, applicantCreatedAt: new Date(T0).toISOString(), now: T0 + 24 * 3_600_000 + 1000 });
    expect(justInside.net).toBe(800);
    expect(justOutside.net).toBe(1000);
  });

  it("never lets the discount exceed the fee (net >= 0)", () => {
    const f = computeVsatFee({ fee: 150, discount24h: 200, applicantCreatedAt: new Date(T0).toISOString(), now: T0 + 1000 });
    expect(f.discount).toBe(150);
    expect(f.net).toBe(0);
  });

  it("no discount configured → full fee, no coupon", () => {
    const f = computeVsatFee({ fee: 1000, discount24h: 0, applicantCreatedAt: new Date(T0).toISOString(), now: T0 + 1000 });
    expect(f.discount).toBe(0);
    expect(f.net).toBe(1000);
    expect(f.coupon).toBeNull();
  });

  it("missing applicant created_at → no discount (safe default)", () => {
    const f = computeVsatFee({ fee: 1000, discount24h: 200, applicantCreatedAt: null, now: T0 });
    expect(f.discount).toBe(0);
    expect(f.net).toBe(1000);
    expect(f.within24h).toBe(false);
  });
});
