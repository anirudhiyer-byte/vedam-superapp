import { createClient } from "@supabase/supabase-js";
import { waCreateTemplate } from "@/lib/whatsapp/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Admin-only: submit the 4 VSAT utility WhatsApp templates to TrustSignal for approval,
 * and store each returned template name on its step (wa_template_id). UTILITY category so
 * delivery isn't throttled as marketing. Approval is async — the admin flips each step's
 * WhatsApp on in the panel once TrustSignal shows it approved.
 */

const LANG = "en";
const DASH = "https://one.vedam.org/apply/dashboard";
const APPLY = "https://one.vedam.org/apply";
const PAY = "https://one.vedam.org/apply/dashboard/payments";

const TEMPLATES: { step_key: string; name: string; body: string; samples: string[] }[] = [
  {
    step_key: "first_half", name: "vsat_first_half",
    body: "Hi {{1}}, welcome to Vedam! 🎉 Your Vedam One account is ready and your VSAT journey has begun. You're just one step away — complete the second half of your form to continue: {{2}}\n\nWarmly, Team Vedam",
    samples: ["Pawan", APPLY],
  },
  {
    step_key: "application_started", name: "vsat_application_started",
    body: "Hi {{1}}, wonderful news — your VSAT application has started! To unlock your exam, a fee of ₹{{2}} is needed, and your early-bird price stays open for the next 24 hours. Complete your payment here: {{3}}\n\nCheering you on, Team Vedam",
    samples: ["Pawan", "800", DASH],
  },
  {
    step_key: "payment_reminder_24h", name: "vsat_payment_reminder",
    body: "Hi {{1}}, a gentle reminder — your VSAT fee of ₹{{2}} is still pending and your early-bird window is closing soon. Secure your seat whenever you're ready: {{3}}\n\nWarm wishes, Team Vedam",
    samples: ["Pawan", "800", DASH],
  },
  {
    step_key: "payment_confirmed", name: "vsat_payment_confirmed",
    body: "Hi {{1}}, thank you so much! 💜 We've received your VSAT fee of ₹{{2}}. Here's your receipt: {{3}}. You're all set — next, fill your application form, take your mock test, and pick your exam date on your dashboard: {{4}}\n\nWarmly, Team Vedam",
    samples: ["Pawan", "800", PAY, DASH],
  },
];

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !svcKey) return Response.json({ ok: false, error: "not configured" }, { status: 500 });

  let body: { accessToken?: string } = {};
  try { body = await req.json(); } catch { /* no body */ }

  // admin gate
  const asUser = createClient(url, anon);
  const { data: u } = await asUser.auth.getUser(body.accessToken || "");
  if (!u?.user?.id) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const email = (u.user.email ?? "").toLowerCase();
  let isAdmin = email.endsWith("@vedam.org") && !!u.user.email_confirmed_at;
  if (!isAdmin) {
    const scoped = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${body.accessToken}` } } });
    const { data } = await scoped.rpc("is_admin");
    isAdmin = !!data;
  }
  if (!isAdmin) return Response.json({ ok: false, error: "forbidden" }, { status: 403 });

  const svc = createClient(url, svcKey);
  const results: { step_key: string; name: string; ok: boolean; status: number; detail?: unknown }[] = [];

  for (const t of TEMPLATES) {
    const payload = {
      name: t.name, lang: LANG, category: "UTILITY",
      components: [{ type: "BODY", text: t.body, example: { body_text: [t.samples] } }],
    };
    const r = await waCreateTemplate(payload);
    results.push({ step_key: t.step_key, name: t.name, ok: r.ok, status: r.status, detail: r.data });
    // store the template name on the step so sends resolve once it's approved
    await svc.from("vsat_comm_steps").update({ wa_template_id: t.name }).eq("step_key", t.step_key);
  }

  return Response.json({ ok: results.every((r) => r.ok), results });
}
