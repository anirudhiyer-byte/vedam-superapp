import { describe, expect, it } from "vitest";
import {
  chatRef,
  chatStatus,
  dailySeries,
  dashSeniorRows,
  DEFAULT_FILTERS,
  flaggedFeedback,
  heatBand,
  heatGrid,
  impactRange,
  inWindow,
  leadBins,
  leadHours,
  lowRated,
  parseCampusKey,
  parseRange,
  rangeWindow,
  scopeChats,
  toDashboardData,
  weekBuckets,
  type DashChat,
  type DashData,
  type DashFilters,
} from "./admin-dashboard";
import { allowDemo, demoAdminData, demoInsights } from "./admin-demo";
import type { AdminBooking, AdminData, AdminInsights, SeniorPrivate } from "./types";

const NOW = Date.parse("2026-11-25T10:00:00Z"); // Wed 25 Nov, 15:30 IST
const H = 3_600_000;
const D = 24 * H;
const iso = (t: number) => new Date(t).toISOString();

const senior = (id: string, o: Partial<SeniorPrivate> = {}): SeniorPrivate =>
  ({
    id,
    firstName: `S${id}`,
    campus: "Pune",
    year: 2,
    status: "active",
    topics: ["VSAT prep"],
    languages: ["English"],
    meetLink: "https://meet.google.com/x",
    contactEmail: `${id}@vedam.org`,
    lastActiveAt: iso(NOW - D),
    token: `tok-${id}`,
    ...o,
  }) as SeniorPrivate;

const booking = (id: string, startMs: number, o: Partial<AdminBooking> = {}): AdminBooking =>
  ({
    id,
    seniorId: "s1",
    start: iso(startMs),
    end: iso(startMs + H / 2),
    type: "1:1",
    name: "Priya Applicant",
    email: "priya@example.com",
    phone: "+919999999999",
    question: "Is the hostel safe?",
    status: "completed",
    meetUrl: "https://meet.google.com/abc",
    movedFrom: null,
    movedTo: null,
    createdAt: iso(startMs - 30 * H),
    ...o,
  }) as AdminBooking;

const admin = (o: Partial<AdminData> = {}): AdminData => ({ seniors: [senior("s1")], rules: { s1: [{ weekday: 1, from: "18:00", to: "20:00", type: "1:1" }] }, blocks: {}, settings: { s1: { dailyCap: 2, weeklyCap: 2, minNoticeHours: 6, paused: false } }, bookings: [], feedback: {}, ...o });
const NO_IMPACT = { All: null, Pune: null, Gurugram: null };

const chat = (id: string, start: number, o: Partial<DashChat> = {}): DashChat => ({
  id,
  ref: chatRef(id),
  seniorId: "s1",
  start,
  end: start + H / 2,
  created: start - 30 * H,
  type: "1:1",
  status: "completed",
  toMark: false,
  inviteFailed: false,
  auto: null,
  minutes: null,
  rating: null,
  recommend: null,
  promise: false,
  ...o,
});
const dash = (chats: DashChat[], seniors = toDashboardData(admin(), NOW, NO_IMPACT).seniors): DashData => ({ now: NOW, seniors, chats, capped: false, impact: { All: null, Pune: null, Gurugram: null }, demo: false });
const F = (o: Partial<DashFilters> = {}): DashFilters => ({ ...DEFAULT_FILTERS, ...o });

describe("toDashboardData", () => {
  const d = admin({
    bookings: [booking("3fa85f64-5717-4562-b3fc-2c963f66afa6", NOW - 2 * D, { autoResult: "completed", attendance: { people: 2, overlapMin: 27, reason: null } })],
    feedback: { "3fa85f64-5717-4562-b3fc-2c963f66afa6": { rating: 2, recommend: false, promiseMade: true, note: "He said he can get me a seat", createdAt: iso(NOW) } },
  });
  const out = toDashboardData(d, NOW, NO_IMPACT);

  it("leaves out every applicant detail and the feedback note", () => {
    const json = JSON.stringify(out);
    for (const secret of ["Priya", "priya@example.com", "+919999999999", "hostel", "get me a seat", "meet.google.com/abc", "s1@vedam.org"]) expect(json).not.toContain(secret);
  });

  it("keeps only whitelisted chat fields", () => {
    expect(Object.keys(out.chats[0]).sort()).toEqual(["auto", "created", "end", "id", "inviteFailed", "minutes", "promise", "rating", "recommend", "ref", "seniorId", "start", "status", "toMark", "type"].sort());
    expect(out.chats[0]).toMatchObject({ ref: "3FA85F", rating: 2, recommend: false, promise: true, minutes: 27, auto: "completed" });
  });

  it("turns a senior into hours, cap, readiness and a portal path", () => {
    expect(out.seniors[0]).toMatchObject({ id: "s1", hours: 2, weeklyCap: 2, hasMeet: true, portalPath: "/peerpath/talk-to-senior/senior/tok-s1" });
    expect(Object.keys(out.seniors[0])).not.toContain("contactEmail");
  });

  it("marks to-mark and failed invites only on confirmed chats", () => {
    const x = toDashboardData(
      admin({
        bookings: [
          booking("a", NOW - D, { status: "confirmed", autoResult: "needs_marking" }),
          booking("b", NOW + D, { status: "confirmed", meetSync: "failed" }),
          booking("c", NOW - D, { status: "cancelled", autoResult: "needs_marking", meetSync: "failed" }),
        ],
      }),
      NOW,
      NO_IMPACT,
    );
    expect(x.chats.map((c) => [c.id, c.toMark, c.inviteFailed])).toEqual([
      ["a", true, false],
      ["b", false, true],
      ["c", false, false],
    ]);
  });

  it("skips chats with a broken date and reports the 2000 cap", () => {
    const many = Array.from({ length: 2000 }, (_, i) => booking(`b${i}`, NOW - i * H));
    many[0] = { ...many[0], start: "not a date" };
    const x = toDashboardData(admin({ bookings: many }), NOW, NO_IMPACT);
    expect(x.chats).toHaveLength(1999);
    expect(x.capped).toBe(true);
  });
});

describe("filters", () => {
  const seniors = toDashboardData(admin({ seniors: [senior("s1"), senior("s2", { campus: "Gurugram" })] }), NOW, NO_IMPACT).seniors;
  const data = dash([chat("a", NOW - D), chat("b", NOW - D, { seniorId: "s2" }), chat("c", NOW - D, { type: "Group" }), chat("d", NOW - D, { seniorId: "gone" })], seniors);

  it("campus, senior and type filters combine; chats of unknown seniors are left out", () => {
    expect(scopeChats(data, F()).map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(scopeChats(data, F({ campus: "Gurugram" })).map((c) => c.id)).toEqual(["b"]);
    expect(scopeChats(data, F({ seniors: ["s1"], type: "Group" })).map((c) => c.id)).toEqual(["c"]);
  });

  it("windows are [from, to) and the previous window ends where the current one starts", () => {
    const cur = rangeWindow(NOW, 7);
    const prev = rangeWindow(NOW, 7, 1);
    expect(cur).toEqual([NOW - 7 * D, NOW]);
    expect(prev[1]).toBe(cur[0]);
    expect(inWindow(NOW, cur)).toBe(false);
    expect(inWindow(NOW - 7 * D, cur)).toBe(true);
  });

  it("parses the address bar safely", () => {
    expect([parseRange("7"), parseRange("90"), parseRange("31"), parseRange(undefined)]).toEqual([7, 90, 30, 30]);
    expect([parseCampusKey("Pune"), parseCampusKey("pune"), parseCampusKey(["Pune"])]).toEqual(["Pune", "All", "All"]);
  });
});

describe("series", () => {
  it("dailySeries has one point per IST day and counts chats on their IST date", () => {
    const istMidnight = Date.parse("2026-11-24T18:30:00Z"); // 25 Nov 00:00 IST
    const s = dailySeries([chat("a", istMidnight + 60_000), chat("b", istMidnight - 60_000)], [istMidnight - D, NOW]);
    expect(s.map((p) => [p.label, p.v])).toEqual([
      ["24 Nov", 1],
      ["25 Nov", 1],
    ]);
  });

  it("weekBuckets: last n Monday–Sunday weeks, current one last", () => {
    const w = weekBuckets([chat("a", NOW - H), chat("b", NOW + D, { status: "confirmed" }), chat("c", NOW - 8 * D, { status: "no_show_applicant" })], NOW, 3);
    expect(w).toHaveLength(3);
    expect(w[2]).toMatchObject({ current: true, label: "This wk", done: 1, upcoming: 1 });
    expect(w[1]).toMatchObject({ noShow: 1, label: "16 Nov" });
  });

  it("heat bands and grid use IST", () => {
    expect([9, 10, 13, 19, 21, 23].map(heatBand)).toEqual([0, 1, 2, 5, 6, 7]);
    const g = heatGrid([chat("a", Date.parse("2026-11-23T14:00:00Z"))]); // Mon 19:30 IST
    expect(g[0][5]).toBe(1);
    expect(g.flat().reduce((a, v) => a + v, 0)).toBe(1);
  });

  it("lead time bins leave out negative leads", () => {
    const h = leadHours([chat("a", NOW, { created: NOW - 5 * H }), chat("b", NOW, { created: NOW - 50 * H }), chat("c", NOW, { created: NOW + H })]);
    expect(h).toEqual([5, 50]);
    expect(leadBins(h).map((b) => b.v)).toEqual([1, 0, 0, 1, 0, 0]);
  });
});

describe("dashSeniorRows", () => {
  it("counts this week's chats once per start time and flags cap, idle, not seen and not ready", () => {
    const thisMon = Date.parse("2026-11-23T13:30:00Z"); // Mon 19:00 IST
    const seniors = toDashboardData(
      admin({
        seniors: [senior("s1"), senior("s2", { meetLink: null, lastActiveAt: iso(NOW - 20 * D) }), senior("s3", { status: "pending", lastActiveAt: null })],
        settings: { s1: { dailyCap: 2, weeklyCap: 1, minNoticeHours: 6, paused: false } },
      }),
      NOW,
      NO_IMPACT,
    ).seniors;
    const data = dash([chat("a", thisMon), chat("b", thisMon, { type: "Group" }), chat("c", NOW - 60 * D, { seniorId: "s2", status: "cancelled" })], seniors);
    const rows = dashSeniorRows(data, F());
    const [r1, r2, r3] = rows;
    expect(r1).toMatchObject({ thisWeek: 1, atCap: true, idle: false, notSeen: false, ready: true, chats: 2 });
    expect(r2).toMatchObject({ idle: true, notSeen: true, ready: false, chats: 0 });
    // flags are only for live seniors
    expect(r3).toMatchObject({ idle: false, notSeen: false, atCap: false, seenDays: null });
    expect(r1.weekly).toHaveLength(8);
    expect(r1.weekly[7]).toBe(2);
  });
});

describe("quality helpers", () => {
  it("flags a promise or 2★ or less", () => {
    expect([chat("a", NOW, { rating: 2 }), chat("b", NOW, { rating: 3 }), chat("c", NOW, { rating: 5, promise: true }), chat("d", NOW)].map(flaggedFeedback)).toEqual([true, false, true, false]);
  });

  it("low-rated: at least 2 reviews and 3.5 or less, worst first", () => {
    const seniors = toDashboardData(admin({ seniors: [senior("s1"), senior("s2"), senior("s3")] }), NOW, NO_IMPACT).seniors;
    const list = [
      chat("a", NOW, { rating: 3 }),
      chat("b", NOW, { rating: 4 }),
      chat("c", NOW, { seniorId: "s2", rating: 2 }),
      chat("d", NOW, { seniorId: "s2", rating: 3 }),
      chat("e", NOW, { seniorId: "s3", rating: 1 }),
    ];
    expect(lowRated(list, seniors).map((x) => [x.s.id, x.avg, x.n])).toEqual([
      ["s2", 2.5, 2],
      ["s1", 3.5, 2],
    ]);
  });

  it("chat status labels", () => {
    expect(chatStatus(chat("a", NOW - D, { status: "confirmed", toMark: true }), NOW).label).toBe("To mark");
    expect(chatStatus(chat("a", NOW - D, { status: "confirmed" }), NOW).label).toBe("Done");
    expect(chatStatus(chat("a", NOW + D, { status: "confirmed" }), NOW).label).toBe("Booked");
    expect(chatStatus(chat("a", NOW + D, { status: "confirmed", inviteFailed: true }), NOW).label).toBe("Invite failed");
    expect(chatStatus(chat("a", NOW, { status: "rescheduled" }), NOW).label).toBe("Moved");
    expect(chatStatus(chat("a", NOW, { status: "no_show_applicant" }), NOW).label).toBe("No-show");
  });
});

describe("impact", () => {
  it("picks the range for the chosen campus", () => {
    const ins = demoInsights().Pune as AdminInsights;
    expect(impactRange({ mode: ins.mode, ranges: ins.ranges }, 90)).toBe(ins.ranges["90"]);
    expect(impactRange(null, 30)).toBeNull();
  });
});

describe("sample data (staging only)", () => {
  it("is never allowed on production", () => {
    expect(allowDemo("production")).toBe(false);
    expect(allowDemo("preview")).toBe(true);
    expect(allowDemo(undefined)).toBe(true);
  });

  it("is made up, stable and valid for the dashboard", () => {
    const a = demoAdminData(NOW);
    const b = demoAdminData(NOW);
    expect(a).toEqual(b);
    expect(a.seniors).toHaveLength(9);
    expect(a.bookings.length).toBeGreaterThan(100);
    expect(a.bookings.every((x) => x.email === "sample@example.com")).toBe(true);
    expect(a.seniors.every((s) => s.contactEmail.endsWith("@example.com"))).toBe(true);
    const d = toDashboardData(a, NOW, demoInsights(), true);
    expect(d.demo).toBe(true);
    expect(d.chats).toHaveLength(a.bookings.length);
    expect(Object.values(a.feedback).every((f) => f.rating >= 1 && f.rating <= 5)).toBe(true);
  });
});
