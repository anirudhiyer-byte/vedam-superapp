/**
 * Manage Document Templates (Slice 4) · POST = "Check and preview". Body { name?, html }.
 * Cleans the HTML on the server and lets the database run every check as a dry run (admin only, nothing saved).
 * Answer: the cleaned HTML, what was removed, the merge fields used and the size. Refusals → 400 with a reason code.
 */
import { commWrite } from "../../_lib/write";
import { DOC_BODY_MAX_BYTES, DOC_LIMITS, checkBody, planCheck } from "../../_lib/doc-templates";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1";

export async function POST(req: Request) {
  return commWrite(req, { ...DOC_LIMITS, body: checkBody, maxBytes: DOC_BODY_MAX_BYTES }, planCheck);
}
