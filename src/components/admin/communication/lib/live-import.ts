/**
 * Static list from a CSV (Slice 3b) · client for POST /api/admin/comm/lists/import.
 * Sends only the phone / e-mail cells (see csv-identifiers.ts). Answers are counts + masked samples only.
 */
import { apiSend } from "./live-api";
import { STATIC_LIST_IMPORT } from "./live-config";
import type { IdRow } from "./csv-identifiers";

const NOT_AVAILABLE = "CSV import is not available.";
const assertAvailable = () => { if (!STATIC_LIST_IMPORT) throw new Error(NOT_AVAILABLE); };

/** which Upload page the shell shows: the CSV → static list flow (flag on) or the old sample wizard (flag off) */
export const uploadView = (): "static-import" | "old-wizard" => (STATIC_LIST_IMPORT ? "static-import" : "old-wizard");

export type ImportResult = {
  id: string | null; name: string | null; rows: number; invalid: number; duplicate: number; matched: number; unmatched: number;
  members: number; withPhone: number; withEmail: number; consented: number;
  sample: { phone: string | null; email: string | null; consent: boolean }[];
};
type Raw = Omit<ImportResult, "withPhone" | "withEmail"> & { with_phone: number; with_email: number };

export const IMPORT_MESSAGES: Record<string, string> = {
  INVALID: "The file or the list name is not valid, or nobody in the file matched a VSAT user.",
  FORBIDDEN: "Only admins can create lists.",
};

const toResult = (r: Raw): ImportResult => ({
  id: r.id ?? null, name: r.name ?? null, rows: r.rows, invalid: r.invalid, duplicate: r.duplicate, matched: r.matched, unmatched: r.unmatched,
  members: r.members, withPhone: r.with_phone, withEmail: r.with_email, consented: r.consented, sample: r.sample ?? [],
});

export const importApi = {
  /** match the rows against VSAT users; nothing is saved */
  preview: async (rows: IdRow[]): Promise<ImportResult> => {
    assertAvailable();
    return toResult(await apiSend<Raw>("POST", "lists/import", { dryRun: true, rows }, IMPORT_MESSAGES));
  },
  /** save a static list with the matched users (user ids only) */
  create: async (name: string, rows: IdRow[]): Promise<ImportResult> => {
    assertAvailable();
    return toResult(await apiSend<Raw>("POST", "lists/import", { dryRun: false, name: name.trim(), rows }, IMPORT_MESSAGES));
  },
};
