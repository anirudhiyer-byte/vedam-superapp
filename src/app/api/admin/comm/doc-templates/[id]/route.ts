/**
 * Manage Document Templates (Slice 4) · GET = one template with its HTML, PATCH = rename and/or new HTML
 * (cleaned on the server again), DELETE = soft delete. Admin only (owner-or-admin in the database).
 * Unknown or deleted template → 404.
 */
import { commGet } from "../../_lib/guard";
import { commWrite } from "../../_lib/write";
import { emptyQuery, idParam } from "../../_lib/params";
import { DOC_BODY_MAX_BYTES, DOC_LIMITS, planUpdate, updateBody } from "../../_lib/doc-templates";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return commGet(req, emptyQuery, () =>
    idParam.safeParse(id).success ? { ok: true, fn: "comm_doc_template_get", args: { p_id: id } } : { ok: false, code: "INVALID" },
  );
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return commWrite(req, { ...DOC_LIMITS, body: updateBody, maxBytes: DOC_BODY_MAX_BYTES }, (b) =>
    idParam.safeParse(id).success ? planUpdate(id, b) : { ok: false, code: "INVALID" },
  );
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return commWrite(req, { ...DOC_LIMITS, body: null }, () =>
    idParam.safeParse(id).success ? { ok: true, fn: "comm_doc_template_delete", args: { p_id: id } } : { ok: false, code: "INVALID" },
  );
}
