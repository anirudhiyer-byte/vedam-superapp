import { describe, expect, it } from "vitest";
import { overallArpu, parseLakh, ruleErrors, sameBands, toLakhText } from "./buckets";
import { errorText } from "./pipeline";
import type { Band } from "./settings";

const band = (category: number, min_score: number, max_score: number, steps: number, min_award: number, max_award: number): Band =>
  ({ category, min_score, max_score, steps, min_award, max_award });

describe("Buckets (0188): sir's rule, ARPU, the target box", () => {
  it("5 points per bucket: 3 buckets = 90–100, 2 = 50–55, 1 = one value; anything else is named", () => {
    expect(ruleErrors([band(1, 95, 100, 3, 90, 100), band(2, 0, 95, 2, 50, 55), band(3, 0, 50, 1, 5, 5)])).toEqual([]);
    const e = ruleErrors([band(5, 75, 80, 2, 35, 45), band(1, 95, 100, 3, 80, 100)]);
    expect(e).toHaveLength(2);
    expect(e[0]).toBe("Category 5 has 2 buckets, so its award range must be 5 points (5 each): 35–40%.");
    expect(e[1]).toMatch(/^Category 1 has 3 buckets, so its award range must be 10 points/);
  });
  it("sir's GGN sheet follows the rule; Pune's category 5 (35–45%, 2 buckets) does not", () => {
    const ggn = [band(1, 95, 100, 2, 95, 100), band(2, 90, 95, 2, 85, 90), band(3, 85, 90, 2, 75, 80), band(4, 80, 85, 2, 65, 70),
      band(5, 75, 80, 2, 55, 60), band(6, 70, 75, 2, 45, 50), band(7, 65, 70, 3, 30, 40), band(8, 0, 65, 5, 5, 25)];
    expect(ruleErrors(ggn)).toEqual([]);
    const pune = [band(1, 95, 100, 3, 90, 100), band(2, 90, 95, 3, 75, 85), band(3, 85, 90, 3, 60, 70), band(4, 80, 85, 2, 50, 55),
      band(5, 75, 80, 2, 35, 45), band(6, 70, 75, 2, 30, 35), band(7, 65, 70, 3, 15, 25), band(8, 0, 65, 2, 5, 10)];
    expect(ruleErrors(pune).map((m) => m.slice(0, 10))).toEqual(["Category 5"]);
  });
  it("overall ARPU is weighted by students; campuses with nobody are left out", () => {
    expect(overallArpu([{ students: 3, arpu: 1541667 }, { students: 1, arpu: 1350000 }])).toBe(1493750);
    expect(overallArpu([{ students: 0, arpu: null }, { students: 2, arpu: 1200000 }])).toBe(1200000);
    expect(overallArpu([])).toBeNull();
  });
  it("target typed in lakh: 12.5 → ₹12,50,000; junk refused", () => {
    expect(parseLakh("12.5")).toBe(1_250_000);
    expect(parseLakh(" 14 ")).toBe(1_400_000);
    expect(parseLakh("13.25")).toBe(1_325_000);
    for (const bad of ["", "abc", "-1", "0", "12.555", "1e6", "12,50,000"]) expect(parseLakh(bad)).toBeNull();
    expect(toLakhText(1_250_000)).toBe("12.5");
    expect(toLakhText(null)).toBe("");
  });
  it("sameBands ignores order and number types", () => {
    const a = [band(1, 50, 100, 2, 10, 15), band(2, 0, 50, 1, 5, 5)];
    expect(sameBands(a, [...a].reverse())).toBe(true);
    expect(sameBands(a, [band(1, 50, 100, 2, 10, 15), band(2, 0, 50, 1, 5, 6)])).toBe(false);
  });
  it("the database's messages read as plain words", () => {
    expect(errorText("BAD_BANDS: category 5 has 2 buckets, so its award range must be 5 points (5 each)"))
      .toBe("Category 5 has 2 buckets, so its award range must be 5 points (5 each).");
    expect(errorText("LOCKED")).toMatch(/locked/);
    expect(errorText("BAD_VALUE: arpu_target")).toBe('Please check "ARPU target".');
  });
});
