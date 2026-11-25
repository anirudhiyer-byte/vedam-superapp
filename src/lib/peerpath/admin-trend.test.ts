import { describe, expect, it } from "vitest";
import { istDayFromYmd, PAY_BIN_LABELS, payBinsFor, toDashboardData, trendGroups, type DashTrend } from "./admin-dashboard";
import { allowDemo, demoAdminData, demoInsights, demoTrend } from "./admin-demo";
import { parseImpactTrend } from "./admin-insights";
import type { AdminData, AdminImpactTrend } from "./types";

const NOW = Date.parse("2026-11-25T10:00:00Z"); // Wed 25 Nov, 15:30 IST
const D = 86_400_000;
const ymd = (t: number) => new Date(t + 330 * 60_000).toISOString().slice(0, 10); // IST date of t

/** 91 IST days ending today, like the database returns (oldest first). */
const days91 = (f: (i: number) => Partial<AdminImpactTrend["days"][number]> = () => ({})) =>
  Array.from({ length: 91 }, (_, k) => {
    const i = 90 - k; // days ago
    return { d: ymd(NOW - i * D), tries: 1, booked: 1, chats: 1, paid_after: 0, ...f(i) };
  });
const good = (): AdminImpactTrend => ({ mode: "registered", days: days91(), pay_bins: { "7": [0, 1, 1, 0, 0, 0], "30": [0, 1, 1, 0, 1, 0], "90": [1, 1, 1, 0, 1, 2] } });
const admin = (): AdminData => ({ seniors: [], rules: {}, blocks: {}, settings: {}, bookings: [], feedback: {} });
const NO_IMPACT = { All: null, Pune: null, Gurugram: null };
const dashTrend = (t: AdminImpactTrend = good()): DashTrend => toDashboardData(admin(), NOW, NO_IMPACT, false, { All: t, Pune: null, Gurugram: null }).trend!.All;

describe("parseImpactTrend", () => {
  it("reads a good answer", () => {
    const r = parseImpactTrend(good());
    expect(r?.mode).toBe("registered");
    expect(r?.days).toHaveLength(91);
    expect(r?.days.at(-1)).toEqual({ d: "2026-11-25", tries: 1, booked: 1, chats: 1, paid_after: 0 });
    expect(r?.pay_bins["90"]).toEqual([1, 1, 1, 0, 1, 2]);
  });

  it("accepts numbers sent as strings (Postgres bigint) and copies only the known keys", () => {
    const g = good() as unknown as { days: Record<string, unknown>[]; pay_bins: Record<string, unknown[]> };
    g.days[0] = { ...g.days[0], tries: "12", email: "x@example.com", user_id: "3fa85f64-5717-4562-b3fc-2c963f66afa6" };
    g.pay_bins["7"] = ["0", "2", 0, 0, 0, 0];
    const r = parseImpactTrend(g);
    expect(r?.days[0].tries).toBe(12);
    expect(Object.keys(r!.days[0]).sort()).toEqual(["booked", "chats", "d", "paid_after", "tries"]);
    expect(JSON.stringify(r)).not.toContain("example.com");
    expect(r?.pay_bins["7"]).toEqual([0, 2, 0, 0, 0, 0]);
  });

  it("null for wrong shapes", () => {
    const bad: unknown[] = [null, undefined, "x", 5, [], {}, { mode: "paid" }];
    const noMode = good() as Partial<AdminImpactTrend>;
    delete noMode.mode;
    bad.push(noMode);
    bad.push({ ...good(), days: [] });
    bad.push({ ...good(), days: "[]" });
    bad.push({ ...good(), days: Array.from({ length: 121 }, () => good().days[0]) });
    for (const d of ["2026-13-45", "25-11-2026", "<img src=x>", "2026-11-25T00:00", 20261125]) {
      const g = good();
      (g.days[3] as Record<string, unknown>).d = d;
      bad.push(g);
    }
    for (const v of [-1, "lots", null, Number.NaN, Number.POSITIVE_INFINITY]) {
      const g = good();
      (g.days[5] as Record<string, unknown>).chats = v;
      bad.push(g);
    }
    const noRange = good() as unknown as { pay_bins: Record<string, unknown> };
    delete noRange.pay_bins["30"];
    bad.push(noRange);
    const shortBins = good();
    shortBins.pay_bins["7"] = [0, 1, 2, 3, 4];
    bad.push(shortBins);
    const longBins = good();
    longBins.pay_bins["90"] = [0, 1, 2, 3, 4, 5, 6];
    bad.push(longBins);
    const negBin = good();
    negBin.pay_bins["30"] = [0, -1, 0, 0, 0, 0];
    bad.push(negBin);
    bad.push({ ...good(), pay_bins: [] });
    for (const v of bad) expect(parseImpactTrend(v)).toBeNull();
  });
});

describe("toDashboardData · trends", () => {
  it("copies only counts per day, as IST midnights, oldest first", () => {
    const g = good();
    g.days.reverse(); // order must not matter
    const t = dashTrend(g)!;
    expect(t.days).toHaveLength(91);
    expect(Object.keys(t.days[0]).sort()).toEqual(["booked", "chats", "paidAfter", "t", "tries"]);
    expect(t.days.at(-1)!.t).toBe(Date.parse("2026-11-24T18:30:00Z")); // 25 Nov 00:00 IST
    expect(t.days.every((x, i) => i === 0 || x.t - t.days[i - 1].t === D)).toBe(true);
    expect(t.payBins["30"]).toEqual([0, 1, 1, 0, 1, 0]);
  });

  it("keeps a failed campus as null, and no trend argument means no trends", () => {
    const out = toDashboardData(admin(), NOW, NO_IMPACT, false, { All: good(), Pune: null, Gurugram: null });
    expect(out.trend?.Pune).toBeNull();
    expect(toDashboardData(admin(), NOW, NO_IMPACT).trend).toEqual({ All: null, Pune: null, Gurugram: null });
  });

  it("istDayFromYmd is the IST midnight of that date", () => {
    expect(istDayFromYmd("2026-11-25")).toBe(Date.parse("2026-11-25T00:00:00+05:30"));
  });
});

describe("trendGroups", () => {
  it("7 days: one bar per IST day, today last", () => {
    const g = trendGroups(dashTrend(), NOW, 7);
    expect(g).toHaveLength(7);
    expect(g[0].t).toBe(istDayFromYmd("2026-11-19"));
    expect(g.at(-1)).toMatchObject({ label: "Today", current: true, title: "Wed, 25 Nov", days: 1 });
    expect(g.filter((x) => x.current)).toHaveLength(1);
    expect(g.reduce((a, x) => a + x.tries, 0)).toBe(7);
  });

  it("30 days: 30 daily bars", () => {
    const g = trendGroups(dashTrend(), NOW, 30);
    expect(g).toHaveLength(30);
    expect(g[0].t).toBe(istDayFromYmd("2026-10-27"));
  });

  it("90 days: IST weeks (Mon–Sun), partial first and last week, 90 days in all", () => {
    const g = trendGroups(dashTrend(), NOW, 90);
    expect(g).toHaveLength(14);
    expect(g[0]).toMatchObject({ t: istDayFromYmd("2026-08-24"), days: 3, title: "Week of 24 Aug" }); // Fri 28 – Sun 30 Aug
    expect(g.at(-1)).toMatchObject({ t: istDayFromYmd("2026-11-23"), days: 3, current: true, label: "This wk" });
    expect(g.reduce((a, x) => a + x.days, 0)).toBe(90);
    expect(g.reduce((a, x) => a + x.tries, 0)).toBe(90); // the database's partial 91st day is left out
  });

  it("adds up the counts and works out didn't-book and not-paid (never below zero)", () => {
    const t = dashTrend({ ...good(), days: days91((i) => (i === 0 ? { tries: 5, booked: 2, chats: 4, paid_after: 1 } : i === 1 ? { tries: 1, booked: 3, chats: 1, paid_after: 2 } : {})) });
    const g = trendGroups(t, NOW, 7);
    expect(g.at(-1)).toMatchObject({ tries: 5, booked: 2, stopped: 3, chats: 4, paidAfter: 1, notPaid: 3 });
    expect(g.at(-2)).toMatchObject({ stopped: 0, notPaid: 0 });
  });

  it("ignores days outside the range (older, or after today)", () => {
    const g = good();
    g.days.push({ d: "2026-11-26", tries: 50, booked: 0, chats: 0, paid_after: 0 });
    g.days[0] = { ...g.days[0], tries: 70 }; // 27 Aug: the partial day, outside the last 90 calendar days
    const t = dashTrend(g);
    expect(trendGroups(t, NOW, 90).reduce((a, x) => a + x.tries, 0)).toBe(90);
    expect(trendGroups(t, NOW, 7).at(-1)!.label).toBe("Today");
  });

  it("nothing when the trends could not be loaded", () => {
    expect(trendGroups(null, NOW, 30)).toEqual([]);
    expect(payBinsFor(null, 30)).toEqual([]);
  });
});

describe("payBinsFor", () => {
  it("labels the six bins of the chosen range", () => {
    expect(payBinsFor(dashTrend(), 7)).toEqual(PAY_BIN_LABELS.map((label, i) => ({ label, v: [0, 1, 1, 0, 0, 0][i] })));
    expect(payBinsFor(dashTrend(), 90).map((b) => b.v)).toEqual([1, 1, 1, 0, 1, 2]);
  });
});

// SAMPLE DATA (remove before production, together with src/lib/peerpath/admin-demo.ts)
describe("sample trends (staging only)", () => {
  it("is never allowed on production", () => {
    expect(allowDemo("production")).toBe(false);
  });

  it("is stable, has the database's shape and makes sense", () => {
    const a = demoTrend(NOW);
    expect(a).toEqual(demoTrend(NOW));
    for (const k of ["All", "Pune", "Gurugram"] as const) {
      const p = parseImpactTrend(a[k]);
      expect(p).not.toBeNull();
      expect(p!.days).toHaveLength(91);
      expect(p!.days.at(-1)!.d).toBe("2026-11-25");
      expect(p!.days.every((x) => x.booked <= x.tries && x.paid_after <= x.chats)).toBe(true);
      expect(p!.pay_bins["7"].slice(3)).toEqual([0, 0, 0]); // nobody waits 7+ days within 7 days
      expect(p!.pay_bins["30"][5]).toBe(0);
    }
    const d = toDashboardData(demoAdminData(NOW), NOW, demoInsights(), true, a);
    expect(trendGroups(d.trend!.Pune, NOW, 90).length).toBe(14);
  });
});
