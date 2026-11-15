import { TIME_OF_DAY, type Campus, type Duration, type Residence, type SessionType, type TimeOfDay, type Topic, type Year } from "@/lib/peerpath/constants";
import type { SeniorWithSlots, Slot } from "@/lib/peerpath/types";
import { istDateKey, istHour } from "@/lib/peerpath/slots";

export type CampusChoice = Campus | "Both";

export type Filters = {
  campus: CampusChoice;
  topics: Topic[];
  languages: string[];
  years: Year[];
  date: string | null; // YYYY-MM-DD (IST)
  timeOfDay: TimeOfDay[];
  sessionType: SessionType | null;
  duration: Duration | null;
  minRating: number; // 0 = any
  homeState: string;
  residence: Residence | null;
};

export const EMPTY_FILTERS: Filters = {
  campus: "Both",
  topics: [],
  languages: [],
  years: [],
  date: null,
  timeOfDay: [],
  sessionType: null,
  duration: null,
  minRating: 0,
  homeState: "",
  residence: null,
};

/** Count of "More filters" in use (campus and topic are shown separately). */
export function moreCount(f: Filters): number {
  return (
    (f.languages.length ? 1 : 0) +
    (f.years.length ? 1 : 0) +
    (f.date ? 1 : 0) +
    (f.timeOfDay.length ? 1 : 0) +
    (f.sessionType ? 1 : 0) +
    (f.duration ? 1 : 0) +
    (f.minRating ? 1 : 0) +
    (f.homeState ? 1 : 0) +
    (f.residence ? 1 : 0)
  );
}

function slotMatches(slot: Slot, f: Filters): boolean {
  if (f.date && istDateKey(new Date(slot.start)) !== f.date) return false;
  if (f.sessionType && slot.type !== f.sessionType) return false;
  if (f.timeOfDay.length) {
    const h = istHour(slot.start);
    const ok = TIME_OF_DAY.some((t) => f.timeOfDay.includes(t.id) && h >= t.from && h < t.to);
    if (!ok) return false;
  }
  return true;
}

export type Result = { senior: SeniorWithSlots; slots: Slot[] };

/** Applies every filter. Seniors with a matching free time come first, soonest first. */
export function applyFilters(all: SeniorWithSlots[], f: Filters): Result[] {
  const slotFilterOn = !!(f.date || f.timeOfDay.length || f.sessionType);
  const out: Result[] = [];
  for (const s of all) {
    if (f.campus !== "Both" && s.campus !== f.campus) continue;
    if (f.topics.length && !f.topics.some((t) => s.topics.includes(t))) continue;
    if (f.languages.length && !f.languages.some((l) => s.languages.includes(l))) continue;
    if (f.years.length && !f.years.includes(s.year)) continue;
    if (f.sessionType && !s.sessionTypes.includes(f.sessionType)) continue;
    if (f.duration && !s.durations.includes(f.duration)) continue;
    if (f.minRating && (s.rating === null || s.ratingCount < 3 || s.rating < f.minRating)) continue;
    if (f.homeState && s.homeState !== f.homeState) continue;
    if (f.residence && s.residence !== f.residence) continue;
    const slots = s.slots.filter((x) => slotMatches(x, f));
    if (slotFilterOn && slots.length === 0) continue;
    out.push({ senior: s, slots });
  }
  return out.sort((a, b) => {
    const x = a.slots[0]?.start ?? "9999";
    const y = b.slots[0]?.start ?? "9999";
    return x.localeCompare(y);
  });
}
