/** Communication Logs · one job (header + counts + e-mail subject). Read-only, admin only. 404 when the id is unknown. */
import { commGet } from "../../_lib/guard";
import { emptyQuery, idParam } from "../../_lib/params";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return commGet(
    req,
    emptyQuery,
    () => (idParam.safeParse(id).success ? { ok: true, fn: "comm_log_get", args: { p_id: id } } : { ok: false, code: "INVALID" }),
    { notFound: (d) => !d || (d as { job?: unknown }).job == null },
  );
}
