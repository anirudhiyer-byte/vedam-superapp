import { describe, expect, it, vi } from "vitest";
import { pullErrorText, pullVsatResults, type PullPass } from "./pull-results";

const passes = (...list: (PullPass | Error)[]) => {
  let i = 0;
  return vi.fn(async () => { const p = list[Math.min(i++, list.length - 1)]; if (p instanceof Error) throw p; return p; });
};

describe("pull the real-exam results of one VSAT", () => {
  it("keeps going while each pass stores results, then says how many", async () => {
    const pass = passes({ ok: true, total: 50, pulled: 40, remaining: 10 }, { ok: true, total: 50, pulled: 10, remaining: 0 });
    const progress = vi.fn();
    expect(await pullVsatResults("VSAT 1", pass, progress)).toBe("VSAT 1: pulled 50 results. ✓");
    expect(pass).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenCalledWith("Pulling results for VSAT 1: 40 done, 10 to go…");
  });
  it("stops when a pass brings nothing new (those students have not submitted yet)", async () => {
    const pass = passes({ ok: true, total: 50, pulled: 1, remaining: 3 }, { ok: true, total: 50, pulled: 0, remaining: 3 });
    expect(await pullVsatResults("VSAT 1", pass)).toBe("VSAT 1: pulled 1 result. 3 still have no result (not submitted yet) — run again later.");
    expect(pass).toHaveBeenCalledTimes(2);
  });
  it("says so when nobody is assigned to the VSAT", async () => {
    expect(await pullVsatResults("VSAT 1", passes({ ok: true, total: 0, pulled: 0, remaining: 0 }))).toBe("VSAT 1: no applicants are assigned to this VSAT yet.");
  });
  it("turns the route's codes into plain words, and a network failure into one line", async () => {
    expect(await pullVsatResults("V", passes({ ok: false, code: "WHEEBOX_NOT_CONFIGURED" }))).toBe(pullErrorText("WHEEBOX_NOT_CONFIGURED"));
    expect(pullErrorText("FORBIDDEN")).toBe("Admins only.");
    expect(pullErrorText("DATE_UNAVAILABLE")).toBe("This date has no Wheebox test ID.");
    expect(pullErrorText("SOMETHING")).toBe("Couldn't pull results.");
    expect(await pullVsatResults("V", passes(new Error("offline")))).toBe("Couldn’t reach the server while pulling results.");
  });
  it("never loops forever", async () => {
    const pass = passes({ ok: true, total: 9999, pulled: 1, remaining: 9000 });
    expect(await pullVsatResults("V", pass, undefined, 3)).toContain("stopped after 3 passes");
    expect(pass).toHaveBeenCalledTimes(3);
  });
});
