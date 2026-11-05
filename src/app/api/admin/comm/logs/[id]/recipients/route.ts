/** Communication Logs · the people one job was sent to (Detailed Report), paged. Read-only, admin only. */
import { commGet, fromRange } from "../../../_lib/guard";
import { idParam, recipientsQuery, toRange } from "../../../_lib/params";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return commGet(req, recipientsQuery, (q) => {
    if (!idParam.safeParse(id).success) return { ok: false, code: "INVALID" };
    const r = toRange(q.from, q.to);
    if (!r.ok) return fromRange(r);
    return {
      ok: true,
      fn: "comm_log_recipients",
      args: {
        p_id: id, p_status: q.status ?? null, p_from: r.from, p_to: r.to, p_search: q.search ?? null,
        p_sort: q.sort ?? "date", p_dir: q.dir ?? "desc", p_page: q.page ?? 1, p_size: q.size ?? 10,
      },
    };
  });
}
