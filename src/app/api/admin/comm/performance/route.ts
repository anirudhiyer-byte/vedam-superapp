/** Communication Performance · totals, by channel, by day (finished jobs only). Read-only, admin only. */
import { commGet, fromRange } from "../_lib/guard";
import { performanceQuery, toRange } from "../_lib/params";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1";

export async function GET(req: Request) {
  return commGet(req, performanceQuery, (q) => {
    const r = toRange(q.from, q.to, { defaultDays: 90 });
    if (!r.ok) return fromRange(r);
    return { ok: true, fn: "comm_performance", args: { p_from: r.from, p_to: r.to, p_channel: q.channel ?? null, p_template: q.template ?? null } };
  });
}
