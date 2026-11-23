import { createClient } from "@supabase/supabase-js";
import { verifyPartnerRequest } from "@/lib/partner/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "bom1";

/**
 * Inbound partner lead intake (Elevate / School Connect).
 *
 * Elevate POSTs one lead, or { "leads": [...] } (≤100), signed with HMAC-SHA256 — see
 * x-vedam-timestamp / x-vedam-signature (lib/partner/verify.ts). We stage each lead in
 * partner_leads (service role; no browser access); it is materialised into profiles +
 * lead_manager when the student later logs in and is matched by phone/email (migration 0156).
 *
 * Inert until PARTNER_INBOUND_SECRET is set. Never creates an auth user or a funnel row here.
 */
type InLead = {
  external_id?: unknown; name?: unknown; email?: unknown; phone?: unknown; campus?: unknown;
  utm_campaign?: unknown; bdm?: unknown; utm_source?: unknown; utm_medium?: unknown;
  prepaid?: unknown; prepaid_amount?: unknown; extra?: unknown;
};

const str = (v: unknown, max = 200): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};
const digits = (v: unknown): string => (typeof v === "string" ? v.replace(/[^0-9]/g, "") : "");

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const secret = process.env.PARTNER_INBOUND_SECRET;
  if (!url || !svc) return Response.json({ ok: false, error: "not configured" }, { status: 500 });
  if (!secret) return Response.json({ ok: false, error: "intake not enabled" }, { status: 503 });

  const rawBody = await req.text();
  const v = verifyPartnerRequest(rawBody, {
    timestamp: req.headers.get("x-vedam-timestamp"),
    signature: req.headers.get("x-vedam-signature"),
  }, secret);
  if (!v.ok) return Response.json({ ok: false, error: "unauthorized", reason: v.reason }, { status: 401 });

  let parsed: unknown;
  try { parsed = rawBody ? JSON.parse(rawBody) : null; } catch { return Response.json({ ok: false, error: "invalid json" }, { status: 400 }); }
  const list: InLead[] = Array.isArray((parsed as { leads?: unknown })?.leads)
    ? ((parsed as { leads: InLead[] }).leads)
    : parsed && typeof parsed === "object" ? [parsed as InLead] : [];
  if (list.length === 0) return Response.json({ ok: false, error: "no leads" }, { status: 400 });
  if (list.length > 100) return Response.json({ ok: false, error: "too many leads (max 100)" }, { status: 413 });

  const admin = createClient(url, svc, { auth: { persistSession: false } });
  const results: { phone: string; ok: boolean; status?: string; error?: string }[] = [];

  for (const raw of list) {
    const phone = str(raw.phone, 20);
    const phoneNorm = digits(raw.phone);
    if (!phone || phoneNorm.length < 8) { results.push({ phone: phone ?? "", ok: false, error: "invalid phone" }); continue; }
    const prepaid = raw.prepaid === true || raw.prepaid === "true";
    const amt = Number(raw.prepaid_amount);
    const row = {
      partner: "elevate",
      external_id: str(raw.external_id, 120),
      name: str(raw.name),
      email: str(raw.email, 200)?.toLowerCase() ?? null,
      phone,
      campus: str(raw.campus, 40),
      utm_source: str(raw.utm_source, 60) ?? "schoolconnect",
      utm_medium: str(raw.utm_medium, 60) ?? "offline",
      utm_campaign: str(raw.utm_campaign ?? raw.bdm, 120), // BDM name
      prepaid,
      prepaid_amount: prepaid && Number.isFinite(amt) && amt >= 0 ? amt : null,
      extra: raw.extra && typeof raw.extra === "object" && !Array.isArray(raw.extra) ? raw.extra : {},
      status: "pending" as const,
    };
    // upsert the single PENDING row for this (partner, phone): re-push refreshes it
    const { error } = await admin.from("partner_leads")
      .upsert(row, { onConflict: "partner,phone_norm", ignoreDuplicates: false })
      .select("id");
    if (error) {
      // the partial unique index (WHERE status='pending') isn't a plain on-conflict target on
      // some PostgREST versions — fall back to manual find-or-update.
      const { data: ex } = await admin.from("partner_leads")
        .select("id").eq("partner", "elevate").eq("phone_norm", phoneNorm).eq("status", "pending").maybeSingle();
      if (ex?.id) await admin.from("partner_leads").update(row).eq("id", ex.id);
      else { const ins = await admin.from("partner_leads").insert(row); if (ins.error) { results.push({ phone, ok: false, error: ins.error.message }); continue; } }
    }
    results.push({ phone, ok: true, status: "staged" });
  }

  const staged = results.filter((r) => r.ok).length;
  return Response.json({ ok: true, staged, total: list.length, results });
}
