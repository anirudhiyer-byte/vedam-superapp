/**
 * VSAT Phase 7 · Profile Analysis page (migration 0191, sir's review 24 Nov 2026).
 *
 * Sir: search the student by application ID and pick the VSAT; the fields fill in from every source (the "Profile
 * Analyzer" tab of the VSAT Student Details sheet); the AI writes a neutral, logical, structured summary for the
 * counsellors. Data: vsat_profile_lookup (VSATs + search) and vsat_profile_get (one student). The summary itself is the
 * existing analyser (/api/vsat/profile, 0085): generated on the server and saved on the counselling record.
 */
import type { Stage, Status } from "./pipeline";

export type ProfileVsat = { id: string; label: string; exam_date: string | null };
export type ProfileHit = {
  application_id: string; application_no: string | null; name: string | null; campus: string | null; stage: Stage; status: Status;
};
export type ProfileLookup = { vsats: ProfileVsat[]; students: ProfileHit[]; total: number };
export type ProfileStudent = {
  application_id: string; application_no: string | null; name: string | null; campus: string | null;
  vsat: ProfileVsat | null; stage: Stage; status: Status;
  fields: [string, string][];
  has_counselling: boolean;
  analysis: { text: string; generated_at: string | null; model: string | null } | null;
};

/** Longest search the database accepts (vsat_profile_lookup). */
export const PROFILE_Q_MAX = 80;

/** The lookup call's body: the VSAT, and the search words only when there are some. */
export function lookupParams(vsatId: string, q: string): { exam_date_id?: string; q?: string } {
  const words = q.trim().slice(0, PROFILE_Q_MAX);
  return { ...(vsatId ? { exam_date_id: vsatId } : {}), ...(words ? { q: words } : {}) };
}

/** "Showing 25 of 40" only when the list was cut. */
export function matchText(shown: number, total: number): string {
  if (total === 0) return "No students match.";
  if (total > shown) return `Showing ${shown} of ${total}. Type more of the ID or name to narrow it.`;
  return `${total} student${total === 1 ? "" : "s"}`;
}

/** One row of the search list: "Name · APP-NO". */
export function hitText(h: Pick<ProfileHit, "name" | "application_no" | "application_id">): string {
  const id = h.application_no || h.application_id;
  return h.name ? `${h.name} · ${id}` : id;
}

/** The fields as rows; a long value (remarks, answers) is shown in full, nothing is cut here. */
export function fieldRows(fields: unknown): [string, string][] {
  if (!Array.isArray(fields)) return [];
  return fields.filter((f): f is [string, string] => Array.isArray(f) && f.length === 2 && typeof f[0] === "string" && typeof f[1] === "string");
}
