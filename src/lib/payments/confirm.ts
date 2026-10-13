import type { SupabaseClient } from "@supabase/supabase-js";
import { getOrder, getSuccessfulPayment } from "@/lib/payments/cashfree";
import { receiptHtml } from "@/lib/payments/receipt";
import { deliverEmail } from "@/lib/email/deliver";
import { confirmationHtml, buildICS, type IcsEvent } from "@/lib/email/templates";
import { zoomToken, addMeetingRegistrant } from "@/lib/zoom";

type Payment = {
  id: string; cf_order_id: string; event_id: string; user_id: string; user_email: string | null;
  amount: number; currency: string; status: string; answers_snapshot: Record<string, unknown> | null;
  registration_id: string | null;
};

/**
 * Idempotent, server-authoritative payment confirmation. Called by BOTH the Cashfree
 * webhook and the status route. Verifies PAID with Cashfree (never trusts the caller),
 * then — only on a verified PAID order — materialises the registration (service role,
 * so it passes the paid-event guardrail), awards points, sends the confirmation + a
 * separate payment receipt email. Safe to call many times for the same order.
 */
export async function confirmPayment(svc: SupabaseClient, cfOrderId: string, baseUrl?: string): Promise<{ ok: boolean; status: string; error?: string }> {
  const SITE = (baseUrl || process.env.NEXT_PUBLIC_SITE_URL || "https://one.vedam.org").replace(/\/+$/, "");
  const { data: pRow } = await svc.from("event_payments").select("*").eq("cf_order_id", cfOrderId).maybeSingle();
  const p = pRow as Payment | null;
  if (!p) return { ok: false, status: "not_found", error: "payment row not found" };
  if (p.status === "paid" && p.registration_id) return { ok: true, status: "already_paid" };

  // 1) authoritative verification with Cashfree (don't trust the webhook/return alone)
  const ord = await getOrder(cfOrderId);
  if (!ord.ok) return { ok: false, status: "verify_failed", error: ord.error };
  if (ord.orderStatus !== "PAID") {
    // leave 'created' as-is for retry; mark terminal failures so the UI can offer retry cleanly
    if (["EXPIRED", "TERMINATED", "FAILED"].includes(String(ord.orderStatus))) {
      await svc.from("event_payments").update({ status: "failed", raw: ord.raw }).eq("id", p.id);
    }
    return { ok: false, status: String(ord.orderStatus || "pending") };
  }
  // amount tamper check
  if (Math.round(Number(ord.amount) * 100) !== Math.round(Number(p.amount) * 100)) {
    await svc.from("event_payments").update({ status: "failed", raw: ord.raw }).eq("id", p.id);
    return { ok: false, status: "amount_mismatch", error: "order amount does not match" };
  }

  const pay = await getSuccessfulPayment(cfOrderId);

  // 2) event (for the registration + emails)
  const { data: evRow } = await svc.from("events").select("*").eq("id", p.event_id).maybeSingle();
  const ev = (evRow || {}) as Record<string, unknown>;

  // 3) materialise the registration (idempotent on the existing (event,user) unique)
  let regId: string | null = p.registration_id;
  if (!regId) {
    const snap = (p.answers_snapshot || {}) as Record<string, unknown>;
    const regPayload = { ...snap, event_id: p.event_id, user_id: p.user_id };
    const ins = await svc.from("event_registrations").insert(regPayload).select("id").single();
    if (ins.error) {
      if (ins.error.code === "23505") {
        const { data: ex } = await svc.from("event_registrations").select("id").eq("event_id", p.event_id).eq("user_id", p.user_id).maybeSingle();
        regId = (ex as { id?: string } | null)?.id ?? null;
      } else {
        return { ok: false, status: "reg_insert_failed", error: ins.error.message };
      }
    } else {
      regId = ins.data.id;
    }
  }

  // 4) points + activity (best effort)
  try { await svc.rpc("award_event_points_for", { p_user: p.user_id, p_event_id: p.event_id, p_action: "register" }); } catch { /* */ }
  try { await svc.from("activity_log").insert({ user_id: p.user_id, event_type: "event_register", app: "events", metadata: { event_code: ev.event_code, paid: true, order_id: cfOrderId } }); } catch { /* */ }

  // 5) personal Zoom join link (server-side, no user token needed)
  let joinLink = (ev.join_link as string) || undefined;
  try {
    const mid = (ev.zoom_meeting_id as string) || (ev.zoom_id as string);
    if (mid && p.user_email) {
      const tok = await zoomToken();
      if (tok) {
        const nm = String((p.answers_snapshot as { full_name?: string } | null)?.full_name || "").trim();
        const r = await addMeetingRegistrant(tok, mid, p.user_email, nm.split(" ")[0] || p.user_email.split("@")[0], nm.split(" ").slice(1).join(" ") || ".", (ev.zoom_type as "meeting" | "webinar") || "meeting");
        if (r.join_url) { joinLink = r.join_url; if (regId) { try { await svc.from("event_registrations").update({ zoom_join_url: r.join_url }).eq("id", regId); } catch { /* */ } } }
      }
    }
  } catch { /* fall back to generic join link */ }

  // 6) mark the payment paid + link the registration BEFORE emails (so a mail hiccup can't un-confirm)
  await svc.from("event_payments").update({
    status: "paid", cf_payment_id: pay?.paymentId ?? null, cf_payment_method: pay?.method ?? null,
    registration_id: regId, paid_at: new Date().toISOString(), raw: ord.raw,
  }).eq("id", p.id);

  // 7) emails — event confirmation + separate payment receipt (best effort)
  const to = p.user_email || undefined;
  const name = String((p.answers_snapshot as { full_name?: string } | null)?.full_name || "") || undefined;
  if (to) {
    const icsEvent: IcsEvent = {
      name: String(ev.name || "Event"), mode: (ev.mode === "offline" ? "offline" : "online"),
      dateMs: ev.starts_at ? new Date(ev.starts_at as string).getTime() : undefined,
      durationMin: Number(ev.duration_minutes || 60), platform: (ev.platform as string) || undefined,
      join: joinLink, host: (ev.host as string) || undefined, blurb: (ev.blurb as string) || undefined,
      zoomId: (ev.zoom_id as string) || undefined, zoomPw: (ev.zoom_passcode as string) || undefined,
      venue: (ev.venue as string) || undefined, mapLink: (ev.map_link as string) || undefined,
      schedule: (ev.schedule as IcsEvent["schedule"]) || null, whatsapp: (ev.whatsapp_community_url as string) || undefined,
      eventUrl: ev.event_code ? `${SITE}/events/${ev.event_code as string}` : undefined,
    };
    const senderAddr = process.env.SMTP2GO_SENDER || process.env.SENDER_EMAIL || "connect@vedamcoms.org";
    try {
      await deliverEmail({
        to, subject: `You're registered: ${icsEvent.name} · Vedam School of Technology`,
        html: confirmationHtml(icsEvent, name, to), ics: buildICS(icsEvent, to, senderAddr),
        kind: "confirmation", userId: p.user_id, refName: `Registration — ${icsEvent.name}`,
      });
    } catch { /* */ }
    try {
      const receiptNo = "VED-RCPT-" + cfOrderId.replace(/[^A-Za-z0-9]/g, "").slice(-8).toUpperCase();
      await deliverEmail({
        to, subject: `Payment receipt — ${icsEvent.name} · ₹${Number(p.amount).toFixed(2)}`,
        html: receiptHtml({
          receiptNo, orderId: cfOrderId, paymentId: pay?.paymentId, method: pay?.method,
          amount: Number(p.amount), currency: p.currency, payerName: name, payerEmail: to,
          eventName: icsEvent.name, eventCode: (ev.event_code as string) || null, paidAtIso: new Date().toISOString(),
        }),
        kind: "payment_receipt", userId: p.user_id, refName: `Payment — ${icsEvent.name}`,
      });
    } catch { /* */ }
  }

  return { ok: true, status: "paid" };
}
