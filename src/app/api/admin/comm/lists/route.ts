/**
 * Manage List (Slice 3a) · GET = saved lists (paged), POST = create a list (name + whitelisted conditions).
 * Admin only; checks in _lib/guard.ts (GET) and _lib/write.ts (POST). No contact data is stored.
 */
import { commGet } from "../_lib/guard";
import { commWrite } from "../_lib/write";
import { createBody, listsQuery } from "../_lib/lists";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1";

export async function GET(req: Request) {
  return commGet(req, listsQuery, (q) => ({
    ok: true, fn: "comm_lists_list", args: { p_search: q.search ?? null, p_page: q.page ?? 1, p_size: q.size ?? 10 },
  }));
}

export async function POST(req: Request) {
  return commWrite(req, { action: "comm_write", perUser: 20, perIp: 60, body: createBody }, (b) => ({
    ok: true, fn: "comm_list_create", args: { p_name: b.name, p_conditions: b.conditions },
  }));
}
