"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { EventRow } from "@/lib/events";

const BATCH = 40;

export function Emailer({ id }: { id: string }) {
  const [supabase] = useState(() => createClient());
  const [event, setEvent] = useState<EventRow | null>(null);
  const [emails, setEmails] = useState<string[]>([]);
  const [quota, setQuota] = useState<number | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: ev } = await supabase.from("events").select("*").eq("id", id).single();
      const { data: regs } = await supabase.from("event_registrations").select("user_email").eq("event_id", id);
      const { data: q } = await supabase.rpc("email_sent_last_24h");
      if (!active) return;
      setEvent((ev as EventRow) ?? null);
      setEmails([...new Set((regs ?? []).map((r) => r.user_email).filter(Boolean) as string[])]);
      setQuota(typeof q === "number" ? q : null);
    })();
    return () => { active = false; };
  }, [id, supabase]);

  async function send() {
    if (!subject.trim() || !body.trim() || emails.length === 0) return;
    setSending(true);
    setResult(null);
    const { data: s } = await supabase.auth.getSession();
    const accessToken = s.session?.access_token;
    let sent = 0, failed = 0;
    for (let i = 0; i < emails.length; i += BATCH) {
      const batch = emails.slice(i, i + BATCH);
      try {
        const res = await fetch("/api/events/send-campaign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject: subject.trim(), body, recipients: batch, accessToken }),
        });
        const j = await res.json();
        if (j.ok) { sent += j.sent || 0; failed += j.failed || 0; }
        else { failed += batch.length; }
      } catch { failed += batch.length; }
    }
    const { data: q } = await supabase.rpc("email_sent_last_24h");
    setQuota(typeof q === "number" ? q : null);
    setSending(false);
    setResult(`Sent ${sent}${failed ? `, ${failed} failed` : ""}.`);
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="font-display text-lg font-bold text-heading">Email registrants</h2>
        <span className="font-mono text-xs text-muted">
          {emails.length} recipient{emails.length === 1 ? "" : "s"}{quota != null ? ` · ${quota} sent in 24h` : ""}
        </span>
      </div>

      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block font-body text-xs font-semibold text-foreground">Subject</span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-[color:rgb(var(--accent))]" />
        </label>
        <label className="block">
          <span className="mb-1.5 block font-body text-xs font-semibold text-foreground">Message (HTML allowed)</span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8}
            placeholder="<p>Hi there,</p><p>Quick reminder about the event…</p>"
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-sm text-foreground outline-none focus:border-[color:rgb(var(--accent))]" />
          <span className="mt-1 block font-body text-xs text-muted">Wrapped in the Vedam brand shell automatically. Sends in batches of {BATCH}.</span>
        </label>

        {result && <p className="font-body text-sm text-foreground">{result}</p>}

        <button onClick={send} disabled={sending || !subject.trim() || !body.trim() || !emails.length}
          className="rounded-xl bg-brand-gradient px-6 py-3 text-sm font-semibold text-white disabled:opacity-60">
          {sending ? "Sending…" : `Send to ${emails.length}`}
        </button>
      </div>
    </div>
  );
}
