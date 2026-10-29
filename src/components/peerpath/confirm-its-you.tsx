"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setProofCookie } from "@/lib/peerpath/proof";

/**
 * Shown when a booking page can't confirm you own this booking (a link opened on a
 * new device/browser, or the proof cookie is gone). You enter the email + phone you
 * booked with; we store it on this device and reload, and the server then shows the
 * booking only if they match. Nothing is revealed until they do — so this doubles as
 * the gate that stops anyone with just the link from seeing or cancelling a booking.
 */
export function ConfirmItsYou() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || phone.replace(/\D/g, "").length < 10) {
      setMsg("Please enter the email and WhatsApp number you booked with.");
      return;
    }
    setProofCookie(email, phone);
    setMsg(null);
    router.refresh();
  }

  return (
    <div className="mx-auto flex max-w-[480px] flex-col gap-5 px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-[24px] font-bold text-pp-heading">Confirm it&apos;s you</h1>
        <p className="text-[15px] text-pp-muted">
          Enter the email and WhatsApp number you booked with to see this chat. This keeps your
          booking private — a link alone can&apos;t open it.
        </p>
      </div>
      <form onSubmit={submit} className="pp-card flex flex-col gap-4 p-5 sm:p-6" noValidate>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="c-email" className="pp-label">Email</label>
          <input id="c-email" type="email" autoComplete="email" className="pp-field" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="c-phone" className="pp-label">WhatsApp number</label>
          <input id="c-phone" type="tel" inputMode="tel" autoComplete="tel" className="pp-field" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        {msg && <p role="status" className="text-[14px] text-[#FF7A6E]">{msg}</p>}
        <button type="submit" className="pp-btn-primary">See my booking</button>
      </form>
    </div>
  );
}
