/** Banner note (live-config): the Suppressions page says add/remove is on only when its write flag is on; every other page is unchanged. */
import { describe, expect, it } from "vitest";
import { LIVE_WRITES, canWriteLive, liveNote } from "./live-config";

const ON = { suppressions: true };
const OFF = { suppressions: false };

describe("liveNote", () => {
  it("flag ON: Suppressions says add and remove are enabled, one contact at a time", () => {
    expect(liveNote("suppressions", ON)).toBe("add and remove enabled (one contact at a time).");
    expect(canWriteLive("suppressions", ON)).toBe(true);
  });
  it("flag OFF: Suppressions keeps the old read-only text", () => {
    expect(liveNote("suppressions", OFF)).toBe("read-only for now.");
    expect(canWriteLive("suppressions", OFF)).toBe(false);
  });
  it("other pages are unchanged whatever the flag", () => {
    for (const w of [ON, OFF]) {
      expect(liveNote("commLogs", w)).toBe("read-only for now.");
      expect(liveNote("performance", w)).toBe("read-only for now.");
      expect(liveNote("lists", w)).toBe("counts and masked samples only, nothing is sent.");
    }
  });
  it("a page that is not live cannot write, even if someone sets a flag for it", () => {
    expect(canWriteLive("automation", { automation: true })).toBe(false);
  });
  it("the app uses LIVE_WRITES by default (no argument)", () => {
    expect(liveNote("suppressions")).toBe(liveNote("suppressions", LIVE_WRITES));
  });
});
