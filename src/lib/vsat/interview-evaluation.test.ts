import { describe, expect, it } from "vitest";
import { FINAL_MAX, SUMMARY_LABEL, VERDICT_LABEL, changesVerdict, isVerdict, parseScores, rangeLabels, verdictFor, verdictLabel } from "./interview-evaluation";

describe("verdict words", () => {
  it("are sir's: Selected, Maybe, Rejected", () => {
    expect(VERDICT_LABEL).toEqual({ selected: "Selected", maybe: "Maybe", not_selected: "Rejected" });
    expect(verdictLabel("not_selected")).toBe("Rejected");
    expect(verdictLabel(null)).toBe("Not decided yet");
    expect(verdictLabel("pending")).toBe("Not decided yet");
    expect(isVerdict("maybe")).toBe(true);
    expect(isVerdict("select")).toBe(false);
    expect(SUMMARY_LABEL.all).toBe("Everyone interviewed");
    expect(FINAL_MAX).toBe(20);
  });
});

describe("verdictFor (the same rule as vsat__interview_verdict)", () => {
  it("final score at or above the Selected score → Selected; at or above Maybe → Maybe; else Rejected", () => {
    expect(verdictFor(16, false, 16, 12)).toBe("selected");
    expect(verdictFor(15.99, false, 16, 12)).toBe("maybe");
    expect(verdictFor(12, false, 16, 12)).toBe("maybe");
    expect(verdictFor(11.99, false, 16, 12)).toBe("not_selected");
    expect(verdictFor(14, false, 12, 12)).toBe("selected");  // same score for both: no Maybe range
    expect(verdictFor(11, false, 12, 12)).toBe("not_selected");
  });
  it("cheating → Rejected straight away, even with top scores or no scores yet", () => {
    expect(verdictFor(20, true, 16, 12)).toBe("not_selected");
    expect(verdictFor(20, true, null, null)).toBe("not_selected");
  });
  it("no scores decided (or no score) → no verdict yet", () => {
    expect(verdictFor(18, false, null, null)).toBeNull();
    expect(verdictFor(18, false, 16, null)).toBeNull();
    expect(verdictFor(null, false, 16, 12)).toBeNull();
  });
});

describe("parseScores", () => {
  it("takes two numbers from 0 to 20, up to 2 decimals", () => {
    expect(parseScores("16", "12.5")).toEqual({ ok: true, selectMin: 16, maybeMin: 12.5 });
    expect(parseScores(" 20 ", "0")).toEqual({ ok: true, selectMin: 20, maybeMin: 0 });
    expect(parseScores("14", "14")).toEqual({ ok: true, selectMin: 14, maybeMin: 14 });
  });
  it("refuses empty, out-of-range or badly written scores, and Maybe above Selected", () => {
    expect(parseScores("", "12")).toEqual({ ok: false, error: "The Selected score must be a number from 0 to 20." });
    expect(parseScores("21", "12")).toEqual({ ok: false, error: "The Selected score must be a number from 0 to 20." });
    expect(parseScores("16", "-1")).toEqual({ ok: false, error: "The Maybe score must be a number from 0 to 20." });
    expect(parseScores("16", "12.345")).toEqual({ ok: false, error: "The Maybe score must be a number from 0 to 20." });
    expect(parseScores("1e1", "5")).toEqual({ ok: false, error: "The Selected score must be a number from 0 to 20." });
    expect(parseScores("12", "16")).toEqual({ ok: false, error: "The Maybe score cannot be above the Selected score." });
  });
});

describe("rangeLabels", () => {
  const fmt = (n: number) => String(n);
  it("names each range with its scores", () => {
    expect(rangeLabels(16, 12, fmt)).toEqual({
      selected: "Selected (16 and above)", maybe: "Maybe (12 to below 16)", not_selected: "Rejected (below 12, or cheating)",
    });
    expect(rangeLabels(14, 14, fmt).maybe).toBe("Maybe (none: same score as Selected)");
    expect(rangeLabels(null, null, fmt)).toEqual({ selected: "Selected", maybe: "Maybe", not_selected: "Rejected" });
  });
});

describe("changesVerdict", () => {
  it("is true when the preview verdict differs from the saved one", () => {
    expect(changesVerdict({ verdict: "maybe", verdict_preview: "selected" })).toBe(true);
    expect(changesVerdict({ verdict: null, verdict_preview: "maybe" })).toBe(true);
    expect(changesVerdict({ verdict: "maybe", verdict_preview: "maybe" })).toBe(false);
  });
});
