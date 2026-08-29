"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { EventRow } from "@/lib/events";
import {
  campaignShell, topImageHtml, ctaButton, messageToHtml, EMAIL_TEMPLATES, type EmailTemplate,
} from "@/lib/email/shell";

const BATCH = 40;
type Btn = { label: string; url: string };

export function Emailer({ id }: { id: string }) {
  const [supabase] = useState(() => createClient());
  const [event, setEvent] = useState<EventRow | null>(null);
  const [emails, setEmails] = useState<string[]>([]);
  const [quota, setQuota] = useState<number | null>(null);

  const [template, setTemplate] = useState<EmailTemplate>("brand");
  const [subject, setSubject] = useState("");
  const [image, setImage] = useState("");
  const [message, setMessage] = useState("");
  const [buttons, setButtons] = useState<Btn[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
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

  const bodyHtml = useMemo(() =>
    topImageHtml(image) + messageToHtml(message || "") + buttons.filter((b) => b.label && b.url).map((b) => ctaButton(b.label, b.url)).join(""),
  [image, message, buttons]);

  const liveHtml = useMemo(() => campaignShell(bodyHtml || "<p style='color:#999'>Your message preview appears here…</p>", template), [bodyHtml, template]);
  const [previewHtml, setPreviewHtml] = useState("");
  useEffect(() => { const t = setTimeout(() => setPreviewHtml(liveHtml), 350); return () => clearTimeout(t); }, [liveHtml]);

  async function uploadImage(file: File) {
    setUploadErr(null); setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `campaign/${id}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("email-images").upload(path, file, { cacheControl: "3600", upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from("email-images").getPublicUrl(path);
      setImage(data.publicUrl);
    } catch (e) {
      setUploadErr((e as Error)?.message || "Upload failed — check the email-images bucket exists.");
    } finally { setUploading(false); }
  }

  async function send() {
    if (!subject.trim() || !message.trim() || emails.length === 0) return;
    setSending(true); setResult(null);
    const { data: s } = await supabase.auth.getSession();
    const accessToken = s.session?.access_token;
    let sent = 0, failed = 0;
    for (let i = 0; i < emails.length; i += BATCH) {
      const batch = emails.slice(i, i + BATCH);
      try {
        const res = await fetch("/api/events/send-campaign", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject: subject.trim(), body: bodyHtml, recipients: batch, template, accessToken }),
        });
        const j = await res.json();
        if (j.ok) { sent += j.sent || 0; failed += j.failed || 0; } else { failed += batch.length; }
      } catch { failed += batch.length; }
    }
    const { data: q } = await supabase.rpc("email_sent_last_24h");
    setQuota(typeof q === "number" ? q : null);
    setSending(false);
    setResult(`Sent ${sent}${failed ? `, ${failed} failed` : ""}.`);
  }

  const field = "w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-[color:rgb(var(--accent))]";

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="font-display text-lg font-bold text-heading">Email registrants</h2>
        <span className="font-mono text-xs text-muted">{emails.length} recipient{emails.length === 1 ? "" : "s"}{quota != null ? ` · ${quota} sent in 24h` : ""}</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_420px] lg:items-start">
        {/* builder */}
        <div className="space-y-4">
          <div>
            <span className="mb-1.5 block font-body text-xs font-semibold text-foreground">Background template</span>
            <div className="flex flex-wrap gap-2">
              {EMAIL_TEMPLATES.map((t) => (
                <button key={t.key} onClick={() => setTemplate(t.key)}
                  className={["rounded-lg px-3.5 py-2 font-mono text-xs font-semibold transition-colors",
                    template === t.key ? "bg-brand-gradient text-white" : "border border-border-strong bg-surface text-muted hover:text-foreground"].join(" ")}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="mb-1.5 block font-body text-xs font-semibold text-foreground">Subject</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className={field} />
          </label>

          <div>
            <span className="mb-1.5 block font-body text-xs font-semibold text-foreground">Top image <span className="font-normal text-muted">(optional — shows above the message)</span></span>
            <div className="flex flex-wrap items-center gap-2">
              <label className="cursor-pointer rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm font-semibold text-foreground hover:bg-surface-warm">
                {uploading ? "Uploading…" : "Upload image"}
                <input type="file" accept="image/*" className="hidden" disabled={uploading}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(f); }} />
              </label>
              <span className="font-mono text-xs text-muted">or paste a URL:</span>
              <input value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://…/banner.png" className={field + " flex-1"} />
            </div>
            {image && <div className="mt-2 flex items-center gap-2"><span className="truncate font-mono text-[11px] text-muted">{image}</span><button onClick={() => setImage("")} className="font-mono text-[11px] text-accent hover:underline">clear</button></div>}
            {uploadErr && <p className="mt-1 font-body text-xs text-red-500">{uploadErr}</p>}
          </div>

          <label className="block">
            <span className="mb-1.5 block font-body text-xs font-semibold text-foreground">Message</span>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={7}
              placeholder={"Hi there,\n\nA quick reminder about the event…\n\n(Plain text becomes paragraphs. HTML is allowed too.)"}
              className={field + " font-mono"} />
          </label>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-body text-xs font-semibold text-foreground">Buttons</span>
              <button onClick={() => setButtons((b) => [...b, { label: "", url: "" }])} className="font-mono text-xs text-accent hover:underline">+ add button</button>
            </div>
            <div className="space-y-2">
              {buttons.length === 0 && <p className="font-body text-xs text-muted">No buttons yet. Add one or more call-to-action links.</p>}
              {buttons.map((b, i) => (
                <div key={i} className="flex gap-2">
                  <input value={b.label} onChange={(e) => setButtons((bs) => bs.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} placeholder="Button label" className={field} />
                  <input value={b.url} onChange={(e) => setButtons((bs) => bs.map((x, j) => j === i ? { ...x, url: e.target.value } : x))} placeholder="https://…" className={field} />
                  <button onClick={() => setButtons((bs) => bs.filter((_, j) => j !== i))} className="shrink-0 rounded-lg border border-border px-3 font-mono text-xs text-muted hover:text-foreground">✕</button>
                </div>
              ))}
            </div>
          </div>

          {result && <p className="font-body text-sm text-foreground">{result}</p>}
          <button onClick={send} disabled={sending || !subject.trim() || !message.trim() || !emails.length}
            className="rounded-xl bg-brand-gradient px-6 py-3 text-sm font-semibold text-white disabled:opacity-60">
            {sending ? "Sending…" : `Send to ${emails.length}`}
          </button>
          <p className="font-body text-xs text-muted">Sends in batches of {BATCH}. The Vedam header + footer wrap your content automatically.</p>
        </div>

        {/* live preview */}
        <div className="lg:sticky lg:top-20">
          <span className="mb-1.5 block font-mono text-xs font-semibold uppercase tracking-wide text-muted">Live preview</span>
          <div className="overflow-hidden rounded-2xl border border-border">
            <iframe title="Email preview" srcDoc={previewHtml} className="h-[560px] w-full bg-white" />
          </div>
        </div>
      </div>
    </div>
  );
}
