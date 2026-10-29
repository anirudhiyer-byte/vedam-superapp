/**
 * PeerPath · Meet attendance → booking result. Pure, no I/O, so it is unit-tested.
 *
 * Meet tells us who was in a call and when, but not reliably *which* person was
 * the senior or the applicant (an applicant may join without signing in). So the
 * rule is about people and time, never identity:
 *   - 1:1:   2+ people together for the minimum overlap      → completed
 *   - group: (bookings + 1)+ people together for the overlap → completed
 *   - anything else                                          → needs marking
 */
import { MEET_RULES } from "./constants";

export type Session = { start: number; end: number }; // epoch ms
export type Participant = { key: string; sessions: Session[] };

export type MarkReason = "nobody_joined" | "one_joined" | "too_short" | "group_partial" | "no_record" | "check_failed";

export type AttendanceResult =
  | { result: "completed"; people: number; overlapMin: number }
  | { result: "needs_marking"; reason: MarkReason; people: number; overlapMin: number };

const MIN = 60_000;

/** Merge overlapping intervals; input need not be sorted. */
function union(sessions: Session[]): Session[] {
  const s = sessions.filter((x) => x.end > x.start).sort((a, b) => a.start - b.start);
  const out: Session[] = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last && x.start <= last.end) last.end = Math.max(last.end, x.end);
    else out.push({ ...x });
  }
  return out;
}

const total = (s: Session[]) => s.reduce((n, x) => n + (x.end - x.start), 0);

/** Minutes during which at least `k` of the given people were present at once. */
export function minutesWithAtLeast(people: Session[][], k: number): number {
  const edges: [number, number][] = [];
  for (const p of people) for (const x of p) edges.push([x.start, +1], [x.end, -1]);
  // ends before starts at the same instant, so touching sessions don't count as overlap
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let live = 0;
  let since = 0;
  let ms = 0;
  for (const [t, d] of edges) {
    if (live >= k) ms += t - since;
    live += d;
    since = t;
  }
  return Math.round((ms / MIN) * 10) / 10;
}

export function decideAttendance(args: {
  bookings: number;
  window: { start: number; end: number }; // the booked chat time
  participants: Participant[];
  hasRecord: boolean;
  rules?: { minOverlapMinutes: number; minPresenceMinutes: number };
}): AttendanceResult {
  const rules = args.rules ?? MEET_RULES;
  if (!args.hasRecord) return { result: "needs_marking", reason: "no_record", people: 0, overlapMin: 0 };

  // only count time near the booked slot: 15 min early to 60 min late
  const lo = args.window.start - 15 * MIN;
  const hi = args.window.end + 60 * MIN;

  // the same person can appear more than once (rejoined, second record) → merge by key
  const byKey = new Map<string, Session[]>();
  for (const p of args.participants) {
    const clipped = p.sessions
      .map((x) => ({ start: Math.max(x.start, lo), end: Math.min(x.end, hi) }))
      .filter((x) => x.end > x.start);
    byKey.set(p.key, [...(byKey.get(p.key) ?? []), ...clipped]);
  }
  const present = [...byKey.values()].map(union).filter((s) => total(s) >= rules.minPresenceMinutes * MIN);
  const people = present.length;
  const need = args.bookings > 1 ? args.bookings + 1 : 2;
  // "together" = at least two people in the call at the same time
  const overlapMin = minutesWithAtLeast(present, 2);

  if (args.bookings > 1) {
    if (people >= need && overlapMin >= rules.minOverlapMinutes) return { result: "completed", people, overlapMin };
    return { result: "needs_marking", reason: "group_partial", people, overlapMin };
  }
  if (people >= 2 && overlapMin >= rules.minOverlapMinutes) return { result: "completed", people, overlapMin };
  const reason: MarkReason = people === 0 ? "nobody_joined" : people === 1 ? "one_joined" : "too_short";
  return { result: "needs_marking", reason, people, overlapMin };
}

/** Plain-English hint shown to the senior next to a chat that needs marking. */
export const MARK_HINT: Record<MarkReason, string> = {
  nobody_joined: "Google Meet shows nobody joined this chat.",
  one_joined: "Google Meet shows only one person joined. Did the applicant join?",
  too_short: "Google Meet shows a very short call. Did the chat happen?",
  group_partial: "Google Meet shows fewer people than booked. Please mark each applicant.",
  no_record: "We couldn't find this chat in Google Meet. Please mark it.",
  check_failed: "We couldn't read Google Meet for this chat. Please mark it.",
};
