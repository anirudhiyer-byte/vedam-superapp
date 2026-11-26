/**
 * Sir's last three sheet columns on the Counselling table (0193, alpha test 26 Nov 2026): "Confirmation" (Online
 * Counselling sheet), "Additional Comments" and "Proposed Fee" ("Selected For Counselling" sheets). Admins and admissions
 * edit them in the student drawer. The database is the gate (vsat_counselling_notes_set); this mirrors its checks so
 * the drawer can say what is wrong before saving, and sends only what changed.
 */

export const NOTES_COMMENTS_MAX = 2000;
/** The database's cap when a campus has no programme fee set. */
export const NOTES_FEE_CAP = 100_000_000;

/** What vsat_counselling_notes_get / _set return. */
export type CounsellingNotes = {
  application_id: string;
  editable: boolean;
  additional_comments: string | null;
  proposed_fee: number | null;
  /** Yes / No for the live online slot; null when not set, or set for an earlier slot. */
  confirmation: boolean | null;
  /** The live online booking a Confirmation can be given for (null: offline, cancelled or not booked). */
  online_slot: string | null;
  programme_fee: number | null;
  updated_at: string | null;
};

export type Confirmation = "yes" | "no" | "";
export const CONFIRMATION_CHOICES: { v: Confirmation; label: string }[] = [
  { v: "", label: "Not set" }, { v: "yes", label: "Yes" }, { v: "no", label: "No" },
];
export const confirmationChoice = (c: boolean | null | undefined): Confirmation => (c === true ? "yes" : c === false ? "no" : "");

export const rupees = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
/** 1500000 → "15,00,000" (the input box); null → "". */
export const feeInput = (v: number | null | undefined) => (v == null ? "" : Math.round(v).toLocaleString("en-IN"));

/** "15,00,000", "₹ 15,00,000" or "1500000" → 1500000; empty → null (clears it). Whole rupees, 0 up to the programme fee. */
export function parseProposedFee(text: string, programmeFee: number | null): { ok: true; value: number | null } | { ok: false; error: string } {
  const t = text.replace(/[₹,\s]/g, "");
  if (!t) return { ok: true, value: null };
  if (!/^\d{1,9}$/.test(t)) return { ok: false, error: "Proposed fee: whole rupees only, for example 15,00,000." };
  const v = Number(t);
  const cap = programmeFee ?? NOTES_FEE_CAP;
  if (v > cap) return { ok: false, error: `Proposed fee can't be more than ${rupees(cap)}${programmeFee != null ? " (the programme fee)" : ""}.` };
  return { ok: true, value: v };
}

/** Characters as the database counts them (an emoji is one). */
const chars = (s: string) => [...s].length;

export type NotesDraft = { comments: string; fee: string; confirmation: Confirmation };
export const draftOf = (n: CounsellingNotes): NotesDraft => ({
  comments: n.additional_comments ?? "", fee: feeInput(n.proposed_fee), confirmation: confirmationChoice(n.confirmation),
});

/**
 * The request for vsat_counselling_notes_set: only the fields that changed (the database keeps the others), or null when
 * nothing changed. Empty text / an empty fee / "Not set" clear a field.
 */
export function notesChanges(saved: CounsellingNotes, draft: NotesDraft):
  { ok: true; payload: Record<string, unknown> | null } | { ok: false; error: string } {
  const p: Record<string, unknown> = {};
  const comments = draft.comments.trim();
  if (chars(comments) > NOTES_COMMENTS_MAX) return { ok: false, error: `Additional comments: at most ${NOTES_COMMENTS_MAX.toLocaleString("en-IN")} characters.` };
  if ((comments || null) !== (saved.additional_comments ?? null)) p.additional_comments = comments || null;
  const fee = parseProposedFee(draft.fee, saved.programme_fee);
  if (!fee.ok) return fee;
  if (fee.value !== (saved.proposed_fee ?? null)) p.proposed_fee = fee.value;
  const conf = draft.confirmation === "yes" ? true : draft.confirmation === "no" ? false : null;
  if (conf !== (saved.confirmation ?? null)) {
    if (conf !== null && !saved.online_slot) return { ok: false, error: "Confirmation is only for a booked online session." };
    p.confirmation = conf;
  }
  return { ok: true, payload: Object.keys(p).length ? { application_id: saved.application_id, ...p } : null };
}
