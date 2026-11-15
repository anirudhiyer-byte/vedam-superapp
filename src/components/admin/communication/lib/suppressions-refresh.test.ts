/** After a successful Add / Remove the list and the tab counts are fetched again together (no stale badge). */
import { describe, expect, it, vi } from "vitest";
import { refreshAfterWrite } from "./suppressions-refresh";

describe("refreshAfterWrite", () => {
  it("remove (same tab): list reloaded AND counts bumped", () => {
    const calls: string[] = [];
    refreshAfterWrite({ reload: () => calls.push("list"), bumpCounts: () => calls.push("counts") });
    expect(calls).toEqual(["list", "counts"]);
  });
  it("add into another tab: the tab switch fetches its list, counts bumped, no extra reload", () => {
    const reload = vi.fn(); const bumpCounts = vi.fn(); const switchTab = vi.fn();
    refreshAfterWrite({ reload, bumpCounts, switchTab });
    expect(switchTab).toHaveBeenCalledTimes(1);
    expect(bumpCounts).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });
  it("two writes inside the same minute still give two count refreshes (the old bug)", () => {
    let writes = 0;
    const bump = () => { writes += 1; };
    refreshAfterWrite({ reload: () => {}, bumpCounts: bump });
    refreshAfterWrite({ reload: () => {}, bumpCounts: bump });
    expect(writes).toBe(2);   // the counts request depends on this counter, not only on the minute-precise refreshedAt
  });
});
