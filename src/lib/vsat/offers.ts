/**
 * VSAT offers (Phase 3, migration 0144) · pure rules shared by the Counselling panel, the student drawer
 * and the server job that sends the offer email. No I/O here, so all of it is unit-tested.
 *
 * The database decides everything that matters: releasing = moving the student to "Offer sent"
 * (a trigger fills the offer fields the payment gate reads), the deadline (campus "Days to pay", until
 * 11:59 pm IST), who may release, and the lapse job. These helpers only shape what people see.
 */

import { istDate, istTime } from "./interviews";
import { errorText } from "./pipeline";
import { offerDays } from "./offer-letter";

/** The VSAT comms step that carries the offer email. */
export const OFFER_STEP = "offer_released";
/** 0157: the reminder on the offer's last day (10:00 am IST) and the email when the offer lapses. */
export const OFFER_REMINDER_STEP = "offer_reminder";
export const OFFER_LAPSED_STEP = "offer_lapsed";
/** Which VSAT comms step sends each kind of offer email job (vsat_offer_events.kind). */
export const OFFER_JOB_STEP = { released: OFFER_STEP, reminder: OFFER_REMINDER_STEP, lapsed: OFFER_LAPSED_STEP } as const;
export type OfferJobKind = keyof typeof OFFER_JOB_STEP;
/** The VSAT comms steps sent by the offer job (email only, offer placeholders). */
export const OFFER_STEPS: readonly string[] = Object.values(OFFER_JOB_STEP);
/** Most students one release call takes (same as vsat_offers_release). */
export const RELEASE_MAX = 100;
/** 0180: "Days to pay" typed at release (whole number 1–90; empty = the campus default). Same limits as the database. */
export const OFFER_DAYS_MIN = 1;
export const OFFER_DAYS_MAX = 90;
export const OFFER_DAYS_ERROR = `Days to pay must be a whole number from ${OFFER_DAYS_MIN} to ${OFFER_DAYS_MAX}, or empty for the campus default.`;

/** The "Days to pay" box → the number to send (null = campus default), or not ok. The database checks again. */
export function parseOfferDays(text: string): { ok: true; days: number | null } | { ok: false } {
  const t = text.trim();
  if (t === "") return { ok: true, days: null };
  if (!/^\d{1,3}$/.test(t)) return { ok: false };
  const n = Number(t);
  return n >= OFFER_DAYS_MIN && n <= OFFER_DAYS_MAX ? { ok: true, days: n } : { ok: false };
}

/** The release call's body: offer_days only when typed, so an empty box sends exactly what it sent before 0180. */
export function releaseParams(ids: string[], days: number | null, dryRun: boolean): Record<string, unknown> {
  return { application_ids: ids, ...(dryRun ? { dry_run: true } : {}), ...(days !== null ? { offer_days: days } : {}) };
}

export const CAMPUS_NAME: Record<string, string> = { pune: "Pune", gurugram: "Gurugram" };

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** 40 → "40", 37.5 → "37.5" (never "40.00"). */
export function pctText(v: unknown): string {
  const n = num(v);
  return n === null ? "" : String(Math.round(n * 100) / 100);
}

/** 50000 → "50,000" (Indian grouping). */
export function amountText(v: unknown): string {
  const n = num(v);
  return n === null ? "" : Math.round(n).toLocaleString("en-IN");
}

/** "Fri, 28 Nov 2026, 11:59 pm IST". */
export function deadlineText(iso: string | null | undefined): string {
  if (!iso) return "—";
  return `${istDate(iso)}, ${istTime(iso)} IST`;
}

// ── the release call ─────────────────────────────────────────────────────────

export type Released = { application_id: string; name: string | null; scholarship_pct: number | string | null; expires_at: string | null };
export type Skipped = { application_id: string; name: string | null; code: string };
export type ReleaseResult = { released: Released[]; skipped: Skipped[]; dry_run: boolean };

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** vsat_offers_release(...) → a checked shape (anything odd is dropped, never trusted). */
export function parseRelease(data: unknown): ReleaseResult {
  const o = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") as Record<string, unknown>[] : []);
  return {
    released: list(o.released).filter((x) => typeof x.application_id === "string").map((x) => ({
      application_id: x.application_id as string, name: str(x.name),
      scholarship_pct: typeof x.scholarship_pct === "number" || typeof x.scholarship_pct === "string" ? x.scholarship_pct : null,
      expires_at: str(x.expires_at),
    })),
    skipped: list(o.skipped).filter((x) => typeof x.application_id === "string").map((x) => ({
      application_id: x.application_id as string, name: str(x.name), code: str(x.code) ?? "",
    })),
    dry_run: o.dry_run === true,
  };
}

const who = (x: { name: string | null; application_id: string }) => (x.name ?? "").trim() || x.application_id;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Why a student was left out, in plain words. */
export function skipText(code: string): string {
  if (code === "ALREADY_RELEASED") return "offer already released";
  if (code === "WRONG_STAGE") return "not at Counselled";
  if (code === "NO_SCHOLARSHIP") return "counselling not saved yet";
  return errorText(code).replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase());
}

function skippedList(r: ReleaseResult): string {
  return r.skipped.map((s) => `${who(s)} (${skipText(s.code)})`).join(", ");
}

/** The confirm line shown before releasing (from the dry run). Null when nobody can be released. */
export function previewText(r: ReleaseResult): string | null {
  if (!r.released.length) return null;
  const deadlines = [...new Set(r.released.map((x) => x.expires_at).filter(Boolean))] as string[];
  const by = deadlines.length === 1 ? ` They can pay until ${deadlineText(deadlines[0])}.` : "";
  const out = `Release ${plural(r.released.length, "offer", "offers")}? Each student gets an email with their scholarship and can then pay the enrollment fee from their dashboard.${by}`;
  return r.skipped.length ? `${out} Left out: ${skippedList(r)}.` : out;
}

/** What happened, after releasing. */
export function releaseResultText(r: ReleaseResult): string {
  const parts: string[] = [];
  if (r.released.length) parts.push(`Released ${plural(r.released.length, "offer", "offers")} ✓`);
  if (r.skipped.length) parts.push(`Not released: ${skippedList(r)}`);
  return parts.length ? `${parts.join(". ")}.` : "Nothing to release.";
}

/** Nothing in the selection can be released: say why (from the dry run). */
export function nothingToReleaseText(r: ReleaseResult): string {
  return r.skipped.length ? `Nothing to release: ${skippedList(r)}.` : "Select students at Counselled to release their offers.";
}

// ── the offer as staff see it (drawer) ───────────────────────────────────────

export type OfferInfo = { released_at: string | null; expires_at: string | null; scholarship_pct: number | string | null; category?: number | null };
export type OfferTone = "neutral" | "green" | "orange" | "red";

/** The offer's state for a student at `stage`, at time `now` (ms). */
export function offerState(stage: string, offer: OfferInfo | null | undefined, now = Date.now()): { label: string; tone: OfferTone } {
  if (stage === "enrolled") return { label: "Accepted: enrollment fee paid", tone: "green" };
  if (stage === "offer_cancelled") return { label: "Cancelled", tone: "red" };
  if (stage === "offer_lapsed") return { label: "Lapsed: the deadline passed without payment", tone: "orange" };
  if (!offer?.released_at) return { label: "Not released yet", tone: "neutral" };
  if (stage !== "offer_sent") return { label: "Not active (the student was moved back)", tone: "red" };
  if (offer.expires_at && Date.parse(offer.expires_at) <= now) return { label: "Deadline passed: lapses within 15 minutes", tone: "orange" };
  return { label: `Valid until ${deadlineText(offer.expires_at)}`, tone: "green" };
}

// ── the offer email (server job) ─────────────────────────────────────────────

export type OfferJob = {
  id: string;
  /** released = the offer email (with the letter); reminder = last day, 10 am IST; lapsed = the deadline passed (0157). */
  kind: OfferJobKind;
  attempts: number;
  sent_to?: string[];
  scholarship_pct: number | string | null;
  released_at: string | null;
  expires_at: string | null;
  amount: string | number | null;
  student: { name: string | null; email: string | null; lead_id: string | null; application_no: string | null; campus: string | null };
};

const firstName = (full: string | null | undefined) => (full ?? "").trim().split(/\s+/)[0] || "there";

/** The placeholder values for the offer email (plain text; HTML-escaped when filled into the body). */
export function offerVars(job: OfferJob, site: string): Record<string, string> {
  return {
    name: firstName(job.student.name),
    student_name: (job.student.name ?? "").trim() || "there",
    application_no: job.student.application_no ?? "",
    campus: CAMPUS_NAME[job.student.campus ?? ""] ?? "Vedam",
    scholarship: pctText(job.scholarship_pct),
    amount: amountText(job.amount ?? 50000),
    deadline_date: job.expires_at ? istDate(job.expires_at) : "",
    deadline_time: job.expires_at ? istTime(job.expires_at) : "",
    dashboard_link: `${site}/apply/dashboard`,
  };
}

/** Placeholders the VSAT comms panel lists for the offer step. */
export const OFFER_VARS = ["name", "student_name", "application_no", "campus", "scholarship", "amount", "deadline_date", "deadline_time", "dashboard_link"] as const;

/** The offer email's placeholders: the ones above plus {{offer_days}} (how many days the offer is valid, 0156). */
export function offerEmailVars(job: OfferJob, site: string): Record<string, string> {
  return { ...offerVars(job, site), offer_days: job.released_at && job.expires_at ? String(offerDays(job.released_at, job.expires_at, 0)) : "" };
}
export const OFFER_EMAIL_VARS = [...OFFER_VARS, "offer_days"] as const;
