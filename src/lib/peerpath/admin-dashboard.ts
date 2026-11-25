/**
 * Data for the interactive admin dashboard (client side).
 *
 * The server turns pp_admin_all into DashData before it reaches the browser: no applicant names, emails,
 * phones, questions or feedback notes. A chat is shown by a short reference (#A3F9C2) and links to its own
 * page (ttsPath.booked), which loads the details for admins only. Every filter then runs in the browser.
 */
import type { Campus, SessionType, Year } from "./constants";
import { ttsPath } from "./constants";
import { hoursOffered, isCapped, istWeekStart, median } from "./admin-insights";
import type { AdminData, AdminImpactTrend, AdminInsights, BookingStatus, ImpactRange, SeniorStatus } from "./types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const IST_MS = 330 * 60_000;

export type DashSenior = {
  id: string;
  firstName: string;
  campus: Campus;
  year: Year;
  status: SeniorStatus;
  topics: string[];
  languages: string[];
  /** hours offered per week (weekly times) */
  hours: number;
  weeklyCap: number | null;
  lastActiveAt: number | null;
  hasMeet: boolean;
  /** the senior's private portal link (admins already see it today); null when there is no token */
  portalPath: string | null;
};

export type DashChat = {
  id: string;
  /** short, non-personal reference, e.g. "A3F9C2" */
  ref: string;
  seniorId: string;
  start: number;
  end: number;
  created: number;
  type: SessionType;
  status: BookingStatus;
  /** Meet attendance couldn't confirm it; someone has to mark it */
  toMark: boolean;
  inviteFailed: boolean;
  auto: "completed" | "needs_marking" | null;
  /** minutes both people were in the Meet (when checked) */
  minutes: number | null;
  rating: number | null;
  recommend: boolean | null;
  promise: boolean;
};

export type ImpactKey = "All" | Campus;
export type DashImpact = { mode: string; ranges: AdminInsights["ranges"] } | null;

/** One IST day of pp_admin_impact_trend; t = that day's IST midnight (ms). */
export type TrendDay = { t: number; tries: number; booked: number; chats: number; paidAfter: number };
export type DashTrend = { days: TrendDay[]; payBins: Record<"7" | "30" | "90", number[]> } | null;
const NO_TREND: Record<ImpactKey, AdminImpactTrend | null> = { All: null, Pune: null, Gurugram: null };

export type DashData = {
  now: number;
  seniors: DashSenior[];
  chats: DashChat[];
  /** pp_admin_all stopped at its limit, so old chats are missing */
  capped: boolean;
  impact: Record<ImpactKey, DashImpact>;
  /** Impact trends per campus filter (null = could not be loaded) */
  trend?: Record<ImpactKey, DashTrend>;
  /** sample data (staging / preview only) */
  demo: boolean;
};

const ms = (v: string | null | undefined) => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** First 6 hex characters of the booking id, upper case. */
export const chatRef = (id: string) => id.replace(/[^0-9a-f]/gi, "").slice(0, 6).toUpperCase() || id.slice(0, 6).toUpperCase();

/** pp_admin_all → the dashboard's data. Only whitelisted fields are copied, so new private fields never leak by accident. */
export function toDashboardData(
  d: AdminData,
  now: number,
  impact: Record<ImpactKey, AdminInsights | null>,
  demo = false,
  trend: Record<ImpactKey, AdminImpactTrend | null> = NO_TREND,
): DashData {
  const seniors: DashSenior[] = d.seniors.map((s) => {
    const cap = d.settings[s.id]?.weeklyCap;
    return {
      id: s.id,
      firstName: s.firstName,
      campus: s.campus,
      year: s.year,
      status: s.status,
      topics: [...(s.topics ?? [])],
      languages: [...(s.languages ?? [])],
      hours: hoursOffered(d.rules[s.id]),
      weeklyCap: typeof cap === "number" && cap > 0 ? cap : null,
      lastActiveAt: ms(s.lastActiveAt),
      hasMeet: !!s.meetLink,
      portalPath: s.token ? ttsPath.portal(s.token) : null,
    };
  });
  const chats: DashChat[] = [];
  for (const b of d.bookings) {
    const start = ms(b.start);
    const end = ms(b.end);
    if (start === null || end === null) continue;
    const f = d.feedback[b.id];
    chats.push({
      id: b.id,
      ref: chatRef(b.id),
      seniorId: b.seniorId,
      start,
      end,
      created: ms(b.createdAt) ?? start,
      type: b.type,
      status: b.status,
      toMark: b.status === "confirmed" && b.autoResult === "needs_marking",
      inviteFailed: b.status === "confirmed" && b.meetSync === "failed",
      auto: b.autoResult ?? null,
      minutes: b.attendance && Number.isFinite(b.attendance.overlapMin) ? b.attendance.overlapMin : null,
      rating: f && Number.isFinite(f.rating) ? f.rating : null,
      recommend: f ? !!f.recommend : null,
      promise: !!f?.promiseMade,
    });
  }
  const imp = (x: AdminInsights | null): DashImpact => (x ? { mode: x.mode, ranges: x.ranges } : null);
  return {
    now,
    seniors,
    chats,
    capped: isCapped(d),
    impact: { All: imp(impact.All), Pune: imp(impact.Pune), Gurugram: imp(impact.Gurugram) },
    trend: { All: toDashTrend(trend.All), Pune: toDashTrend(trend.Pune), Gurugram: toDashTrend(trend.Gurugram) },
    demo,
  };
}

/** "YYYY-MM-DD" (an IST date) → that day's IST midnight in ms. */
export const istDayFromYmd = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`) - IST_MS;

/** Only the counts are copied, oldest day first. */
function toDashTrend(x: AdminImpactTrend | null): DashTrend {
  if (!x) return null;
  const days = x.days
    .map((y) => ({ t: istDayFromYmd(y.d), tries: y.tries, booked: y.booked, chats: y.chats, paidAfter: y.paid_after }))
    .filter((y) => Number.isFinite(y.t))
    .sort((a, b) => a.t - b.t);
  return { days, payBins: { "7": [...x.pay_bins["7"]], "30": [...x.pay_bins["30"]], "90": [...x.pay_bins["90"]] } };
}

/* ---------- filters ---------- */

export const RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];
export type DashFilters = { range: RangeDays; campus: ImpactKey; seniors: string[]; type: "All" | SessionType };
export const DEFAULT_FILTERS: DashFilters = { range: 30, campus: "All", seniors: [], type: "All" };

export const parseRange = (v: unknown): RangeDays => RANGES.find((r) => String(r) === v) ?? 30;
export const parseCampusKey = (v: unknown): ImpactKey => (v === "Pune" || v === "Gurugram" ? v : "All");

/** Senior passes the campus and senior filters. */
export function seniorInScope(s: DashSenior | undefined, f: DashFilters): boolean {
  if (!s) return false;
  if (f.campus !== "All" && s.campus !== f.campus) return false;
  return f.seniors.length === 0 || f.seniors.includes(s.id);
}

/** Chats that pass campus, senior and type filters (any date). */
export function scopeChats(data: DashData, f: DashFilters): DashChat[] {
  const by = new Map(data.seniors.map((s) => [s.id, s]));
  return data.chats.filter((c) => seniorInScope(by.get(c.seniorId), f) && (f.type === "All" || c.type === f.type));
}

/** [from, to) of the current range (back = 0) or the one before it (back = 1). */
export const rangeWindow = (now: number, days: number, back = 0): [number, number] => [now - days * DAY * (back + 1), now - days * DAY * back];
export const inWindow = (t: number, [from, to]: [number, number]) => t >= from && t < to;

/* ---------- chat rules (same as the admin page and the database) ---------- */

export const isDoneChat = (c: DashChat, now: number) => c.status === "completed" || (c.status === "confirmed" && c.end < now);
export const isUpcomingChat = (c: DashChat, now: number) => c.status === "confirmed" && c.start > now;
/** took (or will take) a slot: not cancelled, not moved */
export const holds = (c: DashChat) => c.status !== "cancelled" && c.status !== "rescheduled";

export type StatusTone = "good" | "violet" | "muted" | "warn" | "orange";
export function chatStatus(c: DashChat, now: number): { label: string; tone: StatusTone } {
  if (c.toMark) return { label: "To mark", tone: "orange" };
  if (c.inviteFailed) return { label: "Invite failed", tone: "warn" };
  if (c.status === "confirmed" && c.end < now) return { label: "Done", tone: "good" };
  switch (c.status) {
    case "completed":
      return { label: "Done", tone: "good" };
    case "confirmed":
      return { label: "Booked", tone: "violet" };
    case "no_show_applicant":
      return { label: "No-show", tone: "warn" };
    case "rescheduled":
      return { label: "Moved", tone: "muted" };
    default:
      return { label: "Cancelled", tone: "muted" };
  }
}

export const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);
export const avgRating = (list: DashChat[]): number | null => {
  const r = list.filter((c) => c.rating !== null);
  return r.length ? Math.round((r.reduce((a, c) => a + (c.rating ?? 0), 0) / r.length) * 10) / 10 : null;
};

/* ---------- IST labels ---------- */

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const istDate = (t: number) => new Date(t + IST_MS);
export const istDayStart = (t: number) => Math.floor((t + IST_MS) / DAY) * DAY - IST_MS;
export const dayNum = (t: number) => istDate(t).getUTCDate();
export const monShort = (t: number) => MON[istDate(t).getUTCMonth()];
export const dShort = (t: number) => `${dayNum(t)} ${monShort(t)}`;
export const dLong = (t: number) => `${DOW[(istDate(t).getUTCDay() + 6) % 7]}, ${dShort(t)}`;
export function tIST(t: number): string {
  const d = istDate(t);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h >= 12 ? "pm" : "am"}`;
}

/* ---------- series ---------- */

export type DayPoint = { t: number; v: number; label: string; title: string; list: DashChat[] };

/** One point per IST day in [from, to), counting the chats that start that day. */
export function dailySeries(list: DashChat[], [from, to]: [number, number], at: (c: DashChat) => number = (c) => c.start): DayPoint[] {
  const out: DayPoint[] = [];
  for (let t = istDayStart(from); t < to; t += DAY) {
    const day = list.filter((c) => at(c) >= t && at(c) < t + DAY);
    out.push({ t, v: day.length, label: dShort(t), title: dLong(t), list: day });
  }
  return out;
}

export type WeekBucket = { start: number; label: string; title: string; current: boolean; list: DashChat[]; done: number; upcoming: number; noShow: number; cancelled: number };

/** The last n IST weeks (Monday–Sunday), oldest first. */
export function weekBuckets(list: DashChat[], now: number, n = 10): WeekBucket[] {
  const w0 = istWeekStart(now);
  const out: WeekBucket[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const s = w0 - i * 7 * DAY;
    const l = list.filter((c) => c.start >= s && c.start < s + 7 * DAY);
    out.push({
      start: s,
      label: i ? dShort(s) : "This wk",
      title: `Week of ${dShort(s)}`,
      current: i === 0,
      list: l,
      done: l.filter((c) => isDoneChat(c, now)).length,
      upcoming: l.filter((c) => isUpcomingChat(c, now)).length,
      noShow: l.filter((c) => c.status === "no_show_applicant").length,
      cancelled: l.filter((c) => c.status === "cancelled").length,
    });
  }
  return out;
}

export const HEAT_BANDS = ["8–10a", "10–12", "12–2p", "2–4p", "4–6p", "6–8p", "8–10p", "10p+"] as const;
/** IST hour → band index (anything before 10 am goes in the first band). */
export const heatBand = (h: number) => (h < 10 ? 0 : h < 12 ? 1 : h < 14 ? 2 : h < 16 ? 3 : h < 18 ? 4 : h < 20 ? 5 : h < 22 ? 6 : 7);
export const istDow = (t: number) => (istDate(t).getUTCDay() + 6) % 7;
export const istHour = (t: number) => istDate(t).getUTCHours();

/** 7 weekdays × 8 time bands (IST). */
export function heatGrid(list: DashChat[]): number[][] {
  const grid = DOW.map(() => HEAT_BANDS.map(() => 0));
  for (const c of list) grid[istDow(c.start)][heatBand(istHour(c.start))]++;
  return grid;
}

export const LEAD_BINS = [
  ["<12h", 0, 12],
  ["12–24h", 12, 24],
  ["1–2d", 24, 48],
  ["2–3d", 48, 72],
  ["3–5d", 72, 120],
  ["5d+", 120, Infinity],
] as const;

/** Hours from booking to chat, grouped. Negative or missing leads are left out. */
export function leadHours(list: DashChat[]): number[] {
  return list.map((c) => (c.start - c.created) / HOUR).filter((h) => Number.isFinite(h) && h >= 0);
}
export function leadBins(hours: number[]): { label: string; v: number }[] {
  return LEAD_BINS.map(([label, a, z]) => ({ label, v: hours.filter((h) => h >= a && h < z).length }));
}

/* ---------- seniors ---------- */

export type DashSeniorRow = {
  s: DashSenior;
  /** chats that hold a slot and start in the range */
  chats: number;
  done: number;
  noShows: number;
  rating: number | null;
  reviews: number;
  recommendPct: number | null;
  /** whole days since last active; null = never */
  seenDays: number | null;
  thisWeek: number;
  /** holding chats per IST week, last 8 weeks, oldest first */
  weekly: number[];
  mine: DashChat[];
  idle: boolean;
  notSeen: boolean;
  atCap: boolean;
  ready: boolean;
};

/** One row per senior in scope (any status). Type filter applies to their chats. */
export function dashSeniorRows(data: DashData, f: DashFilters): DashSeniorRow[] {
  const { now } = data;
  const win = rangeWindow(now, f.range);
  const w0 = istWeekStart(now);
  return data.seniors
    .filter((s) => seniorInScope(s, f))
    .map((s) => {
      const mine = data.chats.filter((c) => c.seniorId === s.id && (f.type === "All" || c.type === f.type));
      const inRange = mine.filter((c) => holds(c) && inWindow(c.start, win));
      const rated = mine.filter((c) => c.rating !== null);
      // weekly cap rule from the database: confirmed or completed, one per start time
      const thisWeek = new Set(mine.filter((c) => (c.status === "confirmed" || c.status === "completed") && c.start >= w0 && c.start < w0 + 7 * DAY).map((c) => c.start)).size;
      const weekly: number[] = [];
      for (let i = 7; i >= 0; i--) {
        const a = w0 - i * 7 * DAY;
        weekly.push(mine.filter((c) => holds(c) && c.start >= a && c.start < a + 7 * DAY).length);
      }
      const live = s.status === "active";
      const seenDays = s.lastActiveAt === null ? null : Math.max(0, Math.floor((now - s.lastActiveAt) / DAY));
      return {
        s,
        chats: inRange.length,
        done: mine.filter((c) => isDoneChat(c, now)).length,
        noShows: mine.filter((c) => c.status === "no_show_applicant").length,
        rating: avgRating(rated),
        reviews: rated.length,
        recommendPct: rated.length ? pct(rated.filter((c) => c.recommend).length, rated.length) : null,
        seenDays,
        thisWeek,
        weekly,
        mine,
        idle: live && inRange.length === 0,
        notSeen: live && (seenDays === null || seenDays > 14),
        atCap: live && s.weeklyCap !== null && thisWeek >= s.weeklyCap,
        ready: s.hours > 0 && s.hasMeet,
      };
    });
}

/* ---------- quality ---------- */

/** Feedback that needs a person to read it: a reported promise or a rating of 2 or less. */
export const flaggedFeedback = (c: DashChat) => c.promise || (c.rating !== null && c.rating <= 2);

export type LowRatedRow = { s: DashSenior; avg: number; n: number };
/** At least 2 reviews and an average of 3.5 or less, worst first. */
export function lowRated(list: DashChat[], seniors: DashSenior[]): LowRatedRow[] {
  const by = new Map<string, number[]>();
  for (const c of list) if (c.rating !== null) by.set(c.seniorId, [...(by.get(c.seniorId) ?? []), c.rating]);
  const out: LowRatedRow[] = [];
  for (const [id, rs] of by) {
    const s = seniors.find((x) => x.id === id);
    const avg = rs.reduce((a, r) => a + r, 0) / rs.length;
    if (s && rs.length >= 2 && avg <= 3.5) out.push({ s, avg: Math.round(avg * 10) / 10, n: rs.length });
  }
  return out.sort((a, b) => a.avg - b.avg || b.n - a.n);
}

/* ---------- impact (from pp_admin_insights) ---------- */

export const impactRange = (imp: DashImpact, range: RangeDays): ImpactRange | null => imp?.ranges[String(range) as "7" | "30" | "90"] ?? null;

/* ---------- impact trends ---------- */

/** Days from the first chat to paying, the same bins as pp_admin_impact_trend. */
export const PAY_BIN_LABELS = ["<1d", "1–3d", "3–7d", "7–14d", "14–30d", "30d+"] as const;

export type TrendGroup = {
  /** IST midnight of the day, or of the Monday for a week */
  t: number;
  label: string;
  title: string;
  current: boolean;
  /** IST days in this group */
  days: number;
  tries: number;
  booked: number;
  /** tries that did not book */
  stopped: number;
  chats: number;
  paidAfter: number;
  /** first chats that have not paid after the chat (yet) */
  notPaid: number;
};

/**
 * The last `range` IST calendar days, today included: one group per day for 7 and 30 days,
 * one per IST week (Monday–Sunday) for 90 days. Oldest first.
 */
export function trendGroups(trend: DashTrend, now: number, range: RangeDays): TrendGroup[] {
  if (!trend) return [];
  const today = istDayStart(now);
  const from = today - (range - 1) * DAY;
  const weekly = range === 90;
  const thisWeek = istWeekStart(now);
  const by = new Map<number, TrendGroup>();
  for (const x of trend.days) {
    if (x.t < from || x.t > today) continue;
    const key = weekly ? istWeekStart(x.t) : x.t;
    let g = by.get(key);
    if (!g) {
      const current = weekly ? key === thisWeek : key === today;
      g = {
        t: key,
        label: current ? (weekly ? "This wk" : "Today") : dShort(key),
        title: weekly ? `Week of ${dShort(key)}` : dLong(key),
        current,
        days: 0,
        tries: 0,
        booked: 0,
        stopped: 0,
        chats: 0,
        paidAfter: 0,
        notPaid: 0,
      };
      by.set(key, g);
    }
    g.days++;
    g.tries += x.tries;
    g.booked += x.booked;
    g.chats += x.chats;
    g.paidAfter += x.paidAfter;
  }
  return [...by.values()]
    .sort((a, b) => a.t - b.t)
    .map((g) => ({ ...g, stopped: Math.max(0, g.tries - g.booked), notPaid: Math.max(0, g.chats - g.paidAfter) }));
}

/** The days-to-pay bins of a range, with labels. Empty when the trends could not be loaded. */
export function payBinsFor(trend: DashTrend, range: RangeDays): { label: string; v: number }[] {
  if (!trend) return [];
  const b = trend.payBins[String(range) as "7" | "30" | "90"];
  return PAY_BIN_LABELS.map((label, i) => ({ label, v: b[i] ?? 0 }));
}

export { median };
