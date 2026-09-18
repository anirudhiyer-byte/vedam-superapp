import { createClient } from "@supabase/supabase-js";
export const runtime = "nodejs";
const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

/** TrustSignal WhatsApp delivery + inbound (STOP) webhook. */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const txn = body.transaction_id || body.message_id || body.msg_id;
    const status = (body.status || body.event || "").toLowerCase();
    const from = body.from || body.mobile || body.sender;
    const text = (body.text || body.body || "").toString().trim().toLowerCase();
    const d = db();
    if (txn && status) await d.rpc("wa_delivery_update", { p_txn: String(txn), p_status: status, p_reason: body.reason || null });
    // inbound STOP -> opt out of whatsapp
    if (from && ["stop", "unsubscribe", "opt out", "optout"].includes(text)) {
      await d.rpc("comms_opt_out", { p_email: null, p_phone: String(from), p_channel: "whatsapp", p_reason: "STOP reply" });
    }
    return Response.json({ ok: true });
  } catch { return Response.json({ ok: true }); }   // always 200 so provider doesn't retry-storm
}
export async function GET() { return Response.json({ ok: true }); }
