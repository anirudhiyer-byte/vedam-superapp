import { describe, expect, it } from "vitest";
import { costPer, fmt, inr, pct, periodRange, personStatus, sourceLabel, type Person } from "./lib";

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
