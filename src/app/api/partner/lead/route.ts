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
 * partner_leads (service role; no browser access) and then EAGERLY materialise it
 * (migration 0172): find-or-create a placeholder auth user by phone/email (handle_new_user
 * seeds the Vedam One profile), then partner_materialize() fills the lead_manager row with
 * schoolconnect attribution and, when the push is prepaid, a write-once vsat_payments row.
 * A later phone-OTP login lands the student on that same account. No application_manager is
 * created here — that waits until the student reaches the dashboard.
 *
 * Inert until PARTNER_INBOUND_SECRET is set.
 */
type InLead = {
  external_id?: unknown; name?: unknown; email?: unknown; phone?: unknown; campus?: unknown;
  utm_campaign?: unknown; bdm?: unknown; utm_source?: unknown; utm_medium?: unknown;
  // SIF first-half fields (explicit; also mirrored into extra for the claim to pre-fill)
  stream?: unknown; graduation_year?: unknown; grad_year?: unknown; state?: unknown; city?: unknown; school_name?: unknown;
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
    // explicit SIF first-half fields → mirrored into extra so the claim can pre-fill the form.
    // Explicit fields win over the UTM slots, so a medium/campaign swap can't lose the BDM or school.
    const school = str(raw.school_name, 120);
    const baseExtra = raw.extra && typeof raw.extra === "object" && !Array.isArray(raw.extra) ? (raw.extra as Record<string, unknown>) : {};
    const sif: Record<string, unknown> = {};
    const stream = str(raw.stream, 60); if (stream) sif.stream = stream;
    const gradYear = str(raw.graduation_year ?? raw.grad_year, 8); if (gradYear) sif.graduation_year = gradYear;
    const stt = str(raw.state, 60); if (stt) sif.state = stt;
    const cty = str(raw.city, 60); if (cty) sif.city = cty;
    if (school) sif.school_name = school;
    const row = {
      partner: "elevate",
      external_id: str(raw.external_id, 120),
      name: str(raw.name),
      email: str(raw.email, 200)?.toLowerCase() ?? null,
      phone,
      campus: str(raw.campus, 40),
      utm_source: str(raw.utm_source, 60) ?? "schoolconnect",
      utm_medium: str(raw.utm_medium, 80) ?? school ?? "offline", // school name
      utm_campaign: str(raw.utm_campaign ?? raw.bdm, 120),        // BDM name
      prepaid,
      prepaid_amount: prepaid && Number.isFinite(amt) && amt >= 0 ? amt : null,
      extra: { ...baseExtra, ...sif },
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
    // Eager materialization (migration 0172): the pushed lead becomes a real Vedam One profile +
    // lead_manager row now, so comms reach them and the calling team can work them without the
    // student having to log in. Find an existing account (dedupe / "already a profile"), else
    // create a placeholder auth user — handle_new_user seeds the profile from this metadata —
    // then partner_materialize fills the lead + (if prepaid) a write-once vsat_payments row.
    // NO application_manager is created here (that waits for the dashboard).
    try {
      const phoneE164 = "+91" + phoneNorm.slice(-10);
      const emailLc = row.email; // already lowercased, or null
      const { data: foundId } = await admin.rpc("partner_find_user", { p_phone: phoneE164, p_email: emailLc });
      let userId = (foundId as string | null) ?? null;
      if (!userId) {
        const meta: Record<string, unknown> = {
          source: "partner_seeded", consent_given: "true",
          utm_source: row.utm_source, utm_medium: row.utm_medium,
        };
        if (row.name) meta.full_name = row.name;
        if (emailLc) meta.email = emailLc;
        if (row.utm_campaign) meta.utm_campaign = row.utm_campaign;
        if (typeof sif.stream === "string") meta.stream = sif.stream;
        if (typeof sif.graduation_year === "string") meta.grad_year = sif.graduation_year;
        const base = { phone: phoneE164, phone_confirm: true, user_metadata: meta } as const;
        let cu = await admin.auth.admin.createUser(emailLc ? { ...base, email: emailLc, email_confirm: false } : base);
        if (cu.error && emailLc && /email|already/i.test(cu.error.message)) {
          // e-mail belongs to a different account → create phone-only (e-mail stays in the profile via metadata)
          cu = await admin.auth.admin.createUser(base);
        }
        if (cu.error || !cu.data?.user) { results.push({ phone, ok: false, error: "user: " + (cu.error?.message ?? "create failed") }); continue; }
        userId = cu.data.user.id;
      }
      const { data: mat, error: mErr } = await admin.rpc("partner_materialize", { p_lead_id: userId, p_phone: phoneE164, p_email: emailLc });
      if (mErr) { results.push({ phone, ok: true, status: "staged", error: "materialize: " + mErr.message }); continue; }
      results.push({ phone, ok: true, status: (mat as { prepaid?: boolean } | null)?.prepaid ? "materialized_paid" : "materialized" });
    } catch (e) {
      results.push({ phone, ok: true, status: "staged", error: "materialize: " + (e instanceof Error ? e.message : "exception") });
    }
  }

  const staged = results.filter((r) => r.ok).length;
  return Response.json({ ok: true, staged, total: list.length, results });
}
