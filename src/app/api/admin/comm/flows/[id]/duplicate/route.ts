/** WhatsApp Flow drafts (Slice 6) · POST = copy a live flow as a Draft ("Copy of …"). Unknown / deleted → 404. */
import { commWrite } from "../../../_lib/write";
import { idParam } from "../../../_lib/params";
import { FLOW_LIMITS } from "../../../_lib/flows";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return commWrite(req, { ...FLOW_LIMITS, body: null }, () =>
    idParam.safeParse(id).success ? { ok: true, fn: "comm_flow_duplicate", args: { p_id: id } } : { ok: false, code: "INVALID" },
  );
}
