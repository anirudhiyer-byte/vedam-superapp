import type { AdminBooking, AdminData, SeniorPrivate } from "./types";

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
