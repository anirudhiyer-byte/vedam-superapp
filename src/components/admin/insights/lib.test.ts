import { describe, expect, it } from "vitest";
import { MATRIX_COLUMNS, VSAT_STEPS, columnTotals, costPer, fmt, inr, overIndexed, pct, peopleFor, periodRange, personStatus, sourceLabel, type Person } from "./lib";

// Thu 5 Nov 2026, 15:30 IST = 10:00 UTC
const NOW = new Date("2026-11-05T10:00:00Z");

describe("periodRange (IST)", () => {
  it("all time has no bounds", () => {
    expect(periodRange("all", NOW)).toEqual({ p_from: null, p_to: null });
  });
  it("today starts at IST midnight", () => {
    expect(periodRange("today", NOW).p_from).toBe("2026-11-04T18:30:00.000Z");
  });
  it("this week starts on Monday (2 Nov) at IST midnight", () => {
    expect(periodRange("week", NOW).p_from).toBe("2026-11-01T18:30:00.000Z");
  });
  it("this month starts on the 1st, this year on 1 Jan", () => {
    expect(periodRange("month", NOW).p_from).toBe("2026-10-31T18:30:00.000Z");
    expect(periodRange("year", NOW).p_from).toBe("2025-12-31T18:30:00.000Z");
  });
  it("just after IST midnight still counts as the new day", () => {
    // 6 Nov 00:10 IST = 5 Nov 18:40 UTC
    expect(periodRange("today", new Date("2026-11-05T18:40:00Z")).p_from).toBe("2026-11-05T18:30:00.000Z");
  });
  it("a Monday is the start of its own week", () => {
    // Mon 9 Nov 09:00 IST
    expect(periodRange("week", new Date("2026-11-09T03:30:00Z")).p_from).toBe("2026-11-08T18:30:00.000Z");
  });
  it("ends just after now", () => {
    const { p_to } = periodRange("month", NOW);
    expect(new Date(p_to!).getTime()).toBeGreaterThan(NOW.getTime());
  });
});

describe("numbers", () => {
  it("pct shows one decimal under 10% and none above", () => {
    expect(pct(1, 40)).toBe("2.5%");
    expect(pct(26, 102)).toBe("25%");
    expect(pct(0, 5)).toBe("0%");
    expect(pct(3, 0)).toBe("—");
  });
  it("Indian number and rupee format", () => {
    expect(fmt(123456)).toBe("1,23,456");
    expect(fmt(null)).toBe("—");
    expect(inr(5712)).toBe("₹5,712");
  });
  it("cost per unit only with spend and units", () => {
    expect(costPer(1000, 4)).toBe("₹250");
    expect(costPer(0, 4)).toBe("—");
    expect(costPer(1000, 0)).toBe("—");
    expect(costPer(null, 4)).toBe("—");
  });
});

describe("sourceLabel", () => {
  it("is case- and space-insensitive", () => {
    expect(sourceLabel("whatsapp")).toBe("WhatsApp");
    expect(sourceLabel("WhatsApp")).toBe("WhatsApp");
    expect(sourceLabel(" WHATSAPP ")).toBe("WhatsApp");
    expect(sourceLabel("META")).toBe("Meta");
  });
  it("names blanks and unknown keys sensibly", () => {
    expect(sourceLabel("")).toBe("No source tag");
    expect(sourceLabel(null)).toBe("No source tag");
    expect(sourceLabel("unknown")).toBe("No source tag");
    expect(sourceLabel("vedam_website")).toBe("Vedam website");
    expect(sourceLabel("school_partner")).toBe("School Partner");
  });
});

describe("personStatus", () => {
  it("summarises each product the person used", () => {
    const p = {
      codesprint: { since: "", enrolled: true, lessons: 3, certs: 1 },
      bootcamp: { since: "", registered: 2, attended: 1, stayed: 1, projects: 0 },
      pyq: null,
      cp: { since: "", predictions: 1 },
    } as unknown as Person;
    expect(personStatus(p)).toEqual([
      { product: "codesprint", text: "Enrolled · 3 lessons · 1 cert" },
      { product: "bootcamp", text: "2 registered · 1 attended" },
      { product: "cp", text: "1 prediction" },
    ]);
  });
});

describe("source × product matrix (ins_funnel, 0129)", () => {
  const row = (source: string, all: number, codesprint: number, bootcamp = 0, pyq = 0, cp = 0, vsat = 0) => ({ source, all, codesprint, bootcamp, pyq, cp, vsat });
  const rows = [row("whatsapp", 200, 150, 10), row("meta", 500, 100, 40), row("unknown", 300, 250), row("telegram", 10, 30)];

  it("column totals add every source, including unknown", () => {
    expect(columnTotals(rows)).toEqual({ all: 1010, codesprint: 530, bootcamp: 50, pyq: 0, cp: 0, vsat: 0 });
  });
  it("over-indexed: the source with the biggest share gap, never unknown, only with enough people", () => {
    // whatsapp: 150/530 = 28.3% of CodeSprint vs 200/1010 = 19.8% of sign-ups → +8.5 points
    // unknown has a bigger gap but is excluded; telegram has only 10 sign-ups (< minN 20)
    const o = overIndexed(rows, "codesprint");
    expect(o?.source).toBe("whatsapp");
    expect(o!.productShare).toBeCloseTo(28.3, 1);
    expect(o!.allShare).toBeCloseTo(19.8, 1);
  });
  it("over-indexed: nothing when the gap is under 5 points or the product has no users", () => {
    expect(overIndexed([row("a", 100, 50), row("b", 100, 50)], "codesprint")).toBeNull();
    expect(overIndexed(rows, "pyq")).toBeNull();
    expect(overIndexed([], "codesprint")).toBeNull();
  });
  it("columns start with Vedam One, then every product the database returns", () => {
    expect(MATRIX_COLUMNS.map((c) => c.key)).toEqual(["all", "codesprint", "bootcamp", "pyq", "cp", "vsat"]);
  });
  it("VSAT steps are in funnel order and match the database keys", () => {
    expect(VSAT_STEPS.map((s) => s.key)).toEqual(["mqr", "vsat_early", "applied", "form_submitted", "fee_paid", "exam_taken", "enrolled"]);
  });
});

describe("peopleFor (people drawer filter for a source/state cell)", () => {
  const range = { p_from: "2026-11-01T00:00:00Z", p_to: "2026-11-20T00:00:00Z" };
  it("Vedam One = people who signed up in the period", () => {
    expect(peopleFor("all", range, { p_source: "meta" }, "t")).toEqual({ title: "t", sub: "Signed up in this period", ...range, p_source: "meta" });
  });
  it("a product = people who used it in the period (p_used)", () => {
    expect(peopleFor("codesprint", range, { p_source: "meta" }, "t")).toEqual({ title: "t", sub: "Used CodeSprint in this period", ...range, p_used: "codesprint", p_source: "meta" });
  });
  it("VSAT early wording, and all time when there is no period", () => {
    expect(peopleFor("vsat", { p_from: null, p_to: null }, {}, "t").sub).toBe("Early-registered for VSAT all time");
  });
});
