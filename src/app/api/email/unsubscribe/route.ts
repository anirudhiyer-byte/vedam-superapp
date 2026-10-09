import { createClient } from "@supabase/supabase-js";
import { sign, safeEqual } from "@/lib/security/sign";
export const runtime = "nodejs";

const shell = (inner: string) =>
  new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="font-family:system-ui,Arial,sans-serif;background:#0b0318;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0"><div style="text-align:center;max-width:440px;padding:28px 24px">${inner}</div></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } });

const note = (title: string, body: string) =>
  shell(`<h2 style="margin:0 0 10px;font-size:22px">${title}</h2><p style="color:#9a95b4;margin:0;line-height:1.5">${body}</p>`);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

async function optOut(email: string) {
  const d = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  await d.rpc("comms_opt_out", { p_email: email, p_phone: null, p_channel: "email", p_reason: "unsubscribe link" });
}

/**
 * GET never changes state. Mail-scanners, link-prefetchers and antivirus bots
 * follow links with GET — so if GET unsubscribed, they'd silently opt real
 * recipients out. Instead GET shows a confirm page; the opt-out runs on the
 * POST from the button (a human) or a mail client's RFC-8058 one-click POST.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const email = sp.get("e") || "";
  const token = sp.get("t") || "";
  if (!email) return note("Unsubscribe", "No address specified.");
  const e = esc(email), t = esc(token);
  return shell(`
    <h2 style="margin:0 0 12px;font-size:22px">Unsubscribe from Vedam emails?</h2>
    <p style="color:#9a95b4;margin:0 0 22px;line-height:1.5"><b style="color:#fff">${e}</b> will stop receiving marketing &amp; update emails from Vedam One. Account emails (OTPs, your certificates and registrations) still come through.</p>
    <form method="POST" action="/api/email/unsubscribe">
      <input type="hidden" name="e" value="${e}" />
      <input type="hidden" name="t" value="${t}" />
      <button type="submit" style="background:#C200DB;color:#fff;border:0;border-radius:11px;padding:13px 30px;font:600 15px system-ui;cursor:pointer">Confirm unsubscribe</button>
    </form>
    <p style="color:#6b6786;margin:18px 0 0;font-size:12px">Changed your mind? Just close this tab — nothing happens until you click the button.</p>`);
}

/**
 * POST = a human clicking Confirm, or a mail client's one-click unsubscribe.
 * A signed token, when present, is tamper-checked; a MISSING token is allowed
 * because emails sent before link-signing have none, and the POST itself proves
 * a human (bots don't POST). Griefing (POSTing someone else's address) only ever
 * removes them from marketing mail and requires a crafted request — acceptable.
 */
export async function POST(req: Request) {
  let email = "", token = "";
  try {
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const b = (await req.json().catch(() => ({}))) as { e?: string; email?: string; t?: string };
      email = b.e || b.email || ""; token = b.t || "";
    } else {
      const f = await req.formData();
      email = String(f.get("e") || ""); token = String(f.get("t") || "");
    }
  } catch { /* fall through to query-string */ }
  if (!email) { const sp = new URL(req.url).searchParams; email = sp.get("e") || ""; token = token || (sp.get("t") || ""); }
  if (!email) return note("Unsubscribe", "No address specified.");

  const secret = process.env.UNSUB_SECRET;
  if (secret && token && !safeEqual(token, sign(email, secret))) {
    return note("Link not valid", "This unsubscribe link looks altered. Please use the link from a recent email, or reply STOP to any message.");
  }
  try { await optOut(email); } catch { /* best effort — never error a user here */ }
  return note("You're unsubscribed", "You won't receive marketing emails from Vedam One anymore. Account and event emails will still reach you.");
}
