import type { SupabaseClient } from "@supabase/supabase-js";
import { getOrder, getSuccessfulPayment } from "@/lib/payments/cashfree";

type Order = {
  cf_order_id: string; lead_id: string; attempt: number | null;
  base_amount: number; discount: number; discount_coupon: string | null;
  amount: number; currency: string; status: string;
};

/**
 * Idempotent, server-authoritative VSAT payment confirmation. Called by BOTH the
 * VSAT webhook and the /vsat-status return route. It NEVER trusts the caller:
 * it re-fetches the order from Cashfree and acts only on a verified PAID order
 * whose amount matches our ledger. Safe to call many times for the same order.
 *
 * On success it writes the single source of truth `vsat_payments` (write-once,
 * on-conflict-do-nothing) and reflects the payment onto application_manager for
 * admin/CRM display (payment_stage_N = payment_approved, amounts, coupon, txn).
 */
export async function confirmVsatPayment(
  svc: SupabaseClient,
  cfOrderId: string,
  eventId?: string | null,
): Promise<{ ok: boolean; status: string; error?: string }> {
  const { data: oRow } = await svc.from("vsat_payment_orders").select("*").eq("cf_order_id", cfOrderId).maybeSingle();
  const o = oRow as Order | null;
  if (!o) return { ok: false, status: "not_found", error: "order not found" };

  const attempt = o.attempt ?? 1;
  const sfx = attempt >= 2 ? "2" : "1";

  // already settled + payment recorded → nothing to do
  if (o.status === "paid") {
    const { data: paid } = await svc.from("vsat_payments").select("lead_id").eq("lead_id", o.lead_id).maybeSingle();
    if (paid) return { ok: true, status: "already_paid" };
  }

  // 1) authoritative verification with Cashfree
  const ord = await getOrder(cfOrderId);
  if (!ord.ok) return { ok: false, status: "verify_failed", error: ord.error };

  if (ord.orderStatus !== "PAID") {
    if (["EXPIRED", "TERMINATED", "FAILED"].includes(String(ord.orderStatus))) {
      await svc.from("vsat_payment_orders").update({ status: "failed", raw: ord.raw }).eq("cf_order_id", cfOrderId);
      await svc.from("application_manager").update({
        [`payment_stage_${sfx}`]: "payment_failed",
        [`payment_fail_reason_${sfx}`]: String(ord.orderStatus),
        payment_status: "failed",
        last_updated_date: new Date().toISOString(),
      }).eq("lead_id", o.lead_id);
      await svc.from("crm_activity_log").insert({
        entity_type: "application", lead_id: o.lead_id, action: "stage_change", stage_type: "payment",
        to_value: "payment_failed", metadata: { order_id: cfOrderId, reason: ord.orderStatus }, actor: "system", path: "/api/payments/vsat",
      });
    }
    return { ok: false, status: String(ord.orderStatus || "pending") };
  }

  // 2) amount tamper check — Cashfree's amount must equal our ledger's net amount
  if (Math.round(Number(ord.amount) * 100) !== Math.round(Number(o.amount) * 100)) {
    await svc.from("vsat_payment_orders").update({ status: "failed", raw: ord.raw }).eq("cf_order_id", cfOrderId);
    return { ok: false, status: "amount_mismatch", error: "order amount does not match" };
  }

  // 3) payment details (id + method) for the receipt + idempotency key
  const pay = await getSuccessfulPayment(cfOrderId);
  const paymentId = pay?.paymentId ?? null;
  const method = pay?.method ?? null;
  const paidAt = new Date().toISOString();
  const providerEventId = eventId || paymentId || cfOrderId;

  // 4) THE source of truth — write-once, idempotent (lead_id PK + unique refs → on conflict do nothing)
  await svc.from("vsat_payments").insert({
    lead_id: o.lead_id, paid_at: paidAt, payment_ref: cfOrderId,
    provider: "cashfree", provider_event_id: providerEventId,
    amount: o.amount, currency: o.currency,
  });
  // NOTE: a duplicate (retried webhook, or a 2nd attempt for an already-paid user)
  // is silently ignored by the DB's unique/PK constraints — that is intended.

  // 5) settle the ledger
  await svc.from("vsat_payment_orders").update({
    status: "paid", cf_payment_id: paymentId, cf_payment_method: method, raw: ord.raw,
  }).eq("cf_order_id", cfOrderId);

  // 6) reflect onto the application for admin/CRM display (access is still decided by vsat_payments, not this)
  await svc.from("application_manager").update({
    [`payment_stage_${sfx}`]: "payment_approved",
    [`payment_stage_${sfx}_at`]: paidAt,
    application_stage_1: "payment_approved",
    payment_status: "approved",
    payment_approved_date: paidAt,
    payment_end_date: paidAt,
    payment_method: method,
    transaction_id: paymentId,
    order_id: cfOrderId,
    payment_amount: o.amount,
    discount: o.discount,
    discount_coupon: o.discount_coupon,
    currency: o.currency,
    last_updated_date: paidAt,
  }).eq("lead_id", o.lead_id);

  // 7) move the lead forward
  await svc.from("lead_manager").update({ lead_stage: "applicant_paid" }).eq("lead_id", o.lead_id);

  await svc.from("crm_activity_log").insert({
    entity_type: "application", lead_id: o.lead_id, action: "stage_change", stage_type: "payment",
    to_value: "payment_approved", metadata: { order_id: cfOrderId, amount: o.amount, payment_id: paymentId, attempt }, actor: "system", path: "/api/payments/vsat",
  });

  return { ok: true, status: "paid" };
}
