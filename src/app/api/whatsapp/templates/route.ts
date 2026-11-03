import { requireAdmin } from "@/lib/whatsapp/guard";
import { waListTemplates, senderInfoForWaba } from "@/lib/whatsapp/client";
export const dynamic = "force-dynamic";
export async function GET() {
  const { user } = await requireAdmin();
  if (!user) return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  const result = await waListTemplates();
  // Annotate each template with the sender number (+ label) its WABA will send from,
  // so the UI can show it and the client can send from the matching number.
  const d = result.data as { templates?: Array<Record<string, unknown>> } | undefined;
  if (d?.templates) {
    for (const t of d.templates) {
      const si = senderInfoForWaba(t.waba_id as string | undefined);
      t.sender = si.number || null;
      t.sender_label = si.label || null;
    }
  }
  return Response.json(result);
}
