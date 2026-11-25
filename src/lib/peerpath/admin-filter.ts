import { CAMPUSES, type Campus } from "./constants";
import type { AdminData } from "./types";

/**
 * Reads the ?campus= value of the admin page. Exact match against CAMPUSES only:
 * lowercase, arrays, junk, empty and undefined all give null (no filter).
 */
export function parseCampus(v: unknown): Campus | null {
  if (typeof v !== "string") return null;
  return CAMPUSES.find((c) => c === v) ?? null;
}

function pick<T>(map: Record<string, T>, keep: Set<string>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const id of Object.keys(map)) if (keep.has(id)) out[id] = map[id];
  return out;
}

/**
 * Keeps only one campus of the admin data. null returns the same object.
 * Bookings follow their senior, feedback follows its booking, and rules/blocks/settings
 * follow their senior. The original order is kept (bookings arrive start_at desc).
 */
export function filterAdminByCampus(d: AdminData, campus: Campus | null): AdminData {
  if (campus === null) return d;
  const seniors = d.seniors.filter((s) => s.campus === campus);
  const seniorIds = new Set(seniors.map((s) => s.id));
  const bookings = d.bookings.filter((b) => seniorIds.has(b.seniorId));
  const bookingIds = new Set(bookings.map((b) => b.id));
  return {
    seniors,
    bookings,
    feedback: pick(d.feedback, bookingIds),
    rules: pick(d.rules, seniorIds),
    blocks: pick(d.blocks, seniorIds),
    settings: pick(d.settings, seniorIds),
  };
}
