/** Communication Logs · why part of a job failed (max 100 lines, no contact details). Read-only, admin only. */
import { commGet } from "../../../_lib/guard";
import { emptyQuery, idParam } from "../../../_lib/params";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return commGet(req, emptyQuery, () =>
    idParam.safeParse(id).success ? { ok: true, fn: "comm_log_failures", args: { p_id: id } } : { ok: false, code: "INVALID" },
  );
}
