/**
 * Suppressions (Slice 2) · POST = add ONE contact to a suppression list (admin only).
 * Body: { channel: "Email" | "WhatsApp", contact, category, note? }. Answer: { id, status: "added" | "already", ... }.
 * Checks in _lib/write.ts (CSRF / Origin, JSON, rate limits, login, strict body); the database function checks admin
 * and cleans the contact the same way the existing opt-out writer does.
 */
import { commWrite } from "../../_lib/write";
import { addBody, SUP_LIMITS } from "../../_lib/suppressions";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1";

export async function POST(req: Request) {
  return commWrite(req, { action: SUP_LIMITS.action, perUser: SUP_LIMITS.perUser, perIp: SUP_LIMITS.perIp, body: addBody }, (b) => ({
    ok: true, fn: "comm_suppression_add",
    args: { p_channel: b.channel, p_contact: b.contact, p_category: b.category, p_note: b.note?.trim() ? b.note.trim() : null },
  }));
}
