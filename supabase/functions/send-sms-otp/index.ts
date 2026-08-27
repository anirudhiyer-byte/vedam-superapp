// Supabase Send SMS Hook -> MSG91 Flow API
// Delivers Supabase's generated OTP via your DLT-approved MSG91 template.
// Runtime: Supabase Edge Functions (Deno).
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

const HOOK_SECRET = Deno.env.get("SEND_SMS_HOOK_SECRET") ?? "";
const MSG91_AUTHKEY = Deno.env.get("MSG91_AUTHKEY") ?? "";
const MSG91_TEMPLATE_ID = Deno.env.get("MSG91_TEMPLATE_ID") ?? "";
const MSG91_OTP_VAR = Deno.env.get("MSG91_OTP_VAR") ?? "otp"; // variable name in your MSG91 template

Deno.serve(async (req) => {
  const raw = await req.text();

  // 1) Verify the request really came from Supabase (Standard Webhooks signature).
  // Supabase gives the secret as `v1,whsec_<base64>`; the library wants the base64 part.
  if (HOOK_SECRET) {
    try {
      const base64Secret = HOOK_SECRET.replace(/^v1,whsec_/, "");
      const wh = new Webhook(base64Secret);
      wh.verify(raw, Object.fromEntries(req.headers));
    } catch (_e) {
      return new Response(JSON.stringify({ error: "invalid signature" }), { status: 401 });
    }
  }

  // 2) Pull the phone + OTP from Supabase's payload.
  let user: { phone?: string }, sms: { otp?: string };
  try { ({ user, sms } = JSON.parse(raw)); } catch { return json({ error: "bad json" }, 400); }
  const otp = sms?.otp;
  let mobile = String(user?.phone ?? "").replace(/\D/g, ""); // strip + / spaces
  if (mobile.length === 10) mobile = "91" + mobile;          // safety: ensure country code
  if (!mobile || !otp) return json({ error: "missing phone or otp" }, 400);

  // 3) Send via MSG91 Flow API.
  const res = await fetch("https://control.msg91.com/api/v5/flow/", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json", "authkey": MSG91_AUTHKEY },
    body: JSON.stringify({
      template_id: MSG91_TEMPLATE_ID,
      short_url: "0",
      recipients: [{ mobiles: mobile, [MSG91_OTP_VAR]: String(otp) }],
    }),
  });

  const detail = await res.text();
  if (!res.ok) return json({ error: `msg91 ${res.status}`, detail }, 500);
  return json({}, 200); // Supabase expects a 2xx with a JSON body on success
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
