/** Communication Logs + Performance · filter options (templates used in the range). Read-only, admin only. */
import { commGet, fromRange } from "../../_lib/guard";
import { rangeQuery, toRange } from "../../_lib/params";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1";

export async function GET(req: Request) {
  return commGet(req, rangeQuery, (q) => {
    const r = toRange(q.from, q.to, { defaultDays: 90 });
    if (!r.ok) return fromRange(r);
    return { ok: true, fn: "comm_logs_options", args: { p_from: r.from, p_to: r.to } };
  });
}
