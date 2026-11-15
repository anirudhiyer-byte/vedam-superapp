import type { SupabaseClient } from "@supabase/supabase-js";
import { getOrder, getSuccessfulPayment } from "@/lib/payments/cashfree";

type Order = { cf_order_id: string; lead_id: string; amount: number; currency: string; status: string; kind: string };

/**
 * Idempotent, server-authoritative confirmation of the ₹50,000 enrollment payment.
 * Called by BOTH the shared webhook and the enroll-status return route. Re-fetches
 * the order from Cashfree and acts only on a verified PAID order whose amount
 * matches our ledger. On success it marks the application enrolled.
 */
export async function confirmEnrollment(
  svc: SupabaseClient,
  cfOrderId: string,
): Promise<{ ok: boolean; status: string; error?: string }> {
  const { data: oRow } = await svc.from("vsat_payment_orders").select("*").eq("cf_order_id", cfOrderId).maybeSingle();
  const o = oRow as Order | null;
  if (!o) return { ok: false, status: "not_found", error: "order not found" };
  if (o.kind !== "enrollment") return { ok: false, status: "wrong_kind", error: "not an enrollment order" };

  if (o.status === "paid") {
    const { data: am } = await svc.from("application_manager").select("enrollment_stage").eq("lead_id", o.lead_id).maybeSingle();
    if ((am as { enrollment_stage?: string } | null)?.enrollment_stage === "approved") return { ok: true, status: "already_paid" };
  }

  const ord = await getOrder(cfOrderId);
  if (!ord.ok) return { ok: false, status: "verify_failed", error: ord.error };

  if (ord.orderStatus !== "PAID") {
    if (["EXPIRED", "TERMINATED", "FAILED"].includes(String(ord.orderStatus))) {
      await svc.from("vsat_payment_orders").update({ status: "failed", raw: ord.raw }).eq("cf_order_id", cfOrderId);
      await svc.from("application_manager").update({ enrollment_stage: "failed", last_updated_date: new Date().toISOString() }).eq("lead_id", o.lead_id);
      await svc.from("crm_activity_log").insert({
        entity_type: "application", lead_id: o.lead_id, action: "stage_change", stage_type: "enrollment",
        to_value: "failed", metadata: { order_id: cfOrderId, reason: ord.orderStatus }, actor: "system", path: "/api/payments/enroll",
      });
    }
    return { ok: false, status: String(ord.orderStatus || "pending") };
  }

  if (Math.round(Number(ord.amount) * 100) !== Math.round(Number(o.amount) * 100)) {
    await svc.from("vsat_payment_orders").update({ status: "failed", raw: ord.raw }).eq("cf_order_id", cfOrderId);
    return { ok: false, status: "amount_mismatch", error: "order amount does not match" };
  }

  const pay = await getSuccessfulPayment(cfOrderId);
  const paymentId = pay?.paymentId ?? null;
  const paidAt = new Date().toISOString();

  await svc.from("vsat_payment_orders").update({
    status: "paid", cf_payment_id: paymentId, cf_payment_method: pay?.method ?? null, raw: ord.raw,
  }).eq("cf_order_id", cfOrderId);

  await svc.from("application_manager").update({
    enrollment_stage: "approved", application_stage_1: "enrolled",
    enrollment_paid_at: paidAt, enrollment_txn_id: paymentId, enrollment_order_id: cfOrderId,
    enrollment_amount: o.amount, last_updated_date: paidAt,
  }).eq("lead_id", o.lead_id);

  await svc.from("crm_activity_log").insert({
    entity_type: "application", lead_id: o.lead_id, action: "stage_change", stage_type: "enrollment",
    to_value: "approved", metadata: { order_id: cfOrderId, amount: o.amount, payment_id: paymentId }, actor: "system", path: "/api/payments/enroll",
  });

  return { ok: true, status: "paid" };
}
