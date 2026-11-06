/**
 * WhatsApp Flow drafts (Slice 6) · GET = one live flow with its screens, DELETE = soft delete.
 * Unknown or deleted flow → 404; an id that is not a uuid (e.g. a Recommended "f1") → 400, never sent to the database.
 */
import { commGet } from "../../_lib/guard";
import { commWrite } from "../../_lib/write";
import { emptyQuery, idParam } from "../../_lib/params";
import { FLOW_LIMITS } from "../../_lib/flows";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return commGet(req, emptyQuery, () =>
    idParam.safeParse(id).success ? { ok: true, fn: "comm_flow_get", args: { p_id: id } } : { ok: false, code: "INVALID" },
  );
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return commWrite(req, { ...FLOW_LIMITS, body: null }, () =>
    idParam.safeParse(id).success ? { ok: true, fn: "comm_flow_delete", args: { p_id: id } } : { ok: false, code: "INVALID" },
  );
}
