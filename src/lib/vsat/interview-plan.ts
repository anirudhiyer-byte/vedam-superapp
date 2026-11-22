/**
 * Booking interviews from the Interview panel rows (migration 0143). Pure helpers, no I/O:
 * what a row shows, what to save when a cell changes, which selected rows can be sent, and the messages.
 * The database decides every state (vsat_interview_plan); these only read what it returned.
 */
import { errorText, istSlot } from "./pipeline";
import { istParts } from "./interviews";

/** Most rows one Send or one "Fill times" may take (vsat_interview_drafts_send / _fill). */
export const SEND_MAX = 40;

export type PlanState = "empty" | "incomplete" | "ready" | "booked" | "changed" | "problem" | "locked";
export const PLAN_STATES: readonly PlanState[] = ["empty", "incomplete", "ready", "booked", "changed", "problem", "locked"];

export type PlanRow = {
  application_id: string;
  attempt_no: number;
  state: PlanState;
  problem: string | null;
  clash_with: { application_id: string | null; name: string | null } | null;
  booked: { interviewer_id: string; slot: string; duration_min: number; meet_mode: string } | null;
  draft: { interviewer_id: string | null; slot: string | null; updated_at?: string } | null;
};

/** What the three cells of a row show: interviewer id, date (YYYY-MM-DD, IST) and time (HH:MM, IST). */
export type CellValues = { interviewer_id: string; date: string; time: string };
export const EMPTY_CELLS: CellValues = { interviewer_id: "", date: "", time: "" };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** One plan entry as the database returned it; anything malformed → null (the row then shows nothing to edit). */
export function toPlanRow(v: unknown): PlanRow | null {
  if (!isObj(v) || typeof v.application_id !== "string" || !PLAN_STATES.includes(v.state as PlanState)) return null;
  const b = isObj(v.booked) && typeof v.booked.interviewer_id === "string" && typeof v.booked.slot === "string"
    ? { interviewer_id: v.booked.interviewer_id, slot: v.booked.slot, duration_min: Number(v.booked.duration_min) || 30, meet_mode: String(v.booked.meet_mode ?? "") }
    : null;
  const d = isObj(v.draft) ? { interviewer_id: str(v.draft.interviewer_id), slot: str(v.draft.slot), updated_at: str(v.draft.updated_at) ?? undefined } : null;
  const c = isObj(v.clash_with) ? { application_id: str(v.clash_with.application_id), name: str(v.clash_with.name) } : null;
  return {
    application_id: v.application_id, attempt_no: Number(v.attempt_no) || 1, state: v.state as PlanState,
    problem: str(v.problem), clash_with: c, booked: b, draft: d,
  };
}

/** The plan for a page of rows, by application id. */
export function parsePlan(v: unknown): Map<string, PlanRow> {
  const m = new Map<string, PlanRow>();
  if (!Array.isArray(v)) return m;
  for (const x of v) { const r = toPlanRow(x); if (r) m.set(r.application_id, r); }
  return m;
}

/** The cells show what was typed (not sent yet), else the booking, else nothing. */
export function cellValues(row: PlanRow | null | undefined): CellValues {
  if (row?.draft) return { interviewer_id: row.draft.interviewer_id ?? "", ...istParts(row.draft.slot) };
  if (row?.booked) return { interviewer_id: row.booked.interviewer_id, ...istParts(row.booked.slot) };
  return { ...EMPTY_CELLS };
}

/**
 * What to save after a cell changed. A time needs both a date and a time: with only one of them the row
 * waits ("partial", kept on screen only). Empty interviewer / time are sent as null (clears that part).
 */
export function draftPayload(applicationId: string, v: CellValues):
  { application_id: string; interviewer_id: string | null; slot_datetime: string | null } | "partial" {
  const slot = v.date && v.time ? istSlot(v.date, v.time) : null;
  if ((v.date || v.time) && !slot) return "partial";
  return { application_id: applicationId, interviewer_id: v.interviewer_id || null, slot_datetime: slot };
}

export const sameCells = (a: CellValues, b: CellValues) => a.interviewer_id === b.interviewer_id && a.date === b.date && a.time === b.time;

/** A row that Send would book: new with all three filled, or a booked one with a new time / interviewer. */
export const isSendable = (r: PlanRow | null | undefined) => r?.state === "ready" || r?.state === "changed";
/** Locked rows (interview done, not at an interview stage) show their values but can't be edited. */
export const isEditable = (r: PlanRow | null | undefined) => !!r && r.state !== "locked";

export type SelectionSummary = { invites: string[]; updates: string[]; problems: number; incomplete: number };

/** Of the selected rows (in row order): new invites, time changes, and how many can't go yet. */
export function selectionSummary(ids: string[], plan: Map<string, PlanRow>): SelectionSummary {
  const out: SelectionSummary = { invites: [], updates: [], problems: 0, incomplete: 0 };
  for (const id of ids) {
    const r = plan.get(id);
    if (r?.state === "ready") out.invites.push(id);
    else if (r?.state === "changed") out.updates.push(id);
    else if (r?.state === "problem") out.problems++;
    else if (r?.state === "incomplete") out.incomplete++;
  }
  return out;
}

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/** "Send 2 invites + 1 update" */
export function sendLabel(s: SelectionSummary): string {
  const parts = [s.invites.length ? n(s.invites.length, "invite") : "", s.updates.length ? n(s.updates.length, "update") : ""].filter(Boolean);
  return parts.length ? `Send ${parts.join(" + ")}` : "Send invites";
}

/** The rows the selection can't send yet, in words ("1 has a problem · 2 need all three filled"). */
export function blockedText(s: SelectionSummary): string {
  return [s.problems ? `${s.problems} ${s.problems === 1 ? "has a problem" : "have a problem"}` : "",
          s.incomplete ? `${s.incomplete} ${s.incomplete === 1 ? "needs" : "need"} interviewer, date and time` : ""].filter(Boolean).join(" · ");
}

export type Tone = "neutral" | "violet" | "green" | "red" | "orange";

/** The status cell of a row. */
export function statusOf(r: PlanRow | null | undefined): { label: string; tone: Tone; title?: string } {
  if (!r) return { label: "—", tone: "neutral" };
  switch (r.state) {
    case "ready": return { label: "Not sent", tone: "violet" };
    case "changed": return { label: "Change not sent", tone: "violet" };
    case "booked": return { label: "Booked", tone: "green" };
    case "incomplete": return { label: "Fill all three", tone: "orange", title: "Pick the interviewer, the date and the time." };
    case "problem":
      if (r.problem === "CLASH") {
        const who = r.clash_with?.name ? r.clash_with.name : "another student";
        return { label: `Clashes with ${who}`, tone: "red", title: "Same interviewer at an overlapping time. Change one of them." };
      }
      return { label: errorText(r.problem), tone: "red" };
    default: return { label: "—", tone: "neutral" };
  }
}

type Named = { application_id: string; name: string | null };
export type SendResult = { sent: (Named & { kind: string | null; slot: string })[]; skipped: (Named & { code: string })[] };
export type FillResult = { filled: (Named & { slot: string })[]; skipped: (Named & { code: string })[] };

const list = (rows: (Named & { code: string })[]) =>
  `${rows.slice(0, 4).map((s) => `${s.name ?? s.application_id} (${errorText(s.code)})`).join("; ")}${rows.length > 4 ? ` and ${rows.length - 4} more` : ""}`;

/** After Send: "Sent 3 ✓ (2 invites, 1 update)" + what wasn't sent and why. */
export function sendResultText(r: SendResult): string {
  const inv = r.sent.filter((s) => s.kind === "scheduled").length;
  const upd = r.sent.filter((s) => s.kind === "rescheduled").length;
  const head = r.sent.length
    ? `Sent ${r.sent.length} ✓${inv && upd ? ` (${n(inv, "invite")}, ${n(upd, "update")})` : ""}`
    : "Nothing was sent";
  return r.skipped.length ? `${head}. Not sent: ${list(r.skipped)}.` : head;
}

/** After "Fill times": "Filled 5 rows. Check them, then Send." + skipped ones. */
export function fillResultText(r: FillResult): string {
  const head = r.filled.length ? `Filled ${n(r.filled.length, "row")}. Check the times, then press Send` : "No row was filled";
  return r.skipped.length ? `${head}. Skipped: ${list(r.skipped)}.` : `${head}.`;
}
