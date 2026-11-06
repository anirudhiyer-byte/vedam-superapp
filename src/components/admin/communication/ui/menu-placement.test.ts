/** Manage List row menu: opens upward only when it would be cut off below and there is more room above. */
import { describe, expect, it } from "vitest";
import { fixedMenuPosition, opensUp } from "./menu-placement";

const clip = { top: 100, bottom: 700 };   // the table's scroll box on screen
const MENU = 300;                          // seven items

describe("opensUp", () => {
  it("first rows: plenty of room below → opens downward (as before)", () => {
    expect(opensUp({ top: 150, bottom: 182 }, clip, MENU)).toBe(false);
  });
  it("last row: not enough room below, room above → opens upward (the clip fix)", () => {
    expect(opensUp({ top: 640, bottom: 672 }, clip, MENU)).toBe(true);
  });
  it("exactly enough room below → stays downward", () => {
    expect(opensUp({ top: 362, bottom: 394 }, clip, MENU)).toBe(false);   // 700 - 394 - 6 = 300
  });
  it("tight on both sides → picks the side with more room", () => {
    expect(opensUp({ top: 380, bottom: 412 }, clip, 400)).toBe(false);   // below 282 > above 274
    expect(opensUp({ top: 420, bottom: 452 }, clip, 400)).toBe(true);    // above 314 > below 242
  });
});

/** Portal menu (position: fixed, placed from the trigger's rect, kept inside the window). */
describe("fixedMenuPosition", () => {
  const desktop = { width: 1366, height: 900 };
  const phone = { width: 375, height: 800 };
  const MENU2 = { width: 208, height: 96 };    // Edit + Delete
  const MENU7 = { width: 208, height: 330 };   // Manage List: seven items

  it("one row near the top of a short table: opens downward under the trigger, right-aligned", () => {
    const trigger = { top: 300, bottom: 332, left: 1300, right: 1332 };
    expect(fixedMenuPosition(trigger, MENU2, desktop, "right")).toEqual({ top: 338, left: 1124, up: false });
  });
  it("trigger near the bottom of the window: opens upward, fully visible", () => {
    const trigger = { top: 840, bottom: 872, left: 1300, right: 1332 };
    const p = fixedMenuPosition(trigger, MENU7, desktop, "right");
    expect(p.up).toBe(true);
    expect(p.top).toBe(840 - 6 - 330);
    expect(p.top + MENU7.height).toBeLessThanOrEqual(desktop.height - 8);
  });
  it("375px: a right-aligned menu never goes off the left or right edge", () => {
    const nearLeft = fixedMenuPosition({ top: 200, bottom: 244, left: 16, right: 60 }, MENU2, phone, "right");
    expect(nearLeft.left).toBe(8);
    const nearRight = fixedMenuPosition({ top: 200, bottom: 244, left: 320, right: 364 }, MENU2, phone, "left");
    expect(nearRight.left).toBe(375 - 208 - 8);
  });
  it("left-aligned menu starts at the trigger's left edge", () => {
    expect(fixedMenuPosition({ top: 100, bottom: 132, left: 400, right: 432 }, MENU2, desktop, "left")).toEqual({ top: 138, left: 400, up: false });
  });
  it("a window shorter than the menu: pinned to the top margin instead of going off screen", () => {
    const p = fixedMenuPosition({ top: 150, bottom: 182, left: 300, right: 332 }, MENU7, { width: 375, height: 300 }, "right");
    expect(p.top).toBe(8);
  });
  it("tight on both sides: picks the side with more room, then keeps it inside the window", () => {
    const p = fixedMenuPosition({ top: 420, bottom: 452, left: 900, right: 932 }, { width: 208, height: 500 }, desktop, "right");
    expect(p.up).toBe(false);   // below 900-452-14 = 434 > above 420-14 = 406
    expect(p.top + 500).toBeLessThanOrEqual(desktop.height - 8);
  });
});
