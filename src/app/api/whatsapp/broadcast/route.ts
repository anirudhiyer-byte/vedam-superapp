import { requireAdmin } from "@/lib/whatsapp/guard";
import { waSendSingle, type WaSample } from "@/lib/whatsapp/client";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Recipient = { to: string; sample?: WaSample };

export async function POST(req: Request) {
  const { user, supabase } = await requireAdmin();
  if (!user) return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  const { templateId, messageType, sender, recipients } = await req.json() as {
    templateId: string; messageType?: string; sender?: string; recipients: Recipient[];
  };
  if (!templateId || !Array.isArray(recipients) || recipients.length === 0)
    return Response.json({ ok: false, error: "templateId + recipients required" }, { status: 400 });
  if (recipients.length > 50) return Response.json({ ok: false, error: "max 50 per batch" }, { status: 400 });

  let sent = 0, failed = 0;
  const rows: Record<string, unknown>[] = [];
  for (const r of recipients) {
    const result = await waSendSingle({ to: r.to, templateId, messageType, sender, sample: r.sample });
    const d = result.data as { results?: { transaction_id?: string; cost?: number }[] } | undefined;
    const first = d?.results?.[0];
    if (result.ok) sent++; else failed++;
    rows.push({
      to_number: r.to, template_id: templateId, message_type: messageType || "text",
      status: result.ok ? "sent" : "failed", http_status: result.status, provider_response: result.data as object,
      transaction_id: first?.transaction_id ?? null, cost: first?.cost ?? null, sent_by: user.id,
    });
  }
  if (rows.length) await supabase.from("whatsapp_sends").insert(rows);
  return Response.json({ ok: true, sent, failed });
}
