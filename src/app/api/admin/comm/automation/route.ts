/**
 * Manage Automation (Slice 8) · every automation of the two existing engines (WhatsApp automations and
 * journeys) in ONE answer: rows, tiles and filter options are worked out in the browser (both tables are small;
 * the database caps each engine at 500 rows). Read-only, admin only. No query parameters are accepted.
 */
import { commGet } from "../_lib/guard";
import { emptyQuery } from "../_lib/params";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1";

export async function GET(req: Request) {
  return commGet(req, emptyQuery, () => ({ ok: true, fn: "comm_automation_list", args: {} }));
}
