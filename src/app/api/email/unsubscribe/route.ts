import { createClient } from "@supabase/supabase-js";
import { sign, safeEqual } from "@/lib/security/sign";
export const runtime = "nodejs";

const page = (title: string, msg: string) =>
  new Response(`<html><body style="font-family:system-ui;background:#0b0318;color:#fff;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2>${title}</h2><p style="color:#9a95b4">${msg}</p></div></body></html>`,
    { headers: { "Content-Type": "text/html" } });

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const email = sp.get("e");
  const token = sp.get("t");
  const secret = process.env.UNSUB_SECRET;
  try {
    if (email) {
      // once UNSUB_SECRET is set, require a valid signed token so nobody can
      // unsubscribe an arbitrary address by guessing the URL.
      if (secret && (!token || !safeEqual(token, sign(email, secret)))) {
        return page("Link expired", "This unsubscribe link isn't valid. Please use the link from a recent email, or reply STOP.");
      }
      const d = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      await d.rpc("comms_opt_out", { p_email: email, p_phone: null, p_channel: "email", p_reason: "unsubscribe link" });
    }
  } catch { /* */ }
  return page("You're unsubscribed", "You won't receive marketing emails from Vedam One anymore.");
}
