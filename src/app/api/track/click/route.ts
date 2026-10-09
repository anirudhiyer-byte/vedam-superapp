import { createClient } from "@supabase/supabase-js";
import { sign, safeEqual } from "@/lib/security/sign";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const id = sp.get("e"); const target = sp.get("u");
  let dest = "https://one.vedam.org";
  try { if (target) dest = decodeURIComponent(target); } catch { /* keep default */ }
  // only allow http(s) targets (no javascript: etc.)
  if (!/^https?:\/\//i.test(dest)) dest = "https://one.vedam.org";
  // when UNSUB_SECRET is set, require a valid signature so clicks can't be forged; always redirect regardless
  const secret = process.env.UNSUB_SECRET;
  const sigOk = !secret || (!!id && !!sp.get("s") && safeEqual(sp.get("s")!, sign(id, secret)));
  try {
    if (id && sigOk) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (url && key) { const db = createClient(url, key); await db.rpc("email_event_click", { p_id: id, p_url: dest }); }
    }
  } catch { /* never break the redirect */ }
  return Response.redirect(dest, 302);
}
