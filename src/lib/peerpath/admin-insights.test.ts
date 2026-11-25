import { describe, expect, it } from "vitest";
import { inviteFailed, isDone, isLive, isUpcoming, needsActionCounts, needsMarking, notReady } from "./admin-insights";
import {
  bandOf,
  BLOCK_LABELS,
  blockedReasons,
  notBookedPeople,
  parseAdminInsights,
  parseDays,
  BOOKING_LIMIT,
  coverage,
  hoursOffered,
  isCapped,
  istHourOf,
  istWeekday,
  istWeekStart,
  median,
  parseTab,
  qualityStats,
  seniorRows,
  seniorTotals,
  sessionFunnel,
  sessionReality,
  weeklyCounts,
  whenGrid,
} from "./admin-insights";
import { BOOK_CODES } from "./booking-codes";
import type { AdminBooking, AdminData, AvailabilityRule, Feedback, SeniorPrivate } from "./types";

const NOW = Date.parse("2026-11-25T10:00:00Z");
const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

const senior = (id: string, status: string, meetLink: string | null = "https://meet.google.com/x") => ({ id, status, meetLink, campus: "Pune" }) as unknown as SeniorPrivate;
const booking = (id: string, o: Partial<AdminBooking> & { startMs?: number; endMs?: number } = {}) => {
  const { startMs = NOW + 2 * H, endMs, ...rest } = o;
  return { id, seniorId: "s1", status: "confirmed", start: iso(startMs), end: iso(endMs ?? startMs + H / 2), ...rest } as unknown as AdminBooking;
};
const data = (seniors: SeniorPrivate[], bookings: AdminBooking[], rules: AdminData["rules"] = {}): AdminData =>
  ({ seniors, bookings, rules, blocks: {}, settings: {}, feedback: {} }) as AdminData;

describe("isDone / isUpcoming / isLive (moved from page.tsx, same rules)", () => {
  it("completed is done; confirmed is done only after it ended", () => {
    expect(isDone(booking("a", { status: "completed" }), NOW)).toBe(true);
    expect(isDone(booking("a", { startMs: NOW - 2 * H, endMs: NOW - H }), NOW)).toBe(true);
    expect(isDone(booking("a", { startMs: NOW - H, endMs: NOW + H }), NOW)).toBe(false);
    expect(isDone(booking("a", { status: "cancelled", startMs: NOW - 2 * H, endMs: NOW - H }), NOW)).toBe(false);
  });
  it("upcoming is confirmed and strictly in the future", () => {
    expect(isUpcoming(booking("a"), NOW)).toBe(true);
    expect(isUpcoming(booking("a", { startMs: NOW }), NOW)).toBe(false);
    expect(isUpcoming(booking("a", { status: "cancelled" }), NOW)).toBe(false);
  });
  it("live means active", () => {
    expect(isLive(senior("x", "active"))).toBe(true);
    expect(isLive(senior("x", "pending"))).toBe(false);
    expect(isLive(senior("x", "paused"))).toBe(false);
  });
});

describe("needsMarking / inviteFailed", () => {
  it("need a confirmed booking", () => {
    expect(needsMarking(booking("a", { autoResult: "needs_marking" }))).toBe(true);
    expect(needsMarking(booking("a", { autoResult: "needs_marking", status: "completed" }))).toBe(false);
    expect(needsMarking(booking("a", { autoResult: "completed" }))).toBe(false);
    expect(needsMarking(booking("a"))).toBe(false);
    expect(inviteFailed(booking("a", { meetSync: "failed" }))).toBe(true);
    expect(inviteFailed(booking("a", { meetSync: "failed", status: "cancelled" }))).toBe(false);
    expect(inviteFailed(booking("a", { meetSync: "ok" }))).toBe(false);
  });
});

describe("notReady", () => {
  const rules = { s1: [{}], s2: [] } as unknown as AdminData["rules"];
  const d = data([], [], rules);
  it("live senior with times and a link is ready", () => expect(notReady(senior("s1", "active"), d)).toBe(false));
  it("live senior with no times is not ready", () => expect(notReady(senior("s2", "active"), d)).toBe(true));
  it("live senior with no rules entry at all is not ready", () => expect(notReady(senior("s3", "active"), d)).toBe(true));
  it("live senior with no Meet link is not ready", () => expect(notReady(senior("s1", "active", null), d)).toBe(true));
  it("pending and paused seniors are never counted", () => {
    expect(notReady(senior("s2", "pending"), d)).toBe(false);
    expect(notReady(senior("s2", "paused", null), d)).toBe(false);
  });
});

describe("needsActionCounts", () => {
  it("is all zeros for empty data", () => {
    expect(needsActionCounts(data([], []), NOW)).toEqual({ waitingApproval: 0, notReady: 0, toMark: 0, inviteFailed: 0, next24h: 0 });
  });

  it("counts each thing", () => {
    const rules = { a: [{}], b: [] } as unknown as AdminData["rules"];
    const d = data(
      [senior("a", "active"), senior("b", "active"), senior("c", "active", null), senior("p1", "pending"), senior("p2", "pending"), senior("z", "paused")],
      [
        booking("m1", { autoResult: "needs_marking", startMs: NOW - 3 * H, endMs: NOW - 2 * H }),
        booking("m2", { autoResult: "needs_marking", status: "completed", startMs: NOW - 3 * H, endMs: NOW - 2 * H }),
        booking("i1", { meetSync: "failed", startMs: NOW + 48 * H }),
        booking("i2", { meetSync: "failed", status: "cancelled" }),
        booking("u1", { startMs: NOW + 1 * H }),
        booking("u2", { startMs: NOW + 30 * H }),
      ],
      rules,
    );
    expect(needsActionCounts(d, NOW)).toEqual({ waitingApproval: 2, notReady: 2, toMark: 1, inviteFailed: 1, next24h: 1 + 0 });
  });

  it("next24h: starting exactly now is not counted, exactly 24h away is, 24h + 1ms is not", () => {
    const d = data([], [booking("now", { startMs: NOW }), booking("edge", { startMs: NOW + 24 * H }), booking("late", { startMs: NOW + 24 * H + 1 })]);
    expect(needsActionCounts(d, NOW).next24h).toBe(1);
  });

  it("next24h ignores cancelled, completed and moved chats", () => {
    const d = data([], [booking("a", { status: "cancelled" }), booking("b", { status: "completed" }), booking("c", { status: "rescheduled" }), booking("d")]);
    expect(needsActionCounts(d, NOW).next24h).toBe(1);
  });

  it("does not change the input", () => {
    const d = data([senior("a", "pending")], [booking("a", { meetSync: "failed" })]);
    const before = JSON.stringify(d);
    needsActionCounts(d, NOW);
    expect(JSON.stringify(d)).toBe(before);
  });
});

/* ---------- 2A-2 / 2A-3 ---------- */

const D = 24 * H;
// NOW = Wed 25 Nov 2026, 15:30 IST. This IST week starts Mon 23 Nov 00:00 IST = 22 Nov 18:30 UTC.
const WEEK0 = Date.parse("2026-11-22T18:30:00Z");
const fb = (rating: number, recommend = true, promiseMade = false) => ({ rating, recommend, promiseMade, note: null, createdAt: iso(NOW) }) as unknown as Feedback;
const rule = (from: string, to: string) => ({ weekday: 6, from, to, type: "1:1" }) as AvailabilityRule;
const live = (id: string, o: Partial<SeniorPrivate> = {}) =>
  ({ id, firstName: id.toUpperCase(), campus: "Pune", status: "active", meetLink: "x", lastActiveAt: iso(NOW - D), topics: [], languages: [], ...o }) as unknown as SeniorPrivate;
const full = (o: Partial<AdminData>): AdminData => ({ seniors: [], bookings: [], rules: {}, blocks: {}, settings: {}, feedback: {}, ...o }) as AdminData;

describe("parseTab", () => {
  // 2B adds the Impact tab (spec change: "impact" used to fall back to overview)
  it("accepts the five tabs exactly", () => {
    for (const t of ["overview", "sessions", "seniors", "quality", "impact"]) expect(parseTab(t)).toBe(t);
  });
  it("anything else is overview", () => {
    for (const v of ["Sessions", "Impact", "impact ", " seniors", "", "<script>", undefined, null, 3, ["quality"], ["impact"], {}]) expect(parseTab(v)).toBe("overview");
  });
});

describe("median", () => {
  it("odd, even, empty", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
  it("does not sort the input", () => {
    const a = [3, 1, 2];
    median(a);
    expect(a).toEqual([3, 1, 2]);
  });
});

describe("IST helpers", () => {
  it("week starts Monday 00:00 IST", () => {
    expect(istWeekStart(NOW)).toBe(WEEK0);
    expect(istWeekStart(WEEK0)).toBe(WEEK0);
    expect(istWeekStart(WEEK0 - 1)).toBe(WEEK0 - 7 * D);
  });
  it("weekday and hour are IST", () => {
    expect(istWeekday(WEEK0)).toBe(0); // Monday
    expect(istWeekday(WEEK0 - 1)).toBe(6); // Sunday 23:59 IST
    expect(istHourOf(Date.parse("2026-11-25T06:30:00Z"))).toBe(12);
  });
  it("band edges at 12:00, 17:00, 21:00", () => {
    expect([11, 12, 16, 17, 20, 21, 23, 0].map(bandOf)).toEqual([0, 1, 1, 2, 2, 3, 3, 0]);
  });
});

describe("sessionFunnel", () => {
  it("moved chat counts once, cancelled is not done, feedback only on done", () => {
    const d = full({
      bookings: [
        booking("old", { status: "rescheduled", startMs: NOW - 5 * D }),
        booking("new", { status: "completed", startMs: NOW - 4 * D }),
        booking("can", { status: "cancelled", startMs: NOW - 3 * D, endMs: NOW - 3 * D + H }),
        booking("ns", { status: "no_show_applicant", startMs: NOW - 2 * D }),
        booking("up", { startMs: NOW + D }),
      ],
      feedback: { new: fb(5), up: fb(4) },
    });
    expect(sessionFunnel(d, NOW)).toEqual({ booked: 4, done: 1, feedback: 1, cancelled: 1, noShow: 1, moved: 1, upcoming: 1 });
  });
  it("empty data is all zeros", () => {
    expect(sessionFunnel(full({}), NOW)).toEqual({ booked: 0, done: 0, feedback: 0, cancelled: 0, noShow: 0, moved: 0, upcoming: 0 });
  });
});

describe("weeklyCounts", () => {
  it("8 Monday buckets ending with this week, empty weeks 0", () => {
    const w = weeklyCounts(full({}), NOW);
    expect(w).toHaveLength(8);
    expect(w[7].start).toBe(WEEK0);
    expect(w[0].start).toBe(WEEK0 - 7 * 7 * D);
    expect(w[7].label).toBe("23 Nov");
    expect(w.every((x) => x.count === 0)).toBe(true);
  });
  it("Sunday 23:30 IST goes to last week, Monday 00:30 IST to this week", () => {
    const d = full({ bookings: [booking("sun", { startMs: WEEK0 - H / 2 }), booking("mon", { startMs: WEEK0 + H / 2 })] });
    const w = weeklyCounts(d, NOW);
    expect(w[6].count).toBe(1);
    expect(w[7].count).toBe(1);
  });
  it("leaves out cancelled, moved, too old and next-week chats", () => {
    const d = full({
      bookings: [
        booking("c", { status: "cancelled", startMs: WEEK0 + H }),
        booking("m", { status: "rescheduled", startMs: WEEK0 + H }),
        booking("old", { status: "completed", startMs: WEEK0 - 8 * 7 * D }),
        booking("next", { startMs: WEEK0 + 7 * D + H }),
        booking("ok", { status: "no_show_applicant", startMs: WEEK0 + H }),
      ],
    });
    expect(weeklyCounts(d, NOW).reduce((a, x) => a + x.count, 0)).toBe(1);
  });
});

describe("sessionReality", () => {
  it("auto-completed % and median minutes from done chats with attendance", () => {
    const att = (m: number) => ({ people: 2, overlapMin: m, reason: null });
    const d = full({
      bookings: [
        booking("a", { status: "completed", autoResult: "completed", attendance: att(30), startMs: NOW - 3 * D }),
        booking("b", { status: "completed", autoResult: null, attendance: att(10), startMs: NOW - 3 * D }),
        booking("c", { autoResult: "needs_marking", attendance: att(20), startMs: NOW - 2 * D }),
        booking("d", { status: "completed", startMs: NOW - 2 * D }),
        booking("e", { meetSync: "failed" }),
      ] as AdminBooking[],
    });
    expect(sessionReality(d, NOW)).toEqual({ checked: 3, autoCompleted: 1, autoPct: 33, medianMinutes: 20, toMark: 1, inviteFailed: 1 });
  });
  it("no attendance data gives nulls", () => {
    const r = sessionReality(full({}), NOW);
    expect(r.autoPct).toBeNull();
    expect(r.medianMinutes).toBeNull();
  });
});

describe("whenGrid", () => {
  it("IST weekday × band, leaves out cancelled and moved, median lead hours", () => {
    const monNoon = WEEK0 + 12 * H; // Mon 12:00 IST
    const d = full({
      bookings: [
        { ...booking("a", { startMs: monNoon }), createdAt: iso(monNoon - 10 * H) },
        { ...booking("b", { startMs: WEEK0 + 21 * H }), createdAt: iso(WEEK0 + 21 * H - 30 * H) },
        { ...booking("c", { status: "cancelled", startMs: monNoon }), createdAt: iso(monNoon - H) },
      ] as AdminBooking[],
    });
    const w = whenGrid(d);
    expect(w.total).toBe(2);
    expect(w.grid[0][1]).toBe(1);
    expect(w.grid[0][3]).toBe(1);
    expect(w.medianLeadHours).toBe(20);
  });
  it("empty data", () => {
    const w = whenGrid(full({}));
    expect(w.total).toBe(0);
    expect(w.medianLeadHours).toBeNull();
    expect(w.grid.flat().every((n) => n === 0)).toBe(true);
  });
});

describe("hoursOffered", () => {
  it("sums to − from; QATest rules Sat 10–13 + Sat 15–16 = 4h", () => {
    expect(hoursOffered([rule("10:00", "13:00"), rule("15:00", "16:00")])).toBe(4);
  });
  it("half hours, reversed or bad rules count 0, missing is 0", () => {
    expect(hoursOffered([rule("09:30", "10:00"), rule("12:00", "11:00"), rule("x", "10:00")])).toBe(0.5);
    expect(hoursOffered(undefined)).toBe(0);
  });
});

describe("seniorRows / seniorTotals", () => {
  const settings = (weeklyCap: number) => ({ dailyCap: 2, weeklyCap, minNoticeHours: 12, paused: false });
  it("only live seniors, with numbers and badges", () => {
    const d = full({
      seniors: [live("a"), live("idle", { lastActiveAt: null }), live("p", { status: "pending" } as Partial<SeniorPrivate>)],
      rules: { a: [rule("10:00", "13:00")], idle: [] },
      settings: { a: settings(2), idle: settings(5) },
      bookings: [
        { ...booking("a1", { status: "completed", startMs: WEEK0 + H }), seniorId: "a" },
        { ...booking("a2", { startMs: NOW + H }), seniorId: "a" },
        { ...booking("a3", { status: "no_show_applicant", startMs: NOW - 10 * D }), seniorId: "a" },
        { ...booking("a4", { status: "cancelled", startMs: NOW - 2 * D }), seniorId: "a" },
        { ...booking("i1", { status: "completed", startMs: NOW - 40 * D }), seniorId: "idle" },
      ] as AdminBooking[],
      feedback: { a1: fb(5, true), a3: fb(3, false) },
    });
    const rows = seniorRows(d, NOW);
    expect(rows.map((r) => r.id)).toEqual(["a", "idle"]);
    const [a, idle] = rows;
    expect(a).toMatchObject({ hours: 3, chats30: 2, done: 1, noShows: 1, rating: 4, reviews: 2, recommendPct: 50, thisWeek: 2, weeklyCap: 2, idle: false, notSeen: false, atCap: true });
    expect(idle).toMatchObject({ chats30: 0, idle: true, notSeen: true, atCap: false, rating: null, recommendPct: null });
  });
  it("weekly cap counts one chat per start time, like the database", () => {
    const d = full({
      seniors: [live("g")],
      settings: { g: settings(2) },
      bookings: [
        { ...booking("g1", { startMs: NOW + H }), seniorId: "g" },
        { ...booking("g2", { startMs: NOW + H }), seniorId: "g" },
        { ...booking("g3", { status: "no_show_applicant", startMs: NOW - H }), seniorId: "g" },
      ] as AdminBooking[],
    });
    expect(seniorRows(d, NOW)[0]).toMatchObject({ thisWeek: 1, atCap: false });
  });
  it("not seen = last active older than 14 days", () => {
    const d = full({ seniors: [live("x", { lastActiveAt: iso(NOW - 15 * D) }), live("y", { lastActiveAt: iso(NOW - 13 * D) })] });
    expect(seniorRows(d, NOW).map((r) => r.notSeen)).toEqual([true, false]);
  });
  it("no cap set means never at cap", () => {
    expect(seniorRows(full({ seniors: [live("z")] }), NOW)[0]).toMatchObject({ weeklyCap: null, atCap: false });
  });
  it("totals: live seniors, hours, chats per week over 4 weeks", () => {
    const d = full({
      seniors: [live("a"), live("b"), live("p", { status: "paused" } as Partial<SeniorPrivate>)],
      rules: { a: [rule("10:00", "13:00")], b: [rule("15:00", "16:30")], p: [rule("10:00", "20:00")] },
      bookings: [booking("1", { startMs: NOW - D }), booking("2", { startMs: NOW - 20 * D }), booking("3", { startMs: NOW - 40 * D }), booking("4", { status: "cancelled", startMs: NOW - D })],
    });
    expect(seniorTotals(d, NOW)).toEqual({ live: 2, hours: 4.5, avgChatsPerWeek: 0.5 });
  });
});

describe("coverage", () => {
  it("live seniors per topic and language; thin under 2", () => {
    const d = full({
      seniors: [
        live("a", { topics: ["VSAT prep", "Hackathons"], languages: ["English", "Hindi"] } as Partial<SeniorPrivate>),
        live("b", { topics: ["VSAT prep"], languages: ["English"] } as Partial<SeniorPrivate>),
        live("p", { status: "pending", topics: ["Hackathons"], languages: ["Hindi"] } as Partial<SeniorPrivate>),
      ],
    });
    const c = coverage(d);
    expect(c.topics.find((t) => t.name === "VSAT prep")).toEqual({ name: "VSAT prep", seniors: 2, thin: false });
    expect(c.topics.find((t) => t.name === "Hackathons")).toEqual({ name: "Hackathons", seniors: 1, thin: true });
    expect(c.languages.find((t) => t.name === "Hindi")).toEqual({ name: "Hindi", seniors: 1, thin: true });
    expect(c.topics.find((t) => t.name === "Placements")?.seniors).toBe(0);
    expect(c.topics).toHaveLength(10);
  });
});

describe("qualityStats", () => {
  it("empty data gives nulls and zeros", () => {
    expect(qualityStats(full({}), NOW)).toEqual({ reviews: 0, done: 0, feedbackRate: null, avgRating: null, recommendPct: null, dist: [0, 0, 0, 0, 0], promises: 0, lowRated: [] });
  });
  it("rate, average, recommend %, distribution, promises, low-rated worst first", () => {
    const b = (id: string, seniorId: string) => ({ ...booking(id, { status: "completed", startMs: NOW - 2 * D }), seniorId });
    const d = full({
      seniors: [live("good"), live("bad"), live("worse"), live("one")],
      bookings: [b("1", "good"), b("2", "good"), b("3", "bad"), b("4", "bad"), b("5", "worse"), b("6", "worse"), b("7", "worse"), b("8", "one"), b("9", "good")] as AdminBooking[],
      feedback: { "1": fb(5), "2": fb(4), "3": fb(3, false), "4": fb(3, false, true), "5": fb(1, false), "6": fb(2, false), "7": fb(5), "8": fb(1, false) },
    });
    const q = qualityStats(d, NOW);
    expect(q.reviews).toBe(8);
    expect(q.done).toBe(9);
    expect(q.feedbackRate).toBe(89);
    expect(q.avgRating).toBe(3);
    expect(q.recommendPct).toBe(38);
    expect(q.dist).toEqual([2, 1, 2, 1, 2]);
    expect(q.promises).toBe(1);
    expect(q.lowRated).toEqual([
      { id: "worse", firstName: "WORSE", rating: 2.7, reviews: 3 },
      { id: "bad", firstName: "BAD", rating: 3, reviews: 2 },
    ]);
  });
});

describe("isCapped", () => {
  it("true at the 2,000 booking limit", () => {
    expect(BOOKING_LIMIT).toBe(2000);
    expect(isCapped(full({ bookings: Array.from({ length: 1999 }, (_, i) => booking(String(i))) }))).toBe(false);
    expect(isCapped(full({ bookings: Array.from({ length: 2000 }, (_, i) => booking(String(i))) }))).toBe(true);
  });
});

describe("new helpers do not change the input", () => {
  it("all of them", () => {
    const d = full({
      seniors: [live("a", { topics: ["VSAT prep"], languages: ["Hindi"] } as Partial<SeniorPrivate>)],
      rules: { a: [rule("10:00", "12:00")] },
      bookings: [{ ...booking("x", { status: "completed", startMs: NOW - D }), seniorId: "a" }, booking("y")] as AdminBooking[],
      feedback: { x: fb(2) },
    });
    const before = JSON.stringify(d);
    sessionFunnel(d, NOW);
    weeklyCounts(d, NOW);
    sessionReality(d, NOW);
    whenGrid(d);
    seniorRows(d, NOW);
    seniorTotals(d, NOW);
    coverage(d);
    qualityStats(d, NOW);
    expect(JSON.stringify(d)).toBe(before);
  });
});

/* ---------- 2B: Impact ---------- */

describe("parseDays", () => {
  it("7, 30, 90 exactly", () => {
    for (const d of ["7", "30", "90"]) expect(parseDays(d)).toBe(d);
  });
  it("anything else is 30", () => {
    for (const v of ["5", "07", "30 ", "365", "", "-7", "<script>", undefined, null, 30, ["7"], {}]) expect(parseDays(v)).toBe("30");
  });
});

describe("BLOCK_LABELS", () => {
  it("every booking code except OK has a plain label", () => {
    for (const c of BOOK_CODES) {
      if (c === "OK") continue;
      expect(BLOCK_LABELS[c], c).toMatch(/^[A-Z][a-z A-Z]+$/);
    }
    expect(Object.keys(BLOCK_LABELS)).toHaveLength(BOOK_CODES.length - 1);
  });
  it("uses the agreed words", () => {
    expect(BLOCK_LABELS.NOT_LOGGED_IN).toBe("Not signed in");
    expect(BLOCK_LABELS.NOT_REGISTERED).toBe("Not registered for VSAT");
    expect(BLOCK_LABELS.PAYMENT_PENDING).toBe("Payment pending");
    expect(BLOCK_LABELS.SLOT_UNAVAILABLE).toBe("Slot taken");
    expect(BLOCK_LABELS.SERVER).toBe("System error");
  });
});

describe("blockedReasons", () => {
  it("empty is empty", () => expect(blockedReasons({})).toEqual([]));
  it("merges codes with the same label, unknown codes go to Other, most people first, Other last", () => {
    const r = blockedReasons({
      EMAIL_MISSING: { attempts: 3, people: 2 },
      EMAIL_NOT_VERIFIED: { attempts: 1, people: 1 },
      SLOT_UNAVAILABLE: { attempts: 9, people: 5 },
      INVALID: { attempts: 40, people: 30 },
      SOMETHING_NEW: { attempts: 2, people: 2 },
      SERVER: { attempts: 1, people: 1 },
      OK: { attempts: 99, people: 99 },
    });
    expect(r).toEqual([
      { label: "Slot taken", people: 5, attempts: 9 },
      { label: "No email", people: 3, attempts: 4 },
      { label: "System error", people: 1, attempts: 1 },
      { label: "Other", people: 32, attempts: 42 },
    ]);
  });
  it("does not change the input", () => {
    const b = { SERVER: { attempts: 1, people: 1 } };
    const before = JSON.stringify(b);
    blockedReasons(b);
    expect(JSON.stringify(b)).toBe(before);
  });
});

describe("parseAdminInsights", () => {
  const range = (o: Record<string, unknown> = {}) => ({
    demand: { attempts: 9, people: 6, booked: 2, people_booked: 1, blocked: { SLOT_UNAVAILABLE: { attempts: 3, people: 1 } } },
    outcome: { applicants: 5, paid_before: 1, paid_after: 3, not_paid: 1, enrolled: 2, enrolled_after: 1, median_days_to_pay: 3.0, median_days_to_enroll: null },
    ...o,
  });
  const good = () => ({ mode: "registered", ranges: { "7": range(), "30": range(), "90": range() } });

  it("reads a good answer", () => {
    const r = parseAdminInsights(good());
    expect(r?.mode).toBe("registered");
    expect(r?.ranges["30"].demand.blocked).toEqual({ SLOT_UNAVAILABLE: { attempts: 3, people: 1 } });
    expect(r?.ranges["30"].outcome.median_days_to_pay).toBe(3);
    expect(r?.ranges["30"].outcome.median_days_to_enroll).toBeNull();
  });
  it("accepts numbers sent as strings (Postgres numeric)", () => {
    const g = good();
    (g.ranges["7"].outcome as Record<string, unknown>).median_days_to_pay = "2.5";
    (g.ranges["7"].demand as Record<string, unknown>).attempts = "12";
    const r = parseAdminInsights(g);
    expect(r?.ranges["7"].outcome.median_days_to_pay).toBe(2.5);
    expect(r?.ranges["7"].demand.attempts).toBe(12);
  });
  it("drops blocked codes that are not plain codes", () => {
    const g = good();
    g.ranges["90"].demand.blocked = { "<img src=x>": { attempts: 1, people: 1 }, OK_BUT_lower: { attempts: 1, people: 1 }, BAD: { attempts: -1, people: 1 } } as never;
    expect(parseAdminInsights(g)?.ranges["90"].demand.blocked).toEqual({});
  });
  it("null for wrong shapes", () => {
    const noRange = good() as Record<string, unknown>;
    delete (noRange.ranges as Record<string, unknown>)["90"];
    const negative = good();
    (negative.ranges["30"].outcome as Record<string, unknown>).applicants = -1;
    const nan = good();
    (nan.ranges["30"].demand as Record<string, unknown>).people = "lots";
    const noMode = good() as Record<string, unknown>;
    delete noMode.mode;
    for (const v of [null, undefined, "x", 5, [], {}, { mode: "paid" }, { mode: "paid", ranges: [] }, noRange, negative, nan, noMode]) {
      expect(parseAdminInsights(v)).toBeNull();
    }
  });
});

describe("notBookedPeople", () => {
  it("one person stopped for two reasons is one person (staging: 1 tried, 0 booked, Slot taken + Other)", () => {
    const blocked = { SLOT_UNAVAILABLE: { attempts: 2, people: 1 }, INVALID: { attempts: 1, people: 1 } };
    expect(blockedReasons(blocked).reduce((a, x) => a + x.people, 0)).toBe(2); // summing the bars double-counts
    expect(notBookedPeople({ people: 1, people_booked: 0 })).toBe(1);
  });
  it("people who were blocked first and booked later are not counted", () => {
    expect(notBookedPeople({ people: 10, people_booked: 7 })).toBe(3);
  });
  it("zero and never negative", () => {
    expect(notBookedPeople({ people: 0, people_booked: 0 })).toBe(0);
    expect(notBookedPeople({ people: 2, people_booked: 5 })).toBe(0);
  });
});
