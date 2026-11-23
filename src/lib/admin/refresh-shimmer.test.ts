import { describe, expect, it } from "vitest";
import { REFRESH_MIN_MS, refreshHoldMs } from "./refresh-shimmer";

describe("refresh shimmer timing", () => {
  it("stays on while the data is loading", () => {
    expect(refreshHoldMs(0, 5000, true)).toBeNull();
  });
  it("a fast load still shows one full sweep (the rest of the minimum)", () => {
    expect(refreshHoldMs(1000, 1300, false)).toBe(REFRESH_MIN_MS - 300);
  });
  it("a slow load ends as soon as the data is in", () => {
    expect(refreshHoldMs(1000, 1000 + REFRESH_MIN_MS + 500, false)).toBe(0);
  });
  it("a clock that goes backwards never makes it longer than the minimum", () => {
    expect(refreshHoldMs(2000, 1000, false)).toBe(REFRESH_MIN_MS);
  });
  it("the minimum covers one sweep of light (1.05 s in the CSS)", () => {
    expect(REFRESH_MIN_MS).toBeGreaterThanOrEqual(1050);
  });
});
