"use client";
import { useState } from "react";

/**
 * Applicant dashboard help box — the helpline number (footer number) plus an email
 * composer. Submitting posts the query to /api/apply/query, which emails it to
 * connect@vedam.org with the applicant's details (read from their login server-side).
 */

const HELPLINE_DISPLAY = "+91 92010 10176";
const HELPLINE_TEL = "+919201010176";
const MAX = 2000;

const card = "rounded-2xl border border-[#e9e4f2] bg-white p-5 shadow-[0_10px_30px_-22px_rgba(43,19,92,0.38)]";

function errText(code: unknown): string {
  switch (code) {
    case "EMPTY": return "Please type your query first.";
    case "TOO_LONG": return "That's a bit long — please shorten it.";
    case "RATE_LIMITED": return "Too many messages just now. Please try again in a little while.";
    case "UNAUTHENTICATED": return "Your session expired — please refresh and sign in again.";
    default: return "Couldn't send just now. Please try again, or call the helpline.";
  }
}

export function HelpBox() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  async function send() {
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/apply/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: text }),
      });
      const d = (await res.json().catch(() => ({ ok: false }))) as { ok?: boolean; error?: string };
      if (d.ok) { setDone(true); setQ(""); }
      else setErr(errText(d.error));
    } catch {
      setErr("Couldn't send — check your connection and try again.");
    }
    setBusy(false);
  }

  return (
    <aside className={card}>
      <p className="text-[11px] font-bold uppercase tracking-[0.13em] text-[#a79fbd]">Need help?</p>

      <a
        href={`tel:${HELPLINE_TEL}`}
        className="mt-3 flex items-center gap-3 rounded-xl border border-[#e9e4f2] p-3 transition hover:border-[#8a18ff]"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[#f2ebfd] text-base">📞</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold text-[#a79fbd]">Helpline</span>
          <span className="block font-display text-[14px] font-bold tabular-nums text-[#1b1030]">{HELPLINE_DISPLAY}</span>
        </span>
      </a>

      {!open && !done && (
        <button
          onClick={() => setOpen(true)}
          className="mt-2.5 flex w-full items-center gap-3 rounded-xl border border-[#e9e4f2] p-3 text-left transition hover:border-[#8a18ff]"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[#f2ebfd] text-base">✉️</span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-[14px] font-bold text-[#1b1030]">Email us your query</span>
            <span className="block text-[11.5px] text-[#6c6485]">We&apos;ll reply to your registered email</span>
          </span>
          <span className="text-[#a79fbd]">→</span>
        </button>
      )}

      {open && !done && (
        <div className="mt-3">
          <label htmlFor="help-query" className="mb-1.5 block text-[12.5px] font-semibold text-[#6c6485]">
            Your query
          </label>
          <textarea
            id="help-query"
            value={q}
            onChange={(e) => setQ(e.target.value.slice(0, MAX))}
            rows={4}
            autoFocus
            placeholder="Tell us what you need help with…"
            className="w-full resize-y rounded-xl border border-[#e9e4f2] bg-[#faf9fd] px-3 py-2.5 text-sm text-[#1b1030] placeholder-[#a79fbd] focus:border-[#8a18ff] focus:outline-none focus:ring-2 focus:ring-[#8a18ff]/20"
          />
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[11px] text-[#a79fbd]">{q.length}/{MAX}</span>
            <span className="text-[11px] text-[#a79fbd]">Sent to connect@vedam.org</span>
          </div>
          {err && <p className="mt-2 rounded-lg bg-[#fdeaea] px-3 py-2 text-[12.5px] font-medium text-[#d14343]">{err}</p>}
          <div className="mt-2.5 flex gap-2">
            <button
              onClick={send}
              disabled={busy || !q.trim()}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#8a18ff] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#7312e0] disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send query"}
            </button>
            <button
              onClick={() => { setOpen(false); setErr(""); }}
              disabled={busy}
              className="rounded-xl border border-[#e9e4f2] px-4 py-2.5 text-sm font-semibold text-[#6c6485] transition hover:border-[#8a18ff] disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {done && (
        <div className="mt-3 rounded-xl border border-[#bfe8cf] bg-[#eafaf0] p-3.5">
          <p className="font-display text-[14px] font-bold text-[#1f7a46]">Query sent ✓</p>
          <p className="mt-1 text-[12.5px] text-[#2f6a48]">
            Our team will reply to your registered email soon. For anything urgent, call the helpline above.
          </p>
          <button
            onClick={() => { setDone(false); setOpen(false); }}
            className="mt-2 text-[12.5px] font-semibold text-[#1f7a46] underline underline-offset-2"
          >
            Ask another question
          </button>
        </div>
      )}
    </aside>
  );
}
