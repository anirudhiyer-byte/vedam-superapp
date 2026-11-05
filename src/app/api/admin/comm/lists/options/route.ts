/** Manage List (Slice 3a) · values for the filter dropdowns (stages, sources, UTM, campus, state, city, grad year). Admin only. */
import { commGet } from "../../_lib/guard";
import { emptyQuery } from "../../_lib/params";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1";

export async function GET(req: Request) {
  return commGet(req, emptyQuery, () => ({ ok: true, fn: "comm_list_options", args: {} }));
}
