import { describe, it, expect } from "vitest";
import { offerPayable } from "./enroll-fee";

const base = {
  enrollment_stage: "not_initiated",
  application_stage_1: "counselling_done",
  scholarship_percentage: 40,
  offer_released_at: "2026-11-01T10:00:00+05:30",
  offer_expires_at: "2026-11-10T23:59:00+05:30",
  offer_cancelled: false,
};
const NOW = Date.parse("2026-11-05T10:00:00+05:30");

describe("offerPayable — enrollment gate", () => {
  it("allows a valid, live offer", () => {
    expect(offerPayable(base, NOW)).toEqual({ ok: true });
  });
  it("blocks when no offer / no scholarship yet", () => {
    expect(offerPayable({ ...base, scholarship_percentage: null }, NOW)).toEqual({ ok: false, code: "no_offer" });
    expect(offerPayable({ ...base, offer_released_at: null }, NOW)).toEqual({ ok: false, code: "no_offer" });
  });
  it("blocks a cancelled offer", () => {
    expect(offerPayable({ ...base, offer_cancelled: true }, NOW)).toEqual({ ok: false, code: "offer_cancelled" });
  });
  it("blocks an expired offer", () => {
    const past = Date.parse("2026-11-20T10:00:00+05:30");
    expect(offerPayable(base, past)).toEqual({ ok: false, code: "offer_expired" });
  });
  it("allows when offer has no expiry", () => {
    expect(offerPayable({ ...base, offer_expires_at: null }, NOW)).toEqual({ ok: true });
  });
  it("blocks when already enrolled", () => {
    expect(offerPayable({ ...base, enrollment_stage: "approved" }, NOW)).toEqual({ ok: false, code: "already_enrolled" });
    expect(offerPayable({ ...base, application_stage_1: "enrolled" }, NOW)).toEqual({ ok: false, code: "already_enrolled" });
  });
  it("blocks a null application", () => {
    expect(offerPayable(null, NOW)).toEqual({ ok: false, code: "not_an_applicant" });
  });
});
