/**
 * Manage Document Templates (Slice 4) · GET = live templates (paged, no HTML), POST = create one.
 * POST body { name, html }: the HTML is cleaned on the server (safe subset, _lib/doc-sanitize.ts) before the
 * database sees it; the database checks it again. Admin only; checks in _lib/guard.ts (GET) and _lib/write.ts (POST).
 */
import { commGet } from "../_lib/guard";
import { commWrite } from "../_lib/write";
import { listsQuery } from "../_lib/lists";
import { DOC_BODY_MAX_BYTES, DOC_LIMITS, createBody, planCreate } from "../_lib/doc-templates";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1";

export async function GET(req: Request) {
  return commGet(req, listsQuery, (q) => ({
    ok: true, fn: "comm_doc_template_list", args: { p_search: q.search ?? null, p_page: q.page ?? 1, p_size: q.size ?? 10 },
  }));
}

export async function POST(req: Request) {
  return commWrite(req, { ...DOC_LIMITS, body: createBody, maxBytes: DOC_BODY_MAX_BYTES }, planCreate);
}
