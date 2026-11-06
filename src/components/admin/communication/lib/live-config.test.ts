/** Banner note (live-config): the Suppressions page says add/remove is on only when its write flag is on; every other page is unchanged. */
import { describe, expect, it, onTestFinished } from "vitest";
import { LIVE_PAGES, LIVE_WRITES, canWriteLive, isLivePage, liveNote } from "./live-config";

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
  it("Manage Automation is live now (Slice 8, AUTOMATION_LIVE on) but read-only: the app cannot write to it", () => {
    expect(isLivePage("automation")).toBe(true);
    expect(canWriteLive("automation")).toBe(false);
  });
  it("a page that is not live cannot write, even if someone sets a flag for it (automation forced OFF)", () => {
    // isLivePage reads LIVE_PAGES inside live-config itself, so a module mock cannot reach it: switch the key off for this test only
    const pages = LIVE_PAGES as Record<string, boolean>;
    const was = pages.automation;
    pages.automation = false;
    onTestFinished(() => { pages.automation = was; });
    expect(isLivePage("automation")).toBe(false);
    expect(canWriteLive("automation", { automation: true })).toBe(false);
  });
  it("the app uses LIVE_WRITES by default (no argument)", () => {
    expect(liveNote("suppressions")).toBe(liveNote("suppressions", LIVE_WRITES));
  });
});
