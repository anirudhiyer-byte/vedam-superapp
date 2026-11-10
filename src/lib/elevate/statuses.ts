/**
 * Elevate CRM — the 17 statuses and the fields some of them require.
 * (Dropped Out is intentionally NOT emitted by our triggers: it means a student
 *  who joined on campus then left — a signal we don't track here. Rejections
 *  never map to a status.)
 */
export const ELEVATE_STATUSES = [
  "Lead", "Form Started", "Form Paid", "Form Completed",
  "Test Booked", "Test Done", "Test Cleared",
  "PI Booked", "PI Done", "PI Cleared",
  "Offer Letter Released", "Seat Booked", "Refund Requested",
  "Reported to Campus", "1st Year Fees Paid", "Refund Completed", "Dropped Out",
] as const;
export type ElevateStatus = (typeof ELEVATE_STATUSES)[number];

/** Statuses that require `campus`. */
export const CAMPUS_STATUSES = new Set<string>(["Seat Booked", "Reported to Campus", "1st Year Fees Paid"]);

export function isElevateStatus(s: unknown): s is ElevateStatus {
  return typeof s === "string" && (ELEVATE_STATUSES as readonly string[]).includes(s);
}

/** Our brand's campuses, as Elevate lists them (case-insensitive on their side). */
export const VEDAM_CAMPUSES = new Set<string>(["Pune", "Gurugram", "Delhi NCR"]);
