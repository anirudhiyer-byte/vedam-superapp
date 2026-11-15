/** Manage List (Slice 3a) · PATCH = rename / change conditions, DELETE = soft delete. Admin only (owner-or-admin in the DB). */
import { commWrite } from "../../_lib/write";
import { updateBody } from "../../_lib/lists";
import { idParam } from "../../_lib/params";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return commWrite(req, { action: "comm_write", perUser: 20, perIp: 60, body: updateBody }, (b) =>
    idParam.safeParse(id).success
      ? { ok: true, fn: "comm_list_update", args: { p_id: id, p_name: b.name ?? null, p_conditions: b.conditions ?? null } }
      : { ok: false, code: "INVALID" },
  );
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return commWrite(req, { action: "comm_write", perUser: 20, perIp: 60, body: null }, () =>
    idParam.safeParse(id).success ? { ok: true, fn: "comm_list_delete", args: { p_id: id } } : { ok: false, code: "INVALID" },
  );
}
