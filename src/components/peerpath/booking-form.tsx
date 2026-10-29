"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { book } from "@/lib/peerpath/client";
import { setProofCookie } from "@/lib/peerpath/proof";
import { ttsPath } from "@/lib/peerpath/constants";

type Props = { seniorId: string; start: string; type: string; duration: number; rescheduleOf?: string | null; defaults?: { name: string; email: string; phone: string } };

export function BookingForm(p: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body = {
      seniorId: p.seniorId,
      start: p.start,
      type: p.type,
      duration: p.duration,
      name: String(form.get("name") ?? "").trim(),
      phone: String(form.get("phone") ?? "").trim(),
      email: String(form.get("email") ?? "").trim(),
      question: String(form.get("question") ?? "").trim() || null,
      agree: form.get("agree") === "on",
    };

    const errs: Record<string, string> = {};
    if (body.name.length < 2) errs.name = "Please enter your name.";
    if (!/^\+?[0-9\s-]{10,15}$/.test(body.phone)) errs.phone = "Please enter a valid WhatsApp number.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) errs.email = "Please enter a valid email.";
    if (!body.agree) errs.agree = "Please agree to the session guidelines.";
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;

    setBusy(true);
    setError(null);
    try {
      const res = await book({ ...body, rescheduleOf: p.rescheduleOf ?? null });
      if (!res.ok) {
        setError(res.message);
        setBusy(false);
        return;
      }
      // remember who owns this booking on this device, so the confirmation and
      // feedback pages can prove ownership without asking again.
      setProofCookie(body.email, body.phone);
      router.push(ttsPath.booked(res.id));
      router.refresh();
    } catch {
      setError("You seem to be offline. Please check your internet and try again.");
      setBusy(false);
    }
  }

  const err = (k: string) =>
    fieldErrors[k] ? (
      <p id={`${k}-err`} className="text-[13px] font-medium text-[#FF7A6E]">
        {fieldErrors[k]}
      </p>
    ) : null;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label htmlFor="name" className="pp-label">Your name</label>
          <input id="name" name="name" autoComplete="name" className="pp-field" placeholder="Full name" defaultValue={p.defaults?.name} aria-invalid={!!fieldErrors.name} aria-describedby="name-err" />
          {err("name")}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="phone" className="pp-label">WhatsApp number</label>
          <input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" className="pp-field" placeholder="+91 98765 43210" defaultValue={p.defaults?.phone} aria-invalid={!!fieldErrors.phone} aria-describedby="phone-hint phone-err" />
          <p id="phone-hint" className="text-[13px] text-pp-muted">For reminders only.</p>
          {err("phone")}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="pp-label">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" className="pp-field" placeholder="you@email.com" defaultValue={p.defaults?.email} aria-invalid={!!fieldErrors.email} aria-describedby="email-hint email-err" />
          <p id="email-hint" className="text-[13px] text-pp-muted">Your booking details and Meet link are linked to this.</p>
          {err("email")}
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label htmlFor="question" className="pp-label">
            What do you want to ask? <span className="font-normal text-pp-muted">(optional)</span>
          </label>
          <textarea id="question" name="question" rows={3} maxLength={500} className="pp-field py-3" placeholder="e.g. How did you prepare for the VSAT interview?" />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="flex items-start gap-3 text-[15px] leading-snug text-pp-ink">
          <input type="checkbox" name="agree" className="mt-0.5 h-5 w-5 flex-none accent-pp-violet-500" aria-describedby="agree-err" />
          <span>
            I agree to the{" "}
            <Link href={ttsPath.guidelines} target="_blank" className="font-semibold text-pp-violet-600 underline underline-offset-2">
              session guidelines
            </Link>
            .
          </span>
        </label>
        {err("agree")}
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-[#7f2a24] bg-[#2a1212] px-4 py-3 text-[14px] text-[#FF7A6E]">
          {error}
        </p>
      )}

      <button type="submit" className="pp-btn-primary w-full sm:w-auto sm:self-start sm:px-10" disabled={busy}>
        {busy ? (p.rescheduleOf ? "Moving…" : "Booking…") : p.rescheduleOf ? "Move my chat here" : "Confirm booking"}
      </button>
    </form>
  );
}
