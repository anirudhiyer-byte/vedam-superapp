import { createClient } from "@supabase/supabase-js";
export const runtime = "nodejs";
export async function GET(req: Request) {
  const email = new URL(req.url).searchParams.get("e");
  try {
    if (email) { const d = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      await d.rpc("comms_opt_out", { p_email: decodeURIComponent(email), p_phone: null, p_channel: "email", p_reason: "unsubscribe link" }); }
  } catch { /* */ }
  return new Response(`<html><body style="font-family:system-ui;background:#0b0318;color:#fff;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2>You're unsubscribed</h2><p style="color:#9a95b4">You won't receive marketing emails from Vedam One anymore.</p></div></body></html>`,
    { headers: { "Content-Type": "text/html" } });
}
