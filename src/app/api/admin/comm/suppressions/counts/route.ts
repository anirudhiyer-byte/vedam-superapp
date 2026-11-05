/** Suppressions · count per reason for one channel (tab badges). Read-only, admin only. */
import { commGet, fromRange } from "../../_lib/guard";
import { countsQuery, toRange } from "../../_lib/params";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1";

export async function GET(req: Request) {
  return commGet(req, countsQuery, (q) => {
    const r = toRange(q.from, q.to);
    if (!r.ok) return fromRange(r);
    return { ok: true, fn: "comm_suppressions_counts", args: { p_channel: q.channel, p_from: r.from, p_to: r.to, p_search: q.search ?? null } };
  });
}
