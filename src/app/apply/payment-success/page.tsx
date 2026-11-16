"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { gtmEvent } from "@/lib/analytics/gtm";

/**
 * Post-payment thank-you page. Cashfree redirects here (returnUrl set in
 * vsat-create-order) as /apply/payment-success?order=<id>. We confirm the payment
 * server-side, fire the GTM "VSAT Fee Paid" event exactly once on a genuine
 * first-time success, and offer "Go to Dashboard". A refresh re-confirms as
 * already_paid and does NOT re-fire the event.
 */
export default function PaymentSuccessPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [state, setState] = useState<"confirming" | "paid" | "already" | "pending" | "error">("confirming");

  useEffect(() => {
    (async () => {
      const order = new URLSearchParams(window.location.search).get("order") || "";
      const { data: { session } } = await supabase.auth.getSession();
      if (!order || !session) { setState("error"); return; }
      try {
        const res = await fetch("/api/payments/vsat-status", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: session.access_token, orderId: order }),
        });
        const j = await res.json();
        if (j.ok && j.status === "paid") {
          // fire VSAT Fee Paid once per order (guard against a double-run / refresh)
          let already = false;
          try { already = sessionStorage.getItem("vsat_fee_paid_" + order) === "1"; } catch { /* ignore */ }
          if (!already) {
            gtmEvent("VSAT Fee Paid", { order_id: order, currency: "INR" });
            try { sessionStorage.setItem("vsat_fee_paid_" + order, "1"); } catch { /* ignore */ }
          }
          setState("paid");
        } else if (j.status === "already_paid") {
          setState("already");
        } else {
          setState("pending");
        }
      } catch { setState("error"); }
    })();
  }, [supabase]);

  const ok = state === "paid" || state === "already";
  const grad = "linear-gradient(104deg,#f97d03 0%,#c200db 52%,#8a18ff 100%)";

  return (
    <div className="min-h-screen bg-[#f6f4fa] text-[#1b1030]">
      <div className="mx-auto flex min-h-screen max-w-[520px] flex-col items-center justify-center px-5 py-10 text-center">
        <Image src="/vedam-logo.png" alt="Vedam School of Technology" width={200} height={70} className="mb-8 h-9 w-auto" priority />

        {state === "confirming" && (
          <div className="rounded-2xl border border-[#e9e4f2] bg-white p-8 shadow-[0_10px_30px_-22px_rgba(43,19,92,0.38)]">
            <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-[#eadcff] border-t-[#8a18ff]" />
            <p className="text-sm font-medium text-[#6c6485]">Confirming your payment…</p>
          </div>
        )}

        {ok && (
          <div className="w-full rounded-[20px] border border-[#e9e4f2] bg-white p-8 shadow-[0_18px_50px_-26px_rgba(43,19,92,0.45)]">
            <div className="mx-auto grid h-20 w-20 place-items-center rounded-full text-white" style={{ background: grad }}>
              <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            </div>
            <h1 className="mt-5 font-display text-[26px] font-extrabold leading-tight">Payment successful 🎉</h1>
            <p className="mt-2 text-sm text-[#6c6485]">
              {state === "already"
                ? "Your VSAT fee is already paid. You're all set."
                : "Your VSAT fee is received. Your exam slot, mock tests and application form are now unlocked."}
            </p>
            <button onClick={() => router.push("/apply/dashboard")}
              className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-[#8a18ff] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#7312e0]">
              Go to Dashboard →
            </button>
          </div>
        )}

        {(state === "pending" || state === "error") && (
          <div className="w-full rounded-[20px] border border-[#f3d79a] bg-[#fff6e6] p-8">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#fff0d6] text-3xl">⏳</div>
            <h1 className="mt-4 font-display text-[22px] font-extrabold text-[#b26a00]">Payment not confirmed yet</h1>
            <p className="mt-2 text-sm text-[#b26a00]">
              If the amount was debited, it will reflect shortly — you can check on your dashboard. Otherwise you can try the payment again from there.
            </p>
            <button onClick={() => router.push("/apply/dashboard")}
              className="mt-6 inline-flex w-full items-center justify-center rounded-xl border border-[#e9e4f2] bg-white px-6 py-3 text-sm font-semibold text-[#1b1030] transition hover:border-[#8a18ff]">
              Go to Dashboard →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
