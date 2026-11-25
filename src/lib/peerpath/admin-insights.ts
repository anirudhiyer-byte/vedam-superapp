import { LANGUAGES, TOPICS, type Campus } from "./constants";
import { BOOK_CODES, type BookFailCode } from "./booking-codes";
import type { AdminBooking, AdminData, AdminInsights, AvailabilityRule, ImpactRange, SeniorPrivate } from "./types";

const HOUR = 3_600_000;

/** A chat that is over: marked completed, or confirmed and already ended. */
export const isDone = (b: AdminBooking, now: number) => b.status === "completed" || (b.status === "confirmed" && new Date(b.end).getTime() < now);
/** A confirmed chat that has not started yet. */
export const isUpcoming = (b: AdminBooking, now: number) => b.status === "confirmed" && new Date(b.start).getTime() > now;
export const isLive = (s: SeniorPrivate) => s.status === "active";

/** Meet could not confirm the chat, so a person must mark it. Only for a still-confirmed booking. */
export const needsMarking = (b: AdminBooking) => b.status === "confirmed" && b.autoResult === "needs_marking";
/** The Google Meet invite failed to send. Only for a still-confirmed booking. */
export const inviteFailed = (b: AdminBooking) => b.status === "confirmed" && b.meetSync === "failed";

/** A live senior who cannot be booked properly: no weekly times, or no Meet link. */
export const notReady = (s: SeniorPrivate, d: AdminData) => isLive(s) && ((d.rules[s.id]?.length ?? 0) === 0 || !s.meetLink);

export type NeedsAction = {
  /** seniors with status "pending" */
  waitingApproval: number;
  /** live seniors with no times or no Meet link */
  notReady: number;
  /** confirmed chats Meet could not confirm */
  toMark: number;
  /** confirmed chats whose Meet invite failed */
  inviteFailed: number;
  /** confirmed chats starting within the next 24 hours (start in (now, now + 24h]) */
  next24h: number;
};

/** Counts for the "Needs action" strip. Read-only: never changes d. */
export function needsActionCounts(d: AdminData, now: number): NeedsAction {
  return {
    waitingApproval: d.seniors.filter((s) => s.status === "pending").length,
    notReady: d.seniors.filter((s) => notReady(s, d)).length,
    toMark: d.bookings.filter(needsMarking).length,
    inviteFailed: d.bookings.filter(inviteFailed).length,
    next24h: d.bookings.filter((b) => isUpcoming(b, now) && new Date(b.start).getTime() <= now + 24 * HOUR).length,
  };
}

/* ---------- Tabs ---------- */

export const ADMIN_TABS = ["overview", "sessions", "seniors", "quality", "impact"] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];

/** Reads ?tab=. Exact match against ADMIN_TABS only; anything else (arrays, junk, empty) is "overview". */
export function parseTab(v: unknown): AdminTab {
  if (typeof v !== "string") return "overview";
  return ADMIN_TABS.find((t) => t === v) ?? "overview";
}

/* ---------- Small maths ---------- */

/** Middle value (average of the two middle values for an even count). Empty list → null. */
export function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/* ---------- IST time (fixed UTC+05:30, no daylight saving) ---------- */

const IST_MS = 330 * 60_000;
const DAY = 24 * HOUR;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The instant of IST Monday 00:00 that starts the week containing t. */
export function istWeekStart(t: number): number {
  const day = Math.floor((t + IST_MS) / DAY) * DAY; // IST midnight, on the shifted clock
  const dow = (new Date(day).getUTCDay() + 6) % 7; // 0 = Monday
  return day - dow * DAY - IST_MS;
}

/** IST weekday, 0 = Monday … 6 = Sunday. */
export const istWeekday = (t: number) => (new Date(t + IST_MS).getUTCDay() + 6) % 7;
export const istHourOf = (t: number) => new Date(t + IST_MS).getUTCHours();

/* ---------- Sessions tab ---------- */

/** A chat that took (or will take) a slot: not cancelled and not moved away. */
const holdsSlot = (b: AdminBooking) => b.status !== "cancelled" && b.status !== "rescheduled";

export type Funnel = { booked: number; done: number; feedback: number; cancelled: number; noShow: number; moved: number; upcoming: number };

/**
 * Booked = every booking except the old row of a moved chat (the new row counts), so a moved chat counts once.
 * Done = isDone. Feedback = done chats that have feedback.
 */
export function sessionFunnel(d: AdminData, now: number): Funnel {
  const booked = d.bookings.filter((b) => b.status !== "rescheduled");
  const done = booked.filter((b) => isDone(b, now));
  return {
    booked: booked.length,
    done: done.length,
    feedback: done.filter((b) => d.feedback[b.id]).length,
    cancelled: d.bookings.filter((b) => b.status === "cancelled").length,
    noShow: d.bookings.filter((b) => b.status === "no_show_applicant").length,
    moved: d.bookings.filter((b) => b.status === "rescheduled").length,
    upcoming: d.bookings.filter((b) => isUpcoming(b, now)).length,
  };
}

export type WeekCount = { start: number; label: string; count: number };

/** Chats per IST week (Monday start), oldest first, ending with this week. Cancelled and moved chats are left out; older and later chats are ignored. */
export function weeklyCounts(d: AdminData, now: number, weeks = 8): WeekCount[] {
  const thisWeek = istWeekStart(now);
  const out: WeekCount[] = Array.from({ length: weeks }, (_, i) => {
    const start = thisWeek - (weeks - 1 - i) * 7 * DAY;
    const ist = new Date(start + IST_MS);
    return { start, label: `${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]}`, count: 0 };
  });
  const first = out[0].start;
  for (const b of d.bookings) {
    if (!holdsSlot(b)) continue;
    const t = new Date(b.start).getTime();
    if (t < first || t >= thisWeek + 7 * DAY) continue;
    out[Math.floor((istWeekStart(t) - first) / (7 * DAY))].count++;
  }
  return out;
}

export type Reality = { checked: number; autoCompleted: number; autoPct: number | null; medianMinutes: number | null; toMark: number; inviteFailed: number };

/** What Meet saw: done chats with attendance data → share auto-completed and median minutes together. */
export function sessionReality(d: AdminData, now: number): Reality {
  const checked = d.bookings.filter((b) => isDone(b, now) && b.attendance);
  const auto = checked.filter((b) => b.autoResult === "completed").length;
  return {
    checked: checked.length,
    autoCompleted: auto,
    autoPct: checked.length ? Math.round((auto / checked.length) * 100) : null,
    medianMinutes: median(checked.map((b) => b.attendance!.overlapMin)),
    toMark: d.bookings.filter(needsMarking).length,
    inviteFailed: d.bookings.filter(inviteFailed).length,
  };
}

export const IST_BANDS = ["Before 12", "12–17", "17–21", "21+"] as const;
export const IST_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** IST hour → band: before 12:00, 12:00–16:59, 17:00–20:59, 21:00 and later. */
export const bandOf = (hour: number) => (hour < 12 ? 0 : hour < 17 ? 1 : hour < 21 ? 2 : 3);

export type When = { grid: number[][]; total: number; medianLeadHours: number | null };

/** When chats happen: 7 IST weekdays × 4 bands (cancelled and moved left out), and the median hours from booking to chat. */
export function whenGrid(d: AdminData): When {
  const grid = IST_DAYS.map(() => IST_BANDS.map(() => 0));
  const leads: number[] = [];
  let total = 0;
  for (const b of d.bookings) {
    if (!holdsSlot(b)) continue;
    const t = new Date(b.start).getTime();
    grid[istWeekday(t)][bandOf(istHourOf(t))]++;
    total++;
    const lead = (t - new Date(b.createdAt).getTime()) / HOUR;
    if (Number.isFinite(lead) && lead >= 0) leads.push(lead);
  }
  return { grid, total, medianLeadHours: median(leads) };
}

/* ---------- Seniors tab ---------- */

const toMin = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

/** Hours a senior offers per week: sum of (to − from) over their weekly rules. Bad or reversed rules count 0. */
export function hoursOffered(rules: AvailabilityRule[] | undefined): number {
  let min = 0;
  for (const r of rules ?? []) {
    const len = toMin(r.to) - toMin(r.from);
    if (Number.isFinite(len) && len > 0) min += len;
  }
  return Math.round((min / 60) * 10) / 10;
}

/** Chats that count against the weekly cap, same rule as the database: confirmed or completed, one per start time. */
function capChatsThisWeek(d: AdminData, seniorId: string, now: number): number {
  const from = istWeekStart(now);
  const to = from + 7 * DAY;
  const starts = new Set<number>();
  for (const b of d.bookings) {
    if (b.seniorId !== seniorId || (b.status !== "confirmed" && b.status !== "completed")) continue;
    const t = new Date(b.start).getTime();
    if (t >= from && t < to) starts.add(t);
  }
  return starts.size;
}

export type SeniorRow = {
  id: string;
  firstName: string;
  campus: Campus;
  hours: number;
  chats30: number;
  done: number;
  noShows: number;
  rating: number | null;
  reviews: number;
  recommendPct: number | null;
  lastActiveAt: string | null;
  thisWeek: number;
  weeklyCap: number | null;
  idle: boolean;
  notSeen: boolean;
  atCap: boolean;
};

/** One row per live senior, in the order the data arrives. */
export function seniorRows(d: AdminData, now: number): SeniorRow[] {
  const since30 = now - 30 * DAY;
  return d.seniors.filter(isLive).map((s) => {
    const mine = d.bookings.filter((b) => b.seniorId === s.id);
    const fb = mine.map((b) => d.feedback[b.id]).filter(Boolean);
    const chats30 = mine.filter((b) => {
      const t = new Date(b.start).getTime();
      return holdsSlot(b) && t >= since30 && t <= now;
    }).length;
    const cap = d.settings[s.id]?.weeklyCap;
    const weeklyCap = typeof cap === "number" && cap > 0 ? cap : null;
    const thisWeek = capChatsThisWeek(d, s.id, now);
    const seen = s.lastActiveAt ? new Date(s.lastActiveAt).getTime() : NaN;
    return {
      id: s.id,
      firstName: s.firstName,
      campus: s.campus,
      hours: hoursOffered(d.rules[s.id]),
      chats30,
      done: mine.filter((b) => isDone(b, now)).length,
      noShows: mine.filter((b) => b.status === "no_show_applicant").length,
      rating: fb.length ? Math.round((fb.reduce((a, f) => a + f.rating, 0) / fb.length) * 10) / 10 : null,
      reviews: fb.length,
      recommendPct: fb.length ? Math.round((fb.filter((f) => f.recommend).length / fb.length) * 100) : null,
      lastActiveAt: s.lastActiveAt,
      thisWeek,
      weeklyCap,
      idle: chats30 === 0,
      notSeen: !Number.isFinite(seen) || seen < now - 14 * DAY,
      atCap: weeklyCap !== null && thisWeek >= weeklyCap,
    };
  });
}

export type SeniorTotals = { live: number; hours: number; avgChatsPerWeek: number };

/** Live seniors, total hours offered per week, and average chats per week over the last 4 weeks (cancelled and moved left out). */
export function seniorTotals(d: AdminData, now: number): SeniorTotals {
  const live = d.seniors.filter(isLive);
  const since = now - 28 * DAY;
  const chats = d.bookings.filter((b) => {
    const t = new Date(b.start).getTime();
    return holdsSlot(b) && t >= since && t <= now;
  }).length;
  return {
    live: live.length,
    hours: Math.round(live.reduce((a, s) => a + hoursOffered(d.rules[s.id]), 0) * 10) / 10,
    avgChatsPerWeek: Math.round((chats / 4) * 10) / 10,
  };
}

export type CoverageItem = { name: string; seniors: number; thin: boolean };

/** Live seniors per topic and per language (lists from constants). thin = fewer than 2. */
export function coverage(d: AdminData): { topics: CoverageItem[]; languages: CoverageItem[] } {
  const live = d.seniors.filter(isLive);
  const count = (names: readonly string[], pick: (s: SeniorPrivate) => readonly string[]) =>
    names.map((name) => {
      const n = live.filter((s) => (pick(s) ?? []).includes(name)).length;
      return { name, seniors: n, thin: n < 2 };
    });
  return { topics: count(TOPICS, (s) => s.topics), languages: count(LANGUAGES, (s) => s.languages) };
}

/* ---------- Quality tab ---------- */

export type LowRated = { id: string; firstName: string; rating: number; reviews: number };
export type Quality = {
  reviews: number;
  done: number;
  feedbackRate: number | null;
  avgRating: number | null;
  recommendPct: number | null;
  /** index 0 = 1 star … index 4 = 5 stars */
  dist: number[];
  promises: number;
  lowRated: LowRated[];
};

/** Feedback on the chats in d. Low-rated = at least 2 reviews and average 3.0 or less, worst first. */
export function qualityStats(d: AdminData, now: number): Quality {
  const done = d.bookings.filter((b) => isDone(b, now));
  const fbs = d.bookings.map((b) => ({ b, f: d.feedback[b.id] })).filter((x) => x.f);
  const dist = [0, 0, 0, 0, 0];
  for (const { f } of fbs) if (f.rating >= 1 && f.rating <= 5) dist[Math.round(f.rating) - 1]++;
  const bySenior = new Map<string, number[]>();
  for (const { b, f } of fbs) bySenior.set(b.seniorId, [...(bySenior.get(b.seniorId) ?? []), f.rating]);
  const lowRated: LowRated[] = [];
  for (const [id, rs] of bySenior) {
    const avg = rs.reduce((a, r) => a + r, 0) / rs.length;
    const s = d.seniors.find((x) => x.id === id);
    if (s && rs.length >= 2 && avg <= 3) lowRated.push({ id, firstName: s.firstName, rating: Math.round(avg * 10) / 10, reviews: rs.length });
  }
  lowRated.sort((a, b) => a.rating - b.rating || b.reviews - a.reviews);
  const n = fbs.length;
  return {
    reviews: n,
    done: done.length,
    feedbackRate: done.length ? Math.round((done.filter((b) => d.feedback[b.id]).length / done.length) * 100) : null,
    avgRating: n ? Math.round((fbs.reduce((a, x) => a + x.f.rating, 0) / n) * 10) / 10 : null,
    recommendPct: n ? Math.round((fbs.filter((x) => x.f.recommend).length / n) * 100) : null,
    dist,
    promises: fbs.filter((x) => x.f.promiseMade).length,
    lowRated,
  };
}

/** pp_admin_all returns at most this many bookings (latest first). */
export const BOOKING_LIMIT = 2000;
export const isCapped = (d: AdminData) => d.bookings.length >= BOOKING_LIMIT;

/* ---------- Impact tab (2B, pp_admin_insights) ---------- */

export const IMPACT_RANGES = ["7", "30", "90"] as const;
export type ImpactRangeKey = (typeof IMPACT_RANGES)[number];

/** Reads ?days=. Only 7, 30 or 90; anything else is 30. */
export function parseDays(v: unknown): ImpactRangeKey {
  if (typeof v !== "string") return "30";
  return IMPACT_RANGES.find((d) => d === v) ?? "30";
}

/** Plain words for why a booking try was blocked. Every booking code except OK has one. */
export const BLOCK_LABELS: Record<BookFailCode, string> = {
  NOT_LOGGED_IN: "Not signed in",
  NOT_REGISTERED: "Not registered for VSAT",
  PAYMENT_PENDING: "Payment pending",
  EMAIL_MISSING: "No email",
  EMAIL_NOT_VERIFIED: "No email",
  SLOT_UNAVAILABLE: "Slot taken",
  LIMIT_REACHED: "Limit reached",
  RATE_LIMITED: "Too many tries",
  BOOKING_CLOSED: "Booking closed",
  SERVER: "System error",
  INVALID: "Other",
  RESCHEDULE_CLOSED: "Other",
  FORBIDDEN: "Other",
};
const OTHER = "Other";
const isFailCode = (c: string): c is BookFailCode => c !== "OK" && (BOOK_CODES as readonly string[]).includes(c);

export type BlockedReason = { label: string; people: number; attempts: number };

/** Groups the blocked codes under their labels (unknown codes → Other), most people first, Other last. */
export function blockedReasons(blocked: Record<string, { attempts: number; people: number }>): BlockedReason[] {
  const by = new Map<string, BlockedReason>();
  for (const [code, v] of Object.entries(blocked)) {
    if (code === "OK") continue;
    const label = isFailCode(code) ? BLOCK_LABELS[code] : OTHER;
    const cur = by.get(label) ?? { label, people: 0, attempts: 0 };
    cur.people += v.people;
    cur.attempts += v.attempts;
    by.set(label, cur);
  }
  return [...by.values()].sort((a, b) => (a.label === OTHER ? 1 : 0) - (b.label === OTHER ? 1 : 0) || b.people - a.people || a.label.localeCompare(b.label));
}

/**
 * People who tried in the range but never got a booking. Uses the database's own distinct counts
 * (people − people_booked), so a person stopped for two reasons is still one person.
 */
export const notBookedPeople = (d: { people: number; people_booked: number }) => Math.max(0, d.people - d.people_booked);

const count = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function parseRange(v: unknown): ImpactRange | null {
  const r = obj(v);
  const d = obj(r?.demand);
  const o = obj(r?.outcome);
  if (!d || !o) return null;
  const nums = <K extends string>(src: Record<string, unknown>, keys: readonly K[]) => {
    const out = {} as Record<K, number>;
    for (const k of keys) {
      const n = count(src[k]);
      if (n === null) return null;
      out[k] = n;
    }
    return out;
  };
  const dn = nums(d, ["attempts", "people", "booked", "people_booked"] as const);
  const on = nums(o, ["applicants", "paid_before", "paid_after", "not_paid", "enrolled", "enrolled_after"] as const);
  if (!dn || !on) return null;
  const blocked: ImpactRange["demand"]["blocked"] = {};
  for (const [code, x] of Object.entries(obj(d.blocked) ?? {})) {
    const e = obj(x);
    const a = count(e?.attempts);
    const p = count(e?.people);
    if (/^[A-Z_]{1,40}$/.test(code) && a !== null && p !== null) blocked[code] = { attempts: a, people: p };
  }
  const median = (m: unknown) => (m === null || m === undefined ? null : count(m));
  return {
    demand: { ...dn, blocked },
    outcome: { ...on, median_days_to_pay: median(o.median_days_to_pay), median_days_to_enroll: median(o.median_days_to_enroll) },
  };
}

/** Checks the database answer; anything off-shape gives null (the page then shows a generic message). */
export function parseAdminInsights(data: unknown): AdminInsights | null {
  const d = obj(data);
  const ranges = obj(d?.ranges);
  if (!d || typeof d.mode !== "string" || !ranges) return null;
  const out = {} as AdminInsights["ranges"];
  for (const k of IMPACT_RANGES) {
    const r = parseRange(ranges[k]);
    if (!r) return null;
    out[k] = r;
  }
  return { mode: d.mode, ranges: out };
}
