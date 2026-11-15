/**
 * Static list from a CSV (Slice 3b) · POST = preview (dryRun: true, nothing saved) or save (dryRun: false).
 * Body: { dryRun, name?, rows: [{ p?, e? }] } — phone / e-mail cells only, at most 5000 rows, at most 600 KB.
 * Answer: counts + 10 masked sample rows. Only matched user ids are saved; nothing else is stored or logged.
 * Checks in _lib/write.ts (CSRF / Origin, JSON, rate limits, login, size, strict body); the database checks admin.
 */
import { commWrite } from "../../_lib/write";
import { IMPORT_LIMITS, IMPORT_MAX_BYTES, importBody } from "../../_lib/import";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1";

export async function POST(req: Request) {
  return commWrite(
    req,
    { action: IMPORT_LIMITS.action, perUser: IMPORT_LIMITS.perUser, perIp: IMPORT_LIMITS.perIp, body: importBody, maxBytes: IMPORT_MAX_BYTES },
    (b) => ({
      ok: true, fn: "comm_list_import",
      args: { p_name: b.dryRun ? null : (b.name ?? "").trim(), p_identifiers: b.rows, p_dry_run: b.dryRun },
    }),
  );
}
