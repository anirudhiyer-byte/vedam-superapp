import { requireAdmin } from "@/lib/whatsapp/guard";
import { waSendSingle } from "@/lib/whatsapp/client";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const { user, supabase } = await requireAdmin();
  if (!user) return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  const { to, templateId, messageType, sender } = await req.json();
  if (!to || !templateId) return Response.json({ ok: false, error: "to + templateId required" }, { status: 400 });
  const result = await waSendSingle({ to, templateId, messageType, sender });
  await supabase.from("whatsapp_sends").insert({
    to_number: to, template_id: templateId, message_type: messageType || "text",
    status: result.ok ? "sent" : "failed", http_status: result.status, provider_response: result.data as object, sent_by: user.id,
  });
  return Response.json(result);
}
