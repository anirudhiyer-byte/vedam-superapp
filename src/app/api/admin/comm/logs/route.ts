/** Communication Logs · list of jobs (read-only, admin only). See _lib/guard.ts for the checks. */
import { commGet, fromRange } from "../_lib/guard";
import { logsQuery, toRange } from "../_lib/params";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1"; // same region as the Supabase database

export async function GET(req: Request) {
  return commGet(req, logsQuery, (q) => {
    const r = toRange(q.from, q.to, { defaultDays: 90 });
    if (!r.ok) return fromRange(r);
    return {
      ok: true,
      fn: "comm_logs_list",
      args: {
        p_from: r.from, p_to: r.to, p_channel: q.channel ?? null, p_status: q.status ?? null, p_template: q.template ?? null,
        p_nature: q.nature ?? null, p_campaign: q.campaign ?? null, p_search: q.search ?? null,
        p_sort: q.sort ?? "startDate", p_dir: q.dir ?? "desc", p_page: q.page ?? 1, p_size: q.size ?? 10,
      },
    };
  });
}
