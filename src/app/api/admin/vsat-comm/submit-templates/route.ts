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

// Refreshed utility copy (Nov 2026). Variable slots here MUST match waBodyvar() in
// src/lib/vsat/comms.ts for each step, or TrustSignal rejects the send on a slot-count mismatch.
const TEMPLATES: { step_key: string; name: string; body: string; samples: string[] }[] = [
  {
    step_key: "first_half", name: "vsat_first_half",
    body: "Hi {{1}}, welcome to Vedam! 🎉 Your Vedam One account is ready and your VSAT journey has begun. You're just one step away — complete your application and start preparing for VSAT: {{2}}\n\nAll the best, Team Vedam",
    samples: ["Pawan", APPLY],
  },
  {
    step_key: "application_started", name: "vsat_application_started",
    body: "Hi {{1}}, wonderful news — your VSAT application has started! You're one step away from VSAT: complete your exam fee payment and select your test slot here: {{2}}. Also get a concession of ₹200 on VSAT, valid only for the first 24 hours.\n\nCheering you on, Team Vedam",
    samples: ["Pawan", DASH],
  },
  {
    step_key: "payment_reminder_24h", name: "vsat_payment_reminder",
    body: "Hi {{1}}, just a few hours left before the VSAT scholarship ends — and we'd hate for you to miss out! Your VSAT registration is 99% done; all that's left is the final step. Complete it now to avail up to 20% scholarship on your VSAT registration fee: {{2}}\n\nCheering you on, Team Vedam",
    samples: ["Pawan", DASH],
  },
  {
    step_key: "payment_confirmed", name: "vsat_payment_confirmed",
    body: "Hi {{1}}, you have successfully registered for VSAT! We've received your VSAT fee of ₹{{2}}. Here's your receipt: {{3}}. Next steps: pick your exam date, fill your application form, and take the mock test.\n\nAll the best, Team Vedam",
    samples: ["Pawan", "800", PAY],
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
