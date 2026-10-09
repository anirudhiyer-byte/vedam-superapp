import { createClient } from "@supabase/supabase-js";
import { sign, safeEqual } from "@/lib/security/sign";
export const runtime = "nodejs";

// 1x1 transparent GIF
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const id = sp.get("e");
    // when UNSUB_SECRET is set, require a valid signature so opens can't be forged; legacy (no secret) records as before
    const secret = process.env.UNSUB_SECRET;
    const sigOk = !secret || (!!id && !!sp.get("s") && safeEqual(sp.get("s")!, sign(id, secret)));
    if (id && sigOk) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (url && key) { const db = createClient(url, key); await db.rpc("email_event_open", { p_id: id }); }
    }
  } catch { /* never break the pixel */ }
  return new Response(PIXEL, { headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, no-cache, must-revalidate, private", "Content-Length": String(PIXEL.length) } });
}
