import { describe, it, expect } from "vitest";
import { computeVsatFee, VSAT_24H_COUPON, VSAT_EARLY_REG_COUPON, VSAT_EARLY_REG_SOURCE } from "./vsat-fee";

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

describe("computeVsatFee — manual coupon merge (never stacks on the 24h)", () => {
  const within = { fee: 1000, discount24h: 200, applicantCreatedAt: new Date(T0).toISOString(), now: T0 + 3_600_000 }; // +1h
  const after = { fee: 1000, discount24h: 200, applicantCreatedAt: new Date(T0).toISOString(), now: T0 + 25 * 3_600_000 }; // +25h

  it("₹750 coupon INSIDE 24h → total 750 (200 auto + 550 coupon), net 250", () => {
    const f = computeVsatFee({ ...within, coupon: { code: "SAVE750", amount: 750, discount_type: "flat" } });
    expect(f.discount).toBe(750);
    expect(f.net).toBe(250);
    expect(f.autoDiscount).toBe(200);
    expect(f.couponDiscount).toBe(550);
    expect(f.couponCode).toBe("SAVE750");
    expect(f.coupon).toBe("SAVE750");
  });

  it("₹750 coupon AFTER 24h → full 750 off, net 250", () => {
    const f = computeVsatFee({ ...after, coupon: { code: "SAVE750", amount: 750, discount_type: "flat" } });
    expect(f.discount).toBe(750);
    expect(f.net).toBe(250);
    expect(f.autoDiscount).toBe(0);
    expect(f.couponDiscount).toBe(750);
  });

  it("coupon worth LESS than the active auto-discount adds nothing extra", () => {
    const f = computeVsatFee({ ...within, coupon: { code: "SMALL100", amount: 100, discount_type: "flat" } });
    expect(f.discount).toBe(200); // auto wins
    expect(f.net).toBe(800);
    expect(f.couponDiscount).toBe(0);
  });

  it("percent coupon is computed off the base fee, then merged", () => {
    const f = computeVsatFee({ ...within, coupon: { code: "HALF", amount: 50, discount_type: "percent" } });
    expect(f.discount).toBe(500); // max(200 auto, 500 coupon)
    expect(f.net).toBe(500);
    expect(f.couponDiscount).toBe(300);
  });

  it("coupon never drops net below zero", () => {
    const f = computeVsatFee({ ...after, coupon: { code: "HUGE", amount: 5000, discount_type: "flat" } });
    expect(f.discount).toBe(1000);
    expect(f.net).toBe(0);
  });
});

describe("computeVsatFee — VSAT early-registration floor (₹500, merges not stacks)", () => {
  const within = { fee: 1000, discount24h: 200, applicantCreatedAt: new Date(T0).toISOString(), now: T0 + 3_600_000, earlyReg: true, earlyRegDiscount: 500 };
  const after = { fee: 1000, discount24h: 200, applicantCreatedAt: new Date(T0).toISOString(), now: T0 + 25 * 3_600_000, earlyReg: true, earlyRegDiscount: 500 };

  it("INSIDE 24h → ₹500 off = ₹200 early-bird + ₹300 early-registration, net 500", () => {
    const f = computeVsatFee(within);
    expect(f.discount).toBe(500);
    expect(f.net).toBe(500);
    expect(f.autoDiscount).toBe(200);
    expect(f.earlyRegDiscount).toBe(300);
    expect(f.earlyReg).toBe(true);
    expect(f.source).toBe(VSAT_EARLY_REG_SOURCE);
    expect(f.coupon).toBe(VSAT_EARLY_REG_COUPON);
  });

  it("AFTER 24h → full ₹500 off, net 500", () => {
    const f = computeVsatFee(after);
    expect(f.discount).toBe(500);
    expect(f.net).toBe(500);
    expect(f.autoDiscount).toBe(0);
    expect(f.earlyRegDiscount).toBe(500);
    expect(f.earlyReg).toBe(true);
    expect(f.coupon).toBe(VSAT_EARLY_REG_COUPON);
  });

  it("a BIGGER coupon still beats the floor (floor, not exact)", () => {
    const f = computeVsatFee({ ...within, coupon: { code: "SAVE750", amount: 750, discount_type: "flat" } });
    expect(f.discount).toBe(750);
    expect(f.net).toBe(250);
    expect(f.couponDiscount).toBe(550); // 200 auto + 550 coupon
    expect(f.earlyRegDiscount).toBe(0);
    expect(f.earlyReg).toBe(false);
    expect(f.couponCode).toBe("SAVE750");
  });

  it("a SMALLER coupon loses to the floor (student still gets ₹500)", () => {
    const f = computeVsatFee({ ...within, coupon: { code: "SMALL300", amount: 300, discount_type: "flat" } });
    expect(f.discount).toBe(500);
    expect(f.net).toBe(500);
    expect(f.couponDiscount).toBe(0);
    expect(f.earlyRegDiscount).toBe(300);
    expect(f.earlyReg).toBe(true);
    expect(f.source).toBe(VSAT_EARLY_REG_SOURCE);
  });

  it("not an early registrant → floor never applies (unchanged behaviour)", () => {
    const f = computeVsatFee({ ...within, earlyReg: false });
    expect(f.discount).toBe(200);
    expect(f.net).toBe(800);
    expect(f.earlyRegDiscount).toBe(0);
    expect(f.earlyReg).toBe(false);
    expect(f.coupon).toBe(VSAT_24H_COUPON);
  });

  it("floor not configured (0) → no early-reg discount even if early registrant", () => {
    const f = computeVsatFee({ ...after, earlyRegDiscount: 0 });
    expect(f.discount).toBe(0);
    expect(f.net).toBe(1000);
    expect(f.earlyReg).toBe(false);
  });

  it("floor is capped at the fee (net never below 0)", () => {
    const f = computeVsatFee({ fee: 400, discount24h: 200, applicantCreatedAt: new Date(T0).toISOString(), now: T0 + 25 * 3_600_000, earlyReg: true, earlyRegDiscount: 500 });
    expect(f.discount).toBe(400);
    expect(f.net).toBe(0);
    expect(f.earlyReg).toBe(true);
  });
});
