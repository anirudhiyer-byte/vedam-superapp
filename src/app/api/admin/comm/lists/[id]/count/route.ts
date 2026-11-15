/**
 * Manage List (Slice 3b) · GET = live counts + 10 masked rows for one saved list (static: its members,
 * dynamic: its filters). Read-only, admin only. Unknown or deleted list → 404.
 */
import { commGet } from "../../../_lib/guard";
import { emptyQuery, idParam } from "../../../_lib/params";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return commGet(req, emptyQuery, () =>
    idParam.safeParse(id).success ? { ok: true, fn: "comm_list_count", args: { p_id: id } } : { ok: false, code: "INVALID" },
  );
}
