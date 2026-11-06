/**
 * WhatsApp Flow drafts (Slice 6) · GET = every live flow (no screens) + the categories in use; POST = create a Draft.
 * Saved as drafts only: nothing is sent and nothing is published to Meta / WhatsApp. The two Recommended flows
 * stay in the app's code and never come here. Admin only; checks in _lib/guard.ts (GET) and _lib/write.ts (POST).
 */
import { commGet } from "../_lib/guard";
import { commWrite } from "../_lib/write";
import { emptyQuery } from "../_lib/params";
import { FLOW_BODY_MAX_BYTES, FLOW_LIMITS, planCreate } from "../_lib/flows";
import { flowCreateBody } from "@/lib/comm/flow-rules";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1";

export async function GET(req: Request) {
  return commGet(req, emptyQuery, () => ({ ok: true, fn: "comm_flow_list", args: {} }));
}

export async function POST(req: Request) {
  return commWrite(req, { ...FLOW_LIMITS, body: flowCreateBody, maxBytes: FLOW_BODY_MAX_BYTES }, planCreate);
}
