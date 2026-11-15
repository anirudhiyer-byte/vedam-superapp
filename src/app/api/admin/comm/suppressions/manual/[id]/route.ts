/**
 * Suppressions (Slice 2) · DELETE = remove ONE entry that was added in the admin panel (admin only).
 * Body: { reason } (10–200 characters, kept in audit_log). Entries from a STOP reply, an unsubscribe link or a
 * bounce are locked: the database refuses them and this answers 409 LOCKED.
 */
import { commWrite } from "../../../_lib/write";
import { removeBody, SUP_LIMITS } from "../../../_lib/suppressions";
import { idParam } from "../../../_lib/params";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return commWrite(req, { action: SUP_LIMITS.action, perUser: SUP_LIMITS.perUser, perIp: SUP_LIMITS.perIp, body: removeBody }, (b) =>
    idParam.safeParse(id).success
      ? { ok: true, fn: "comm_suppression_remove", args: { p_id: id, p_reason: b.reason.trim() } }
      : { ok: false, code: "INVALID" },
  );
}
