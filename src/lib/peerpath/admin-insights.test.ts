import { describe, expect, it } from "vitest";
import { inviteFailed, isDone, isLive, isUpcoming, needsActionCounts, needsMarking, notReady } from "./admin-insights";
import type { AdminBooking, AdminData, SeniorPrivate } from "./types";

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
