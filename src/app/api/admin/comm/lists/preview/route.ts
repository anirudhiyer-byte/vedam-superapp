/**
 * Manage List (Slice 3a) · POST = audience preview for whitelisted conditions:
 * total, with phone, with e-mail, consented, and 10 MASKED rows (no ids, no names). Read-only.
 * POST because the conditions are a JSON object; it still gets the Origin check and its own rate limit.
 */
import { commWrite } from "../../_lib/write";
import { previewBody } from "../../_lib/lists";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1";

export async function POST(req: Request) {
  return commWrite(req, { action: "comm_preview", perUser: 30, perIp: 120, body: previewBody }, (b) => ({
    ok: true, fn: "comm_audience_preview", args: { p_conditions: b.conditions },
  }));
}
