import { createClient } from "@supabase/supabase-js";
import { waSendSingle } from "@/lib/whatsapp/client";
import { sendEmailServer } from "@/lib/email/cron-send";
import { renderEmailTemplateHtml, type EmailTpl } from "@/lib/email/render";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Auto = {
  id: string; name: string; trigger_type: "event_before" | "event_after" | "scheduled";
  channel?: string; event_id: string | null; offset_minutes: number; scheduled_at: string | null;
  conditions: { state?: string; attended?: "yes" | "no"; product?: string };
  template_id: string; message_type: string; variable_mapping: { source: string; value?: string }[];
  events?: { starts_at: string | null } | null;
};
type Recip = { phone: string | null; email: string | null; name: string; state: string | null; city: string | null };
type Prof = { phone: string | null; email: string | null; state: string | null; city: string | null; full_name: string | null };

const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const GRACE_MS = 2 * 60 * 60 * 1000;

function sampleFor(mapping: { source: string; value?: string }[], r: Recip) {
  const F: Record<string, string> = { name: r.name, state: r.state || "", city: r.city || "", phone: r.phone || "" };
  const bodyvar = mapping.map((m) => m.source === "static" ? (m.value || "") : (F[m.source] ?? ""));
  return bodyvar.length ? { bodyvar } : undefined;
}

async function audience(db: ReturnType<typeof admin>, a: Auto): Promise<Recip[]> {
  const st = a.conditions?.state?.trim();
  if (a.trigger_type === "scheduled") {
    let q = db.from("profiles").select("full_name, phone, email, state, city");
    if (st) q = q.eq("state", st);
    const { data } = await q;
    return (data ?? []).map((p) => ({ phone: p.phone as string | null, email: (p as { email?: string }).email ?? null, name: p.full_name || "there", state: p.state, city: p.city }));
  }
  // event triggers
  let q = db.from("event_registrations").select("user_id, full_name, user_email, whatsapp, joined, profiles(phone, email, state, city, full_name)").eq("event_id", a.event_id);
  if (a.conditions?.attended === "yes") q = q.eq("joined", true);
  if (a.conditions?.attended === "no") q = q.eq("joined", false);
  const { data } = await q;
  const out: Recip[] = [];
  type Row = { full_name: string | null; whatsapp: string | null; profiles: Prof | Prof[] | null };
  for (const r of (data ?? []) as unknown as (Row & { user_email?: string })[]) {
    const prof = (Array.isArray(r.profiles) ? r.profiles[0] : r.profiles) as Prof | null;
    const phone = r.whatsapp || prof?.phone || null;
    const email = (r.user_email as string) || prof?.email || null;
    const state = prof?.state ?? null;
    if (st && state !== st) continue;
    out.push({ phone, email, name: r.full_name || prof?.full_name || "there", state, city: prof?.city ?? null });
  }
  return out;
}

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) return new Response("unauthorized", { status: 401 });

  const db = admin();
  const now = new Date();
  const { data: autos } = await db.from("whatsapp_automations").select("*, events(starts_at)").eq("enabled", true);
  let fired = 0, totalSent = 0;

  for (const a of (autos ?? []) as Auto[]) {

    let due: Date | null = null, runKey = "";
    if (a.trigger_type === "scheduled") {
      if (!a.scheduled_at) continue; due = new Date(a.scheduled_at); runKey = `sched:${a.scheduled_at}`;
    } else {
      const starts = a.events?.starts_at; if (!starts) continue;
      const s = new Date(starts).getTime();
      if (a.trigger_type === "event_before") { due = new Date(s - a.offset_minutes * 60000); runKey = `before:${a.event_id}:${a.offset_minutes}`; }
      else { due = new Date(s + a.offset_minutes * 60000); runKey = `after:${a.event_id}:${a.offset_minutes}`; }
    }
    if (!due || now < due || now.getTime() > due.getTime() + GRACE_MS) continue;

    // dedup: claim the run first (unique constraint blocks doubles)
    const { error: claimErr } = await db.from("whatsapp_automation_runs").insert({ automation_id: a.id, run_key: runKey });
    if (claimErr) continue;

    const recips = await audience(db, a);
    let sent = 0, failed = 0;
    if ((a.channel || "whatsapp") === "email") {
      const { data: tpl } = await db.from("email_templates").select("subject, message, template_style, image, buttons").eq("id", a.template_id).maybeSingle();
      if (tpl) { const html = renderEmailTemplateHtml(tpl as EmailTpl);
        for (const r of recips) { if (!r.email) continue; const res = await sendEmailServer(r.email, (tpl as { subject?: string }).subject || "Vedam", html); if (res.ok) sent++; else failed++; } }
    } else {
      const logs: Record<string, unknown>[] = [];
      for (const r of recips) {
        if (!r.phone) continue;
        const res = await waSendSingle({ to: r.phone, templateId: a.template_id, messageType: a.message_type, sample: sampleFor(a.variable_mapping, r) });
        const d = (res.data as { results?: { transaction_id?: string; cost?: number }[] })?.results?.[0];
        if (res.ok) sent++; else failed++;
        logs.push({ to_number: r.phone, template_id: a.template_id, message_type: a.message_type, status: res.ok ? "sent" : "failed", http_status: res.status, provider_response: res.data as object, transaction_id: d?.transaction_id ?? null, cost: d?.cost ?? null });
      }
      if (logs.length) await db.from("whatsapp_sends").insert(logs);
    }
    await db.from("whatsapp_automation_runs").update({ sent, failed }).eq("automation_id", a.id).eq("run_key", runKey);
    await db.from("whatsapp_automations").update({ last_run_at: now.toISOString() }).eq("id", a.id);
    fired++; totalSent += sent;
  }
  return Response.json({ ok: true, fired, sent: totalSent });
}
