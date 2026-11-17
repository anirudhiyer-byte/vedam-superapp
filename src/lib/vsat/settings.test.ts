import { describe, expect, it } from "vitest";
import { anchorErrors, anchorsText, awardSteps, bandErrors, bandsToDraft, draftToBands, inr, toFraction, toPct, weightErrors } from "./settings";

describe("weights", () => {
  it("converts between fractions and percentages without float noise", () => {
    expect(toPct(0.15)).toBe(15);
    expect(toFraction(15)).toBe(0.15);
    expect(toFraction(12.5)).toBe(0.125);
  });
  it("accepts a set adding up to 50–100% and refuses the rest", () => {
    expect(weightErrors({ w_communication: 25, w_logic: 25, w_passion: 20, w_achievements: 15, w_why_program: 15 })).toEqual([]);
    expect(weightErrors({ w_communication: 25, w_logic: 25, w_passion: 20, w_achievements: 10, w_why_program: 15 })).toEqual([]); // 95%, the old sheet
    expect(weightErrors({ w_communication: 50, w_logic: 50, w_passion: 20, w_achievements: 15, w_why_program: 15 })[0]).toMatch(/150%/);
    expect(weightErrors({ w_communication: 10, w_logic: 10, w_passion: 10, w_achievements: 10, w_why_program: 5 })[0]).toMatch(/45%/);
    expect(weightErrors({ w_communication: null, w_logic: 25, w_passion: 20, w_achievements: 15, w_why_program: 15 })).toEqual(["Communication: 0 to 100"]);
  });
});

describe("bands", () => {
  const pune = [
    { category: 2, min_score: 90, max_score: 95, steps: 3, min_award: 75, max_award: 85 },
    { category: 1, min_score: 95, max_score: 100, steps: 3, min_award: 90, max_award: 100 },
    { category: 3, min_score: 0, max_score: 90, steps: 2, min_award: 5, max_award: 10 },
  ];
  it("round-trips the database rows through the editor (sorted by category)", () => {
    expect(draftToBands(bandsToDraft(pune))).toEqual([...pune].sort((a, b) => a.category - b.category));
  });
  it("the editor can never leave a gap: each row ends where the one above starts; the last starts at 0", () => {
    const b = draftToBands([{ from: 80, steps: 2, min_award: 50, max_award: 60 }, { from: 55, steps: 2, min_award: 10, max_award: 20 }]);
    expect(b.map((x) => [x.min_score, x.max_score])).toEqual([[80, 100], [0, 80]]);
  });
  it("flags a range that goes the wrong way, bad steps and bad awards", () => {
    const e = bandErrors([{ from: 80, steps: 2, min_award: 50, max_award: 60 }, { from: 90, steps: 1.5, min_award: 30, max_award: 20 }, { from: 0, steps: 2, min_award: 0, max_award: 5 }]);
    expect(e.join(" ")).toMatch(/Category 2: the score range/);
    expect(e.join(" ")).toMatch(/Category 2: steps/);
    expect(e.join(" ")).toMatch(/Category 2: the award/);
    expect(bandErrors([])).toEqual(["Add at least one category."]);
  });
  it("award steps match the database formula", () => {
    expect(awardSteps({ steps: 3, min_award: 90, max_award: 100 })).toEqual([90, 95, 100]);
    expect(awardSteps({ steps: 5, min_award: 5, max_award: 25 })).toEqual([5, 10, 15, 20, 25]);
    expect(awardSteps({ steps: 1, min_award: 30, max_award: 30 })).toEqual([30]);
  });
});

describe("VPS curve", () => {
  it("accepts a rising curve and refuses one that falls or goes out of range", () => {
    expect(anchorErrors([{ percentile: 0, vps: 0 }, { percentile: 65, vps: 7.4 }, { percentile: 100, vps: 9.8 }])).toEqual([]);
    expect(anchorErrors([{ percentile: 50, vps: 7.5 }, { percentile: 40, vps: 8 }]).join(" ")).toMatch(/higher than point 1/);
    expect(anchorErrors([{ percentile: 0, vps: 8 }, { percentile: 100, vps: 7 }]).join(" ")).toMatch(/must not be lower/);
    expect(anchorErrors([{ percentile: 0, vps: 0 }, { percentile: 100, vps: 12 }]).join(" ")).toMatch(/VPS 0 to 10/);
    expect(anchorErrors([{ percentile: 0, vps: 0 }])).toEqual(["Use 2 to 10 points."]);
  });
  it("shows a curve as text", () => {
    expect(anchorsText([{ percentile: 0, vps: 0 }, { percentile: 50, vps: 7.5 }])).toBe("0→0, 50→7.5");
    expect(anchorsText(null)).toBe("—");
  });
});

it("formats rupees the Indian way", () => {
  expect(inr(1850000)).toBe("₹18,50,000");
});
