import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { deliverEmail } from "@/lib/email/deliver";
import { vsatSender } from "./sender";
import { waSendSingle } from "@/lib/whatsapp/client";

/**
 * VSAT stage-driven comms. One entry point — sendVsatStepComms(step, ctx) — fired from
 * the lead/application/payment code paths and the 24h cron. It reads the admin config
 * (vsat_comm_steps + vsat_comm_settings), respects the master switch + per-step on/off +
 * test_mode, fills the placeholders, sends email (SMTP2GO, with the receipt PDF for the
 * paid step) and WhatsApp (TrustSignal utility template), and logs to email_events /
 * whatsapp_sends / vsat_comm_sends. The unique index on vsat_comm_sends guarantees a real
 * (non-test) step fires at most once per lead. All failures are swallowed so comms never
 * block the user flow.
 */

export type VsatCommStep = "first_half" | "application_started" | "payment_reminder_24h" | "payment_confirmed";

export type VsatCommCtx = {
  leadId: string;
  name?: string | null;
  email?: string | null;        // real recipient email (used when not test_mode)
  phone?: string | null;        // real recipient phone (digits/E.164)
  amount?: number | null;       // fee / enrollment amount for the body
  receiptUrl?: string | null;   // link to the receipt page (paid step)
  pdf?: { filename: string; base64: string } | null; // receipt PDF (paid step email)
};

type StepCfg = {
  step_key: string; title: string; enabled: boolean; test_mode: boolean;
  email_enabled: boolean; email_subject: string; email_body: string;
  wa_enabled: boolean; wa_template_id: string | null; wa_waba_id: string | null;
};
type Settings = { master: boolean; test_email: string; test_phone: string };

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://one.vedam.org").replace(/\/$/, "");
const APPLY_LINK = `${SITE}/apply`;
const DASH_LINK = `${SITE}/apply/dashboard`;

function svc(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function vars(ctx: VsatCommCtx): Record<string, string> {
  return {
    name: (ctx.name || "there").trim() || "there",
    amount: ctx.amount != null ? String(ctx.amount) : "",
    apply_link: APPLY_LINK,
    dashboard_link: DASH_LINK,
    receipt_link: ctx.receiptUrl || DASH_LINK,
  };
}

function fill(tpl: string, v: Record<string, string>): string {
  return (tpl || "").replace(/\{\{(\w+)\}\}/g, (_, k: string) => v[k] ?? "");
}

// WhatsApp bodyvar order must match the approved TrustSignal template's variable slots.
function waBodyvar(step: VsatCommStep, v: Record<string, string>): string[] {
  switch (step) {
    case "first_half": return [v.name, v.apply_link];
    case "application_started": return [v.name, v.dashboard_link];
    case "payment_reminder_24h": return [v.name, v.dashboard_link];
    case "payment_confirmed": return [v.name, v.amount, v.receipt_link];
  }
}

async function alreadySent(db: SupabaseClient, leadId: string, step: string, channel: "email" | "whatsapp"): Promise<boolean> {
  const { data } = await db.from("vsat_comm_sends").select("id")
    .eq("lead_id", leadId).eq("step_key", step).eq("channel", channel).eq("test", false).maybeSingle();
  return !!data;
}

export async function sendVsatStepComms(step: VsatCommStep, ctx: VsatCommCtx): Promise<void> {
  try {
    const db = svc();
    if (!db || !ctx.leadId) return;

    const [{ data: cfgRow }, { data: setRow }] = await Promise.all([
      db.from("vsat_comm_steps").select("*").eq("step_key", step).maybeSingle(),
      db.from("vsat_comm_settings").select("master, test_email, test_phone").eq("id", true).maybeSingle(),
    ]);
    const cfg = cfgRow as StepCfg | null;
    const settings = setRow as Settings | null;
    if (!cfg || !cfg.enabled) return;         // step is off
    if (!settings?.master) return;            // global kill-switch is off

    const testMode = cfg.test_mode;
    const v = vars(ctx);
    const toEmail = (testMode ? settings.test_email : ctx.email) || "";
    const toPhone = (testMode ? settings.test_phone : ctx.phone) || "";

    // ── EMAIL ──
    if (cfg.email_enabled && toEmail) {
      if (testMode || !(await alreadySent(db, ctx.leadId, step, "email"))) {
        const r = await deliverEmail({
          to: toEmail,
          ...vsatSender(),
          subject: fill(cfg.email_subject, v),
          html: fill(cfg.email_body, v),
          kind: `vsat_${step}`,
          userId: testMode ? null : ctx.leadId,
          refName: cfg.title,
          attachments: ctx.pdf ? [{ filename: ctx.pdf.filename, content: ctx.pdf.base64, mimetype: "application/pdf" }] : undefined,
        });
        try {
          await db.from("vsat_comm_sends").insert({ lead_id: ctx.leadId, step_key: step, channel: "email", status: r.ok ? "sent" : "failed", test: testMode, detail: r.error ?? null });
        } catch { /* unique-index backstop: a concurrent real send already logged */ }
      }
    }

    // ── WHATSAPP ──
    if (cfg.wa_enabled && cfg.wa_template_id && toPhone) {
      if (testMode || !(await alreadySent(db, ctx.leadId, step, "whatsapp"))) {
        const res = await waSendSingle({
          to: toPhone, templateId: cfg.wa_template_id, messageType: "text",
          wabaId: cfg.wa_waba_id, sample: { bodyvar: waBodyvar(step, v) },
        });
        const d = res.data as { transaction_id?: string; cost?: number } | undefined;
        try {
          await db.from("whatsapp_sends").insert({
            to_number: toPhone, template_id: cfg.wa_template_id, message_type: "text",
            status: res.ok ? "sent" : "failed", http_status: res.status, provider_response: res.data as object,
            transaction_id: d?.transaction_id ?? null, cost: d?.cost ?? null, campaign_name: `VSAT · ${cfg.title}`,
          });
        } catch { /* logging best-effort */ }
        try {
          await db.from("vsat_comm_sends").insert({ lead_id: ctx.leadId, step_key: step, channel: "whatsapp", status: res.ok ? "sent" : "failed", test: testMode, detail: null });
        } catch { /* unique-index backstop */ }
      }
    }
  } catch { /* comms must never break the user flow */ }
}
