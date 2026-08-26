"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { readUtm } from "@/lib/utm";

type Mode = "phone" | "email";

export function LoginForm() {
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

  const [mode, setMode] = useState<Mode>("phone");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");

  const e164 = (raw: string) => "+91" + raw.replace(/\D/g, "").slice(-10);

  async function sendCode() {
    setError(null);
    if (mode === "phone" && phone.replace(/\D/g, "").length < 10) return setError("Enter a valid phone number.");
    if (mode === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setError("Enter a valid email.");

    setLoading(true);
    const { error } =
      mode === "phone"
        ? await supabase.auth.signInWithOtp({ phone: e164(phone), options: { shouldCreateUser: false, channel: "sms" } })
        : await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false } });
    setLoading(false);
    if (error) return setError(error.message);
    setSent(true);
  }

  async function verify() {
    setError(null);
    if (otp.replace(/\D/g, "").length < 4) return setError("Enter the code we sent you.");
    setLoading(true);

    const { data, error } =
      mode === "phone"
        ? await supabase.auth.verifyOtp({ phone: e164(phone), token: otp.replace(/\D/g, ""), type: "sms" })
        : await supabase.auth.verifyOtp({ email: email.trim(), token: otp.replace(/\D/g, ""), type: "email" });

    if (error || !data.user) {
      setLoading(false);
      return setError(error?.message ?? "That code didn't work. Try again.");
    }

    const utm = readUtm();
    await supabase.rpc("record_login");
    await supabase.from("activity_log").insert({
      user_id: data.user.id,
      event_type: "login",
      utm_source: utm.utm_source ?? null,
      utm_medium: utm.utm_medium ?? null,
      utm_campaign: utm.utm_campaign ?? null,
    });

    setLoading(false);
    router.push(next);
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-6 sm:p-8">
      <h1 className="font-display text-2xl font-bold text-heading">Welcome back</h1>
      <p className="mt-1 font-body text-sm text-muted">Log in to your Vedam account.</p>

      {!sent && (
        <div className="mt-5 flex rounded-lg border border-border p-1">
          {(["phone", "email"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(null); }}
              className={[
                "flex-1 rounded-md py-2 text-sm font-medium capitalize transition-colors",
                mode === m ? "bg-brand-gradient text-white" : "text-muted hover:text-foreground",
              ].join(" ")}
            >
              {m}
            </button>
          ))}
        </div>
      )}

      <div className="mt-5 space-y-4">
        {!sent ? (
          <>
            {mode === "phone" ? (
              <div className="flex">
                <span className="inline-flex items-center rounded-l-lg border border-r-0 border-border bg-surface-warm px-3 text-sm text-muted">+91</span>
                <input className={inputCls + " rounded-l-none"} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" placeholder="98765 43210" />
              </div>
            ) : (
              <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@example.com" />
            )}
            {error && <p className="font-body text-sm text-red-500">{error}</p>}
            <button onClick={sendCode} disabled={loading} className={primaryBtn}>
              {loading ? "Sending code…" : "Send code"}
            </button>
          </>
        ) : (
          <>
            <input className={inputCls + " text-center text-lg tracking-[0.4em]"} value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" maxLength={6} placeholder="••••••" />
            {error && <p className="font-body text-sm text-red-500">{error}</p>}
            <button onClick={verify} disabled={loading} className={primaryBtn}>
              {loading ? "Verifying…" : "Verify & log in"}
            </button>
            <button onClick={() => { setSent(false); setOtp(""); setError(null); }} className="w-full font-body text-sm text-muted">
              ← Use a different {mode}
            </button>
          </>
        )}

        <p className="text-center font-body text-sm text-muted">
          New to Vedam?{" "}
          <Link href="/register" className="font-semibold text-accent">Create an account</Link>
        </p>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-[color:rgb(var(--accent))]";
const primaryBtn =
  "w-full rounded-xl bg-brand-gradient px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60";
