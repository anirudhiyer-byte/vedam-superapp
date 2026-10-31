"use client";

/**
 * Add the login email inside the booking popup (code EMAIL_MISSING: no email on the
 * user's own VSAT application). Email → "Send code" → 6-digit code → Supabase marks the
 * login email verified (auth.users.email_confirmed_at), which pp_book then uses.
 * Same Supabase calls the site already uses on /apply and in the profile form.
 */
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { afterSend, afterVerify, cleanCode, cleanEmail, sendCodeError, verifyCodeError } from "@/lib/peerpath/verify-email";

const RESEND_SECONDS = 60;
type OtpKind = "email_change" | "signup";

export function VerifyEmailStep({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [supabase] = useState(() => createClient());
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [kind, setKind] = useState<OtpKind>("email_change");
  // "Secure email change": Supabase also sends a code to the CURRENT address; we then verify that one
  const [current, setCurrent] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy || cooldown > 0) return;
    const clean = cleanEmail(email);
    if (!clean) return setErr("Please enter a valid email address.");
    setErr("");
    setBusy(true);
    const { data, error } = await supabase.auth.updateUser({ email: clean });
    if (error) { setBusy(false); return setErr(sendCodeError(error)); }
    const next = afterSend(data.user, clean);
    if (next === "done") { setBusy(false); return onDone(); }   // already this login's verified email
    if (next === "resend_signup") {
      // already on the login but never confirmed: Auth sends nothing for an unchanged email
      const { error: rErr } = await supabase.auth.resend({ type: "signup", email: clean });
      if (rErr) { setBusy(false); return setErr(sendCodeError(rErr)); }
    }
    setBusy(false);
    setKind(next === "resend_signup" ? "signup" : "email_change");
    setCurrent(null);
    setSentTo(clean);
    setCode("");
    setCooldown(RESEND_SECONDS);
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !sentTo) return;
    const token = cleanCode(code);
    if (!token) return setErr("Enter the code from the email.");
    setErr("");
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({ email: current ?? sentTo, token, type: kind });
    if (error) { setBusy(false); return setErr(verifyCodeError(error)); }
    // read the login back: only a really verified email counts (no fake success)
    const { data } = await supabase.auth.getUser();
    setBusy(false);
    const next = afterVerify(data.user, sentTo);
    if (next === "done") return onDone();
    if (next === "confirm_current" && data.user?.email) {
      setCurrent(data.user.email);
      setCode("");
      return;
    }
    setErr("That didn't finish. Please ask for a new code and try again.");
  }

  if (!sentTo) {
    return (
      <form onSubmit={sendCode} noValidate className="mt-5 flex flex-col gap-3">
        <label htmlFor="pp-verify-email" className="pp-label">Your email</label>
        <input
          id="pp-verify-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          maxLength={254}
          className="pp-field"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={!!err}
          aria-describedby={err ? "pp-verify-err" : undefined}
          autoFocus
        />
        {err && <p id="pp-verify-err" role="alert" className="text-[13px] font-medium text-[#FF7A6E]">{err}</p>}
        <div className="mt-1 flex flex-col gap-3 sm:flex-row-reverse">
          <button type="submit" className="pp-btn-primary flex-1" disabled={busy} aria-busy={busy}>{busy ? "Sending…" : "Send code"}</button>
          <button type="button" className="pp-btn-secondary flex-1" onClick={onCancel}>Not now</button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={verify} noValidate className="mt-5 flex flex-col gap-3">
      {current ? (
        <p role="status" className="text-[14px] text-pp-muted">
          Almost done. For safety we also sent a code to your current email{" "}
          <span className="font-semibold text-pp-heading">{current}</span>. Enter that code to finish.
        </p>
      ) : (
        <p className="text-[14px] text-pp-muted">
          We sent a code to <span className="font-semibold text-pp-heading">{sentTo}</span>. It may take a minute; check spam too.
        </p>
      )}
      <label htmlFor="pp-verify-code" className="pp-label">Code</label>
      <input
        id="pp-verify-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={12}
        className="pp-field tracking-[0.3em]"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        aria-invalid={!!err}
        aria-describedby={err ? "pp-verify-err" : undefined}
        autoFocus
      />
      {err && <p id="pp-verify-err" role="alert" className="text-[13px] font-medium text-[#FF7A6E]">{err}</p>}
      <div className="mt-1 flex flex-col gap-3 sm:flex-row-reverse">
        <button type="submit" className="pp-btn-primary flex-1" disabled={busy} aria-busy={busy}>{busy ? "Checking…" : "Verify email"}</button>
        <button type="button" className="pp-btn-secondary flex-1" onClick={() => { setSentTo(null); setCurrent(null); setErr(""); }}>
          Change email
        </button>
      </div>
      <button type="button" className="self-start text-[13px] font-semibold text-pp-violet-600 underline underline-offset-2 disabled:no-underline disabled:opacity-60"
        onClick={() => void sendCode()} disabled={busy || cooldown > 0}>
        {cooldown > 0 ? `Send a new code in ${cooldown}s` : "Send a new code"}
      </button>
    </form>
  );
}
