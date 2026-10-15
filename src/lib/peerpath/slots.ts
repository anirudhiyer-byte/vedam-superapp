import { BOOKING_RULES, type Duration, type SessionType } from "@/lib/peerpath/constants";
import type { AvailabilityRule, DateBlock, SeniorSettings, Slot } from "@/lib/peerpath/types";

/** IST is a fixed UTC+05:30 (no daylight saving), so plain arithmetic is safe. */
const IST_OFFSET_MIN = 330;
const MIN = 60_000;

export type BusyRange = { start: string; end: string; type: SessionType; seats?: number };

/** YYYY-MM-DD of an instant, in IST. */
export function istDateKey(d: Date): string {
  const t = new Date(d.getTime() + IST_OFFSET_MIN * MIN);
  return t.toISOString().slice(0, 10);
}

/** Monday-based week key in IST, used for weekly caps. */
function istWeekKey(d: Date): string {
  const t = new Date(d.getTime() + IST_OFFSET_MIN * MIN);
  const day = (t.getUTCDay() + 6) % 7; // 0 = Monday
  t.setUTCDate(t.getUTCDate() - day);
  return t.toISOString().slice(0, 10);
}

/** An IST wall-clock time on an IST date, as a UTC Date. */
function istToUtc(dateKey: string, hhmm: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, h, mi) - IST_OFFSET_MIN * MIN);
}

function addDays(dateKey: string, n: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function weekdayOf(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function isBlocked(dateKey: string, blocks: DateBlock[]): boolean {
  return blocks.some((b) => dateKey >= b.from && dateKey <= b.to);
}

/**
 * Builds the bookable slots for one senior from their own weekly rules,
 * blocked dates, caps and existing bookings.
 */
export function buildSlots(args: {
  seniorId: string;
  rules: AvailabilityRule[];
  blocks: DateBlock[];
  settings: SeniorSettings;
  durations: Duration[];
  busy: BusyRange[];
  now?: Date;
}): Slot[] {
  const { seniorId, rules, blocks, settings, busy } = args;
  if (settings.paused || rules.length === 0) return [];

  const now = args.now ?? new Date();
  const step = BOOKING_RULES.slotStepMinutes;
  const buffer = BOOKING_RULES.bufferMinutes;
  const notice = Math.max(settings.minNoticeHours, BOOKING_RULES.minNoticeHours);
  const earliest = now.getTime() + notice * 60 * MIN;
  const length: Duration = args.durations.includes(30) || args.durations.length === 0 ? 30 : 15;

  // Count existing sessions per IST day / week (a group session counts once).
  const perDay = new Map<string, number>();
  const perWeek = new Map<string, number>();
  const counted = new Set<string>();
  for (const b of busy) {
    if (counted.has(b.start)) continue;
    counted.add(b.start);
    const s = new Date(b.start);
    perDay.set(istDateKey(s), (perDay.get(istDateKey(s)) ?? 0) + 1);
    perWeek.set(istWeekKey(s), (perWeek.get(istWeekKey(s)) ?? 0) + 1);
  }

  const busyRanges = busy.map((b) => ({
    start: new Date(b.start).getTime(),
    end: new Date(b.end).getTime(),
    type: b.type,
    seats: b.seats ?? 1,
  }));

  const slots: Slot[] = [];
  const today = istDateKey(now);

  for (let i = 0; i < BOOKING_RULES.windowDays; i++) {
    const day = addDays(today, i);
    if (isBlocked(day, blocks)) continue;
    const dayRules = rules.filter((r) => r.weekday === weekdayOf(day));

    for (const rule of dayRules) {
      const from = istToUtc(day, rule.from).getTime();
      const to = istToUtc(day, rule.to).getTime();

      for (let t = from; t + length * MIN <= to; t += step * MIN) {
        if (t < earliest) continue;
        const start = new Date(t);
        const end = t + length * MIN;
        const dayKey = istDateKey(start);
        const weekKey = istWeekKey(start);

        if (rule.type === "Group") {
          const same = busyRanges.filter((b) => b.type === "Group" && b.start === t);
          const taken = same.reduce((n, b) => n + b.seats, 0);
          const seatsLeft = BOOKING_RULES.groupCapacity - taken;
          const clash = busyRanges.some((b) => b.type !== "Group" && b.start < end + buffer * MIN && t < b.end + buffer * MIN);
          const newSession = same.length === 0;
          if (seatsLeft <= 0 || clash) continue;
          if (newSession && ((perDay.get(dayKey) ?? 0) >= settings.dailyCap || (perWeek.get(weekKey) ?? 0) >= settings.weeklyCap)) continue;
          slots.push({ seniorId, start: start.toISOString(), end: new Date(end).toISOString(), type: "Group", duration: 30, seatsLeft });
          continue;
        }

        if ((perDay.get(dayKey) ?? 0) >= settings.dailyCap) continue;
        if ((perWeek.get(weekKey) ?? 0) >= settings.weeklyCap) continue;
        const clash = busyRanges.some((b) => b.start < end + buffer * MIN && t < b.end + buffer * MIN);
        if (clash) continue;
        slots.push({ seniorId, start: start.toISOString(), end: new Date(end).toISOString(), type: "1:1", duration: length, seatsLeft: null });
      }
    }
  }

  return slots.sort((a, b) => a.start.localeCompare(b.start));
}

/** Formatting helpers, always in IST. */
const tz = BOOKING_RULES.timeZone;

export function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true })
    .format(new Date(iso))
    .replace(/\s?(am|pm)$/i, (m) => " " + m.trim().toUpperCase());
}

export function fmtDay(iso: string, now = new Date()): string {
  const key = istDateKey(new Date(iso));
  const today = istDateKey(now);
  if (key === today) return "Today";
  if (key === addDays(today, 1)) return "Tomorrow";
  return new Intl.DateTimeFormat("en-IN", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));
}

export function fmtSlotShort(iso: string, now = new Date()): string {
  const key = istDateKey(new Date(iso));
  const today = istDateKey(now);
  const day =
    key === today
      ? "Today"
      : key === addDays(today, 1)
        ? "Tomorrow"
        : new Intl.DateTimeFormat("en-IN", { timeZone: tz, weekday: "short" }).format(new Date(iso));
  return `${day} ${fmtTime(iso)}`;
}

export function istHour(iso: string): number {
  const t = new Date(new Date(iso).getTime() + IST_OFFSET_MIN * MIN);
  return t.getUTCHours();
}

export function nextDays(n: number, now = new Date()): { key: string; dow: string; date: string; month: string }[] {
  const today = istDateKey(now);
  return Array.from({ length: n }, (_, i) => {
    const key = addDays(today, i);
    const [y, m, d] = key.split("-").map(Number);
    const at = new Date(Date.UTC(y, m - 1, d, 6, 30));
    return {
      key,
      dow: i === 0 ? "Today" : new Intl.DateTimeFormat("en-IN", { timeZone: tz, weekday: "short" }).format(at),
      date: String(d),
      month: new Intl.DateTimeFormat("en-IN", { timeZone: tz, month: "short" }).format(at),
    };
  });
}
