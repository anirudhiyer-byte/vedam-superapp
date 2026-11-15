import { describe, it, expect } from "vitest";
import { computeVps, DEFAULT_VPS_ANCHORS } from "./vps";

describe("computeVps — percentile -> 0-10 VPS (piecewise linear)", () => {
  it("hits the anchor points exactly", () => {
    expect(computeVps(50)).toBe(7.5);
    expect(computeVps(100)).toBe(10);
    expect(computeVps(0)).toBe(0);
  });
  it("interpolates linearly between anchors", () => {
    expect(computeVps(75)).toBe(8.75); // halfway 50(7.5)->100(10)
    expect(computeVps(25)).toBe(3.75); // halfway 0(0)->50(7.5)
  });
  it("clamps beyond the end anchors to the nearest anchor's vps", () => {
    const anchors = [{ percentile: 40, vps: 6 }, { percentile: 90, vps: 10 }];
    expect(computeVps(10, anchors)).toBe(6);  // below lowest -> lowest vps
    expect(computeVps(99, anchors)).toBe(10); // above highest -> highest vps
  });
  it("respects a different per-cycle curve (60 = 7.5)", () => {
    const anchors = [{ percentile: 0, vps: 0 }, { percentile: 60, vps: 7.5 }, { percentile: 100, vps: 10 }];
    expect(computeVps(60, anchors)).toBe(7.5);
    expect(computeVps(80, anchors)).toBe(8.75);
  });
  it("clamps percentile input to 0-100 and output to 0-10", () => {
    expect(computeVps(150)).toBe(10);
    expect(computeVps(-20)).toBe(0);
  });
  it("empty anchors -> 0 (safe)", () => {
    expect(computeVps(80, [])).toBe(0);
  });
  it("default anchors export is the 0/50/100 curve", () => {
    expect(DEFAULT_VPS_ANCHORS).toHaveLength(3);
  });
});
