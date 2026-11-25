/**
 * VSAT counselling setup (0184, owner's review 24 Nov 2026): one Zoom link per counsellor and the offline counselling
 * dates per campus. The database is the gate (vsat_counsellor_zoom_set, vsat_offline_date_add); this mirrors its
 * checks so the screen can say what is wrong before saving.
 */

export type ZoomLinkRow = {
  counsellor_id: string; name: string | null; email: string | null; campus: string | null;
  zoom_link: string | null; updated_at: string | null;
};
export type OfflineDateRow = { id: string; campus: "pune" | "gurugram"; date: string; note: string | null; past: boolean };

/** Same rule as the database: https, a zoom.us host (or a sub-domain of it), a path, no spaces, at most 500 characters. */
const ZOOM_RE = /^https:\/\/([a-z0-9-]+\.)*zoom\.us\/[^\s<>"]+$/i;

/** Why a pasted Zoom link would be refused, or null when it is fine. */
export function zoomLinkProblem(link: string): string | null {
  const v = link.trim();
  if (!v) return "Paste the counsellor's Zoom meeting link.";
  if (v.length > 500) return "That link is too long.";
  if (!v.toLowerCase().startsWith("https://")) return "The link must start with https://";
  if (!ZOOM_RE.test(v)) return "That isn't a Zoom meeting link (it should look like https://us06web.zoom.us/j/…).";
  return null;
}

const DAY = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
/** "2026-11-28" → "Sat, 28 Nov 2026" (the same words as the PI-cleared email). */
export function offlineDateText(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const pt = Object.fromEntries(DAY.formatToParts(new Date(`${date}T00:00:00Z`)).map((x) => [x.type, x.value]));
  return `${pt.weekday}, ${pt.day} ${pt.month} ${pt.year}`;
}
