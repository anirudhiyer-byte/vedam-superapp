/** Manage List row menu: opens upward only when it would be cut off below and there is more room above. */
import { describe, expect, it } from "vitest";
import { opensUp } from "./menu-placement";

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
