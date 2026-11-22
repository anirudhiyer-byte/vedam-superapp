import { describe, expect, it } from "vitest";
import { derive, fmtINR, fmtINRk, fmtPct, funnel, perfParams, rangeError, stageCounts, todayIst, type TgStudent } from "./telegram-perf";

describe("worked-out numbers", () => {
  it("total, CPL, CPA, CPP, L2P", () => {
    const d = derive({ influencers: 2, utms: 2, leads: 4, payments: 3, enrollments: 1, cpl_spend: 250, cpa_spend: 1500 });
    expect(d.total_spend).toBe(1750);
    expect(d.overall_cpl).toBe(62.5);
    expect(d.overall_cpa).toBe(500);
    expect(d.overall_cpp).toBeCloseTo(583.33, 2);
    expect(d.l2p).toBe(75);
  });
  it("no leads / payments → zeros, never NaN", () => {
    const d = derive(null);
    expect([d.overall_cpl, d.overall_cpa, d.overall_cpp, d.l2p, d.total_spend]).toEqual([0, 0, 0, 0, 0]);
    expect(derive({ leads: 5, payments: 0, cpa_spend: 100 }).overall_cpa).toBe(0);
  });
  it("numbers sent as strings (Postgres numeric) still add up", () => {
    expect(derive({ cpl_spend: "200.50" as unknown as number, cpa_spend: "1000" as unknown as number }).total_spend).toBe(1200.5);
  });
});

describe("formats (CRM)", () => {
  it("₹ with 2 decimals, short ₹, percent", () => {
    expect(fmtINR(62.5)).toBe("₹62.50");
    expect(fmtINRk(950)).toBe("₹950");
    expect(fmtINRk(12_400)).toBe("₹12K");
    expect(fmtINRk(340_000)).toBe("₹3.40L");
    expect(fmtINRk(12_500_000)).toBe("₹1.25Cr");
    expect(fmtPct(75)).toBe("75.00%");
  });
});

describe("funnel", () => {
  it("widths against leads (min 2%), rates", () => {
    const f = funnel(200, 50, 10);
    expect([f.leads, f.payments, f.enrollments]).toEqual([100, 25, 5]);
    expect([f.paidRate, f.enrolRate]).toEqual(["25.00", "20.00"]);
    expect(funnel(0, 0, 0)).toMatchObject({ leads: 2, paidRate: "0.00", enrolRate: "0.00" });
  });
});

describe("filters", () => {
  it("leaves empty values out", () => {
    expect(perfParams({ from: "2025-11-20", to: "", campaign: "", influencer: "zz alpha" })).toEqual({ start: "2025-11-20", influencer: "zz alpha" });
  });
  it("From after To is an error", () => {
    expect(rangeError("2026-02-01", "2026-01-01")).toMatch(/on or before/);
    expect(rangeError("2026-01-01", "2026-01-01")).toBeNull();
  });
  it("today in India", () => {
    expect(todayIst(Date.parse("2026-11-21T20:00:00Z"))).toBe("2026-11-22");
  });
});

describe("drill stage breakdown", () => {
  it("counts per stage, biggest first, empty stage = no application", () => {
    const s = (stage: string | null) => ({ stage } as TgStudent);
    expect(stageCounts([s("enrolled"), s(null), s("vsat_cleared"), s(null)])).toEqual([["no_application", 2], ["enrolled", 1], ["vsat_cleared", 1]]);
  });
});
