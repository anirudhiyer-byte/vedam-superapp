/**
 * Static list from a CSV (Slice 3b) · request schema + limits for POST /api/admin/comm/lists/import.
 * The browser parses the CSV and sends ONLY the phone ("p") and e-mail ("e") cells of each row; every other
 * column is dropped in the browser. The database function checks everything again and does the matching.
 */
import { z } from "zod";

export const IMPORT_MAX_ROWS = 5000;
/** 5000 rows of phone + e-mail fit easily (≈60 bytes a row); anything bigger is refused before parsing */
export const IMPORT_MAX_BYTES = 600 * 1024;
/** tight on purpose: a preview + a save per upload */
export const IMPORT_LIMITS = { action: "comm_import", perUser: 6, perIp: 20 } as const;

const CTRL = /[\u0000-\u001f\u007f]/;

const row = z.object({ p: z.string().max(64).optional(), e: z.string().max(254).optional() }).strict();

export const importBody = z
  .object({
    dryRun: z.boolean(),
    name: z.string().max(80).optional(),
    rows: z.array(row).min(1).max(IMPORT_MAX_ROWS),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.dryRun) return;
    const n = b.name?.trim() ?? "";
    if (n.length < 1 || n.length > 80 || CTRL.test(b.name ?? "")) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["name"] });
  });

export type ImportBody = z.infer<typeof importBody>;
