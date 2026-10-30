import { describe, expect, it } from "vitest";
import { validateStageUpdates } from "./stage-updates";

describe("validateStageUpdates (H-01: users can no longer write payment fields)", () => {
  it("accepts the fields users may still change, with valid values", () => {
    expect(validateStageUpdates({ form_stage_1: "form_initiated" })).toEqual({ ok: true, updates: { form_stage_1: "form_initiated" } });
    expect(validateStageUpdates({ application_stage_1: "slot_selected", vsat_slot_datetime_1: "2026-11-06T10:00:00.000Z" }).ok).toBe(true);
  });
  it("rejects every payment field (the self-approval hole)", () => {
    for (const k of ["payment_stage_1", "payment_stage_2", "payment_stage_1_at", "payment_stage_2_at", "payment_status",
      "payment_amount", "payment_approved_date", "payment_fail_reason_1", "application_fee_amount", "order_id", "transaction_id",
      "discount", "discount_coupon", "seat_booking_amount", "vsat_paid_at"]) {
      const r = validateStageUpdates({ [k]: "payment_approved" });
      expect(r).toEqual({ ok: false, error: "field_not_allowed", field: k });
    }
  });
  it("rejects a payment field even when sent next to an allowed one", () => {
    expect(validateStageUpdates({ form_stage_1: "form_initiated", payment_stage_1: "payment_approved" }))
      .toEqual({ ok: false, error: "field_not_allowed", field: "payment_stage_1" });
  });
  it("rejects unknown fields", () => {
    expect(validateStageUpdates({ remarks: "hi" })).toEqual({ ok: false, error: "field_not_allowed", field: "remarks" });
  });
  it("validates values", () => {
    expect(validateStageUpdates({ form_stage_1: "hacked" })).toEqual({ ok: false, error: "invalid_value", field: "form_stage_1" });
    expect(validateStageUpdates({ application_stage_1: "superuser" })).toEqual({ ok: false, error: "invalid_value", field: "application_stage_1" });
    expect(validateStageUpdates({ vsat_slot_datetime_1: "tomorrow" })).toEqual({ ok: false, error: "invalid_value", field: "vsat_slot_datetime_1" });
    expect(validateStageUpdates({ form_stage_1: 1 })).toEqual({ ok: false, error: "invalid_value", field: "form_stage_1" });
    expect(validateStageUpdates({ form_stage_1: null })).toEqual({ ok: false, error: "invalid_value", field: "form_stage_1" });
  });
  it("rejects a non-object or empty update", () => {
    for (const bad of [null, undefined, "x", 42, [], {}]) expect(validateStageUpdates(bad).ok).toBe(false);
  });
  it("rejects too many keys", () => {
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, "v"]));
    expect(validateStageUpdates(many).ok).toBe(false);
  });
});
