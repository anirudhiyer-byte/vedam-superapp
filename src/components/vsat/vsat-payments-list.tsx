"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";

type PayItem = { order_id: string; kind: string; attempt: number; base_amount: number; discount: number; coupon: string | null; amount: number; currency: string; payment_id: string | null; method: string | null; paid_at: string };

const card = "rounded-2xl border border-[#e9e4f2] bg-white p-5 shadow-[0_10px_30px_-22px_rgba(43,19,92,0.38)]";
const iconTint = "grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[#f2ebfd] text-base";

/** Standalone "My payments" page — the student's paid VSAT + enrollment orders, each with
 *  a branded receipt (opens the owner-gated receipt route → Save as PDF). */
export function VsatPaymentsList() {
  const [supabase] = useState(() => createClient());
  const [pays, setPays] = useState<PayItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoading(false); return; }
      try {
        const { data } = await supabase.rpc("vsat_my_payments");
        if (data?.ok) setPays((data.payments as PayItem[]) ?? []);
      } catch { /* best-effort */ }
      setLoading(false);
    })();
  }, [supabase]);

  async function openReceipt(orderId: string) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    window.open(`/api/payments/vsat-receipt?order=${encodeURIComponent(orderId)}&token=${encodeURIComponent(session.access_token)}`, "_blank", "noopener");
  }

  return (
    <div className="min-h-screen bg-[#f6f4fa] text-[#1b1030]">
      <div className="mx-auto max-w-[760px] px-4 py-5">
        <div className="mb-4 flex items-center justify-between">
          <Image src="/vedam-logo.png" alt="Vedam School of Technology" width={200} height={70} className="h-8 w-auto" priority />
          <Link href="/apply/dashboard" className="inline-flex items-center gap-2 rounded-[10px] border border-[#e9e4f2] bg-white px-3.5 py-2 text-sm font-semibold text-[#1b1030] transition hover:border-[#8a18ff]">← Dashboard</Link>
        </div>

        <section className={card}>
          <h1 className="font-display text-[19px] font-extrabold">My payments</h1>
          <p className="mt-1 text-sm text-[#6c6485]">Every payment you&apos;ve made, with a downloadable receipt.</p>
          <div className="mt-4 flex flex-col gap-2.5">
            {loading ? (
              <div className="py-8 text-center text-[13px] text-[#a79fbd]">Loading…</div>
            ) : pays.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#e9e4f2] px-3.5 py-8 text-center text-[13px] text-[#a79fbd]">No payments yet. Your VSAT and enrollment receipts will show up here.</div>
            ) : pays.map((p) => {
              const label = p.kind === "enrollment" ? "Enrollment fee" : `VSAT registration${p.attempt > 1 ? ` · Attempt ${p.attempt}` : ""}`;
              const sym = p.currency === "INR" || !p.currency ? "₹" : `${p.currency} `;
              const dt = new Date(p.paid_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
              return (
                <div key={p.order_id} className="flex items-center gap-3 rounded-xl border border-[#e9e4f2] p-3.5">
                  <span className={iconTint}>🧾</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-[14px] font-bold">{label}</div>
                    <div className="text-xs text-[#6c6485]">{dt}{p.coupon ? ` · ${p.coupon}` : ""}{p.method ? ` · ${p.method}` : ""}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-display text-[15px] font-extrabold tabular-nums">{sym}{Number(p.amount).toFixed(0)}</div>
                    <button onClick={() => openReceipt(p.order_id)} className="mt-0.5 text-[12px] font-semibold text-[#8a18ff] underline">View receipt</button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
