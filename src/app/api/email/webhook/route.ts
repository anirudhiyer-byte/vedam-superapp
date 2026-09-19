import { createClient } from "@supabase/supabase-js";
export const runtime = "nodejs";
const db = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

/** SMTP2GO event webhook — delivered / bounced / opened / clicked → email_events. */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const events = Array.isArray(body) ? body : Array.isArray(body?.events) ? body.events : [body];
    const d = db();
    for (const ev of events) {
      const to = ev.rcpt || ev.email || ev.recipient || ev.to;
      const mid = ev.email_id || ev.emailId || ev["email-id"] || ev.message_id;
      const type = String(ev.event || ev.type || "").toLowerCase();
      const delivered = type.includes("deliver");
      const bounced = type.includes("bounce") || type.includes("reject") || type.includes("fail") || type.includes("spam");
      const opened = type.includes("open");
      const clicked = type.includes("click");
      if (mid) {
        // exact per-send match on the SMTP2GO email_id we stored
        if (delivered) await d.rpc("email_delivery_update", { p_msgid: mid, p_status: "delivered", p_reason: null });
        else if (bounced) await d.rpc("email_delivery_update", { p_msgid: mid, p_status: "bounced", p_reason: ev.reason || type });
        else if (opened) await d.rpc("email_open_by_msgid", { p_msgid: mid });
        else if (clicked) await d.rpc("email_click_by_msgid", { p_msgid: mid, p_url: ev.url || null });
      } else if (to) {
        // fallback: most-recent row for the address
        if (delivered) await d.rpc("email_delivery_by_addr", { p_to: to, p_status: "delivered", p_reason: null });
        else if (bounced) await d.rpc("email_delivery_by_addr", { p_to: to, p_status: "bounced", p_reason: ev.reason || type });
        else if (opened) await d.rpc("email_open_by_addr", { p_to: to });
        else if (clicked) await d.rpc("email_click_by_addr", { p_to: to, p_url: ev.url || null });
      }
    }
    return Response.json({ ok: true });
  } catch { return Response.json({ ok: true }); }
}
export async function GET() { return Response.json({ ok: true }); }
