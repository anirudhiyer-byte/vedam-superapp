/** Suppressions · e-mail and WhatsApp opt-out list, paged. Read-only, admin only (add/remove come in a later slice). */
import { commGet, fromRange } from "../_lib/guard";
import { suppressionsQuery, toRange } from "../_lib/params";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1";

export async function GET(req: Request) {
  return commGet(req, suppressionsQuery, (q) => {
    const r = toRange(q.from, q.to);
    if (!r.ok) return fromRange(r);
    return {
      ok: true,
      fn: "comm_suppressions_list",
      args: {
        p_channel: q.channel, p_reason: q.reason ?? null, p_from: r.from, p_to: r.to, p_search: q.search ?? null,
        p_sort: q.sort ?? "stamp", p_dir: q.dir ?? "desc", p_page: q.page ?? 1, p_size: q.size ?? 10,
      },
    };
  });
}
