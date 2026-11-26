import { describe, expect, it } from "vitest";
import { confirmationChoice, draftOf, feeInput, notesChanges, parseProposedFee, type CounsellingNotes } from "./counselling-notes";

const saved = (over: Partial<CounsellingNotes> = {}): CounsellingNotes => ({
  application_id: "A1", editable: true, additional_comments: null, proposed_fee: null, confirmation: null,
  online_slot: "2026-12-02T13:00:00+00:00", programme_fee: 1850000, updated_at: null, ...over,
});

describe("parseProposedFee (0193)", () => {
  it("reads whole rupees with or without commas and ₹; empty clears it", () => {
    expect(parseProposedFee("15,00,000", 1850000)).toEqual({ ok: true, value: 1500000 });
    expect(parseProposedFee("₹ 15,00,000", 1850000)).toEqual({ ok: true, value: 1500000 });
    expect(parseProposedFee("1500000", 1850000)).toEqual({ ok: true, value: 1500000 });
    expect(parseProposedFee("0", 1850000)).toEqual({ ok: true, value: 0 });
    expect(parseProposedFee("  ", 1850000)).toEqual({ ok: true, value: null });
  });
  it("refuses part rupees, negatives, words and more than the programme fee (as the database does)", () => {
    for (const bad of ["1500.50", "-5", "15 lakh", "1e6"]) expect(parseProposedFee(bad, 1850000).ok).toBe(false);
    expect(parseProposedFee("18,50,001", 1850000)).toEqual({ ok: false, error: "Proposed fee can't be more than ₹18,50,000 (the programme fee)." });
    expect(parseProposedFee("18,50,000", 1850000)).toEqual({ ok: true, value: 1850000 });
    expect(parseProposedFee("100000001", null).ok).toBe(false);
  });
});

describe("notesChanges (0193): only what changed is sent", () => {
  it("nothing changed → nothing to send", () => {
    const s = saved({ additional_comments: "call back", proposed_fee: 1500000, confirmation: true });
    expect(notesChanges(s, draftOf(s))).toEqual({ ok: true, payload: null });
  });
  it("sends the changed fields only; trims text; empty / Not set clear", () => {
    const s = saved({ additional_comments: "call back", proposed_fee: 1500000, confirmation: true });
    expect(notesChanges(s, { comments: "  parents visit Monday ", fee: "15,00,000", confirmation: "yes" }))
      .toEqual({ ok: true, payload: { application_id: "A1", additional_comments: "parents visit Monday" } });
    expect(notesChanges(s, { comments: "", fee: "", confirmation: "" }))
      .toEqual({ ok: true, payload: { application_id: "A1", additional_comments: null, proposed_fee: null, confirmation: null } });
    expect(notesChanges(s, { comments: "call back", fee: "16,00,000", confirmation: "no" }))
      .toEqual({ ok: true, payload: { application_id: "A1", proposed_fee: 1600000, confirmation: false } });
  });
  it("Confirmation needs a booked online session; clearing it never does", () => {
    const s = saved({ online_slot: null });
    expect(notesChanges(s, { comments: "", fee: "", confirmation: "yes" })).toEqual({ ok: false, error: "Confirmation is only for a booked online session." });
    expect(notesChanges(saved({ online_slot: null, confirmation: null }), { comments: "x", fee: "", confirmation: "" }))
      .toEqual({ ok: true, payload: { application_id: "A1", additional_comments: "x" } });
  });
  it("comments: at most 2,000 characters, counted as the database counts them", () => {
    expect(notesChanges(saved(), { comments: "z".repeat(2001), fee: "", confirmation: "" }).ok).toBe(false);
    expect(notesChanges(saved(), { comments: "😀".repeat(2000), fee: "", confirmation: "" }).ok).toBe(true);
  });
  it("a wrong fee stops the save with its reason", () => {
    expect(notesChanges(saved(), { comments: "", fee: "abc", confirmation: "" })).toEqual({ ok: false, error: "Proposed fee: whole rupees only, for example 15,00,000." });
  });
});

describe("drawer values (0193)", () => {
  it("fee box and Confirmation choice", () => {
    expect(feeInput(1500000)).toBe("15,00,000");
    expect(feeInput(null)).toBe("");
    expect([confirmationChoice(true), confirmationChoice(false), confirmationChoice(null)]).toEqual(["yes", "no", ""]);
  });
});
