"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { book } from "@/lib/peerpath/client";
import { popupFor, type BookFailCode, type Popup } from "@/lib/peerpath/booking-codes";
import { ttsPath } from "@/lib/peerpath/constants";
import { VerifyEmailStep } from "./verify-email-step";

type Contact = { name: string; email: string | null; phone: string | null; complete: boolean };
type Props = {
  seniorId: string;
  start: string;
  type: string;
  duration: number;
  rescheduleOf?: string | null;
  /** read-only details from the database (pp_my_contact); the same values pp_book stores */
  contact: Contact | null;
  /** this booking page, so popups can bring the user back to the same senior and time */
  returnTo: string;
  /** the senior's free times */
  seniorPath: string;
};

export function BookingForm(p: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [agreeError, setAgreeError] = useState(false);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [verified, setVerified] = useState(false);
  const sending = useRef(false); // stops a double-click before React re-renders
  const ctx = { returnTo: p.returnTo, seniorPath: p.seniorPath };

  function emailVerified() {
    setPopup(null);
    setVerified(true);
    router.refresh(); // re-reads pp_my_contact on the server, so "Your details" shows the verified email
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending.current) return;
    const form = new FormData(e.currentTarget);
    if (form.get("agree") !== "on") {
      setAgreeError(true);
      return;
    }
    setAgreeError(false);
    sending.current = true;
    setBusy(true);
    const res = await book({
      seniorId: p.seniorId,
      start: p.start,
      type: p.type,
      duration: p.duration,
      question: String(form.get("question") ?? "").trim() || null,
      rescheduleOf: p.rescheduleOf ?? null,
    });
    if (res.ok) {
      router.push(ttsPath.booked(res.id));
      router.refresh();
      return; // keep the button disabled while we leave the page
    }
    sending.current = false;
    setBusy(false);
    setPopup(popupFor(res.code as BookFailCode, ctx));
  }

  return (
    <>
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <section aria-labelledby="your-details" className="flex flex-col gap-3 rounded-xl border border-pp-line p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 id="your-details" className="text-[15px] font-semibold text-pp-heading">Your details</h2>
            <span className="text-[12px] text-pp-muted">From your Vedam account</span>
          </div>
          <dl className="grid gap-3 sm:grid-cols-3">
            <Detail label="Name" value={p.contact?.name ?? null} />
            <Detail label="Email" value={p.contact?.email ?? null} missing="Not on your application" />
            <Detail label="Phone (optional)" value={p.contact?.phone ?? null} missing="Not added" optional />
          </dl>
          {!p.contact?.email && (
            <button type="button" className="pp-btn-secondary self-start px-5" onClick={() => setPopup(popupFor("EMAIL_MISSING", ctx))}>
              Add my email
            </button>
          )}
          {verified && p.contact?.email && (
            <p role="status" className="text-[13px] font-medium text-pp-heading">Email added. You can confirm your booking now.</p>
          )}
          <p className="text-[13px] text-pp-muted">
            The Google Meet invite goes to this email. Name and email come from your VSAT application; phone from your login.
          </p>
        </section>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="question" className="pp-label">
            What do you want to ask? <span className="font-normal text-pp-muted">(optional)</span>
          </label>
          <textarea id="question" name="question" rows={3} maxLength={500} className="pp-field py-3" placeholder="e.g. How did you prepare for the VSAT interview?" />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="flex items-start gap-3 text-[15px] leading-snug text-pp-ink">
            <input type="checkbox" name="agree" className="mt-0.5 h-5 w-5 flex-none accent-pp-violet-500" aria-describedby="agree-err" aria-invalid={agreeError} />
            <span>
              I agree to the{" "}
              <Link href={ttsPath.guidelines} target="_blank" className="font-semibold text-pp-violet-600 underline underline-offset-2">
                session guidelines
              </Link>
              .
            </span>
          </label>
          {agreeError && (
            <p id="agree-err" className="text-[13px] font-medium text-[#FF7A6E]">
              Please agree to the session guidelines.
            </p>
          )}
        </div>

        <button type="submit" className="pp-btn-primary w-full sm:w-auto sm:self-start sm:px-10" disabled={busy} aria-busy={busy}>
          {busy ? (p.rescheduleOf ? "Moving…" : "Booking…") : p.rescheduleOf ? "Move my chat here" : "Confirm booking"}
        </button>
      </form>

      {popup && <BookingPopup popup={popup} onClose={() => setPopup(null)} onEmailVerified={emailVerified} />}
    </>
  );
}

function Detail({ label, value, missing = "Not added yet", optional = false }: { label: string; value: string | null; missing?: string; optional?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-pp-muted">{label}</dt>
      <dd className={`truncate text-[15px] ${value ? "font-semibold text-pp-heading" : optional ? "text-pp-muted" : "text-[#FF7A6E]"}`}>{value ?? missing}</dd>
    </div>
  );
}

/** Accessible popup: focus moves into it, Esc or the button closes it. Text only — never a raw error. */
function BookingPopup({ popup, onClose, onEmailVerified }: { popup: Popup; onClose: () => void; onEmailVerified: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!popup.verifyEmail) closeRef.current?.focus(); // the email step focuses its own field
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, popup.verifyEmail]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pp-popup-title"
        aria-describedby="pp-popup-body"
        className="pp-card w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="pp-popup-title" className="text-[20px] font-bold text-pp-heading">{popup.title}</h2>
        <p id="pp-popup-body" className="mt-2 text-[15px] leading-relaxed text-pp-muted">{popup.body}</p>
        {popup.verifyEmail ? (
          <VerifyEmailStep onDone={onEmailVerified} onCancel={onClose} />
        ) : (
        <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse">
          {popup.action && (
            <Link href={popup.action.href} className="pp-btn-primary flex-1">
              {popup.action.label}
            </Link>
          )}
          <button ref={closeRef} type="button" className="pp-btn-secondary flex-1" onClick={onClose}>
            {popup.action ? "Not now" : "OK"}
          </button>
        </div>
        )}
      </div>
    </div>
  );
}
