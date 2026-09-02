"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { EventRow } from "@/lib/events";
import {
  campaignShell, topImageHtml, ctaButton, messageToHtml, EMAIL_TEMPLATES, type EmailTemplate,
} from "@/lib/email/shell";

const BATCH = 40;
type Btn = { label: string; url: string };
type Recip = { email: string; name: string; stream: string; source: string; attended: boolean };
type Tpl = { id: string; name: string; subject: string | null; message: string | null; template_style: string; image: string | null; buttons: Btn[] };

export function Emailer({ id }: { id: string }) {
  const [supabase] = useState(() => createClient());
  const [event, setEvent] = useState<EventRow | null>(null);
  const [recips, setRecips] = useState<Recip[]>([]);
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

  // saved templates
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [tplName, setTplName] = useState("");
  const [savingTpl, setSavingTpl] = useState(false);

  // recipient picker — DESELECTED by default
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [attendedOnly, setAttendedOnly] = useState(false);

  async function loadTpls() { const { data } = await supabase.from("email_templates").select("*").order("created_at", { ascending: false }); setTpls((data as Tpl[]) ?? []); }

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: ev } = await supabase.from("events").select("*").eq("id", id).single();
      const { data: regs } = await supabase.from("event_registrations").select("user_email, full_name, stream, utm_source, joined").eq("event_id", id);
      const { data: q } = await supabase.rpc("email_sent_last_24h");
      if (!active) return;
      setEvent((ev as EventRow) ?? null);
      const seen = new Set<string>(); const list: Recip[] = [];
      for (const r of (regs ?? []) as { user_email: string; full_name: string; stream: string; utm_source: string; joined: boolean }[]) {
        const email = (r.user_email || "").trim(); if (!email || seen.has(email)) continue; seen.add(email);
        list.push({ email, name: r.full_name || "", stream: r.stream || "", source: r.utm_source || "", attended: !!r.joined });
      }
      setRecips(list);
      setQuota(typeof q === "number" ? q : null);
      loadTpls();
    })();
    return () => { active = false; };
  }, [id, supabase]);

  const bodyHtml = useMemo(() =>
    topImageHtml(image) + messageToHtml(message || "") + buttons.filter((b) => b.label && b.url).map((b) => ctaButton(b.label, b.url)).join(""),
  [image, message, buttons]);
  const liveHtml = useMemo(() => campaignShell(bodyHtml || "<p style='color:#999'>Your message preview appears here…</p>", template), [bodyHtml, template]);
  const [previewHtml, setPreviewHtml] = useState("");
  useEffect(() => { const t = setTimeout(() => setPreviewHtml(liveHtml), 350); return () => clearTimeout(t); }, [liveHtml]);

  // filtered recipients (multi-term, comma-separated, ! to exclude; OR match across fields)
  const filtered = useMemo(() => {
    const terms = search.toLowerCase().split(",").map((t) => t.trim()).filter(Boolean);
    const inc = terms.filter((t) => !t.startsWith("!"));
    const exc = terms.filter((t) => t.startsWith("!")).map((t) => t.slice(1)).filter(Boolean);
    return recips.filter((r) => {
      if (attendedOnly && !r.attended) return false;
      const hay = `${r.name} ${r.email} ${r.stream} ${r.source} ${r.attended ? "attended" : ""}`.toLowerCase();
      if (exc.some((e) => hay.includes(e))) return false;
      if (inc.length === 0) return true;
      return inc.some((t) => hay.includes(t));
    });
  }, [recips, search, attendedOnly]);

  const toggle = (email: string) => setSelected((s) => { const n = new Set(s); n.has(email) ? n.delete(email) : n.add(email); return n; });
  const selectAllFiltered = () => setSelected((s) => { const n = new Set(s); filtered.forEach((r) => n.add(r.email)); return n; });
  const clearSel = () => setSelected(new Set());
  const selectedEmails = useMemo(() => recips.filter((r) => selected.has(r.email)).map((r) => r.email), [recips, selected]);

  function applyTpl(t: Tpl) { setTemplate((t.template_style as EmailTemplate) || "brand"); setSubject(t.subject || ""); setMessage(t.message || ""); setImage(t.image || ""); setButtons(Array.isArray(t.buttons) ? t.buttons : []); }
  async function saveTpl() {
    if (!tplName.trim()) return;
    setSavingTpl(true);
    await supabase.from("email_templates").insert({ name: tplName.trim(), subject, message, template_style: template, image: image || null, buttons });
    setTplName(""); setSavingTpl(false); loadTpls();
  }
  async function delTpl(tid: string) { if (confirm("Delete this template?")) { await supabase.from("email_templates").delete().eq("id", tid); loadTpls(); } }

  async function uploadImage(file: File) {
    setUploadErr(null); setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `campaign/${id}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("email-images").upload(path, file, { cacheControl: "3600", upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from("email-images").getPublicUrl(path);
      setImage(data.publicUrl);
    } catch (e) { setUploadErr((e as Error)?.message || "Upload failed — check the email-images bucket exists."); }
    finally { setUploading(false); }
  }

  async function send() {
    if (!subject.trim() || !message.trim() || selectedEmails.length === 0) return;
    setSending(true); setResult(null);
    const { data: s } = await supabase.auth.getSession();
    const accessToken = s.session?.access_token;
    let sent = 0, failed = 0;
    for (let i = 0; i < selectedEmails.length; i += BATCH) {
      const batch = selectedEmails.slice(i, i + BATCH);
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
        <span className="font-mono text-xs text-muted">Sending to {selectedEmails.length} of {recips.length}{quota != null ? ` · ${quota} sent in 24h` : ""}</span>
      </div>

      {/* saved templates bar */}
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface p-3">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-wide text-accent">Templates</span>
        <select onChange={(e) => { const t = tpls.find((x) => x.id === e.target.value); if (t) applyTpl(t); }} defaultValue="" className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none">
          <option value="">Load a saved template…</option>
          {tpls.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <input value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="Name to save current as…" className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none" />
          <button onClick={saveTpl} disabled={savingTpl || !tplName.trim()} className="rounded-lg bg-brand-gradient px-3.5 py-1.5 text-sm font-semibold text-white disabled:opacity-50">Save</button>
        </div>
        {tpls.length > 0 && (
          <div className="w-full border-t border-border pt-2">
            <div className="flex flex-wrap gap-1.5">
              {tpls.map((t) => (
                <span key={t.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 font-mono text-[11px] text-muted">
                  <button onClick={() => applyTpl(t)} className="hover:text-foreground">{t.name}</button>
                  <button onClick={() => delTpl(t.id)} className="text-red-400 hover:text-red-500">✕</button>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_420px] lg:items-start">
        <div className="space-y-4">
          {/* recipient picker */}
          <div className="rounded-2xl border border-border bg-surface p-3">
            <div className="flex flex-wrap items-center gap-2">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search names/emails · comma-separate · ! to exclude" className={field + " flex-1"} />
              <label className="flex items-center gap-1.5 font-mono text-xs text-muted"><input type="checkbox" checked={attendedOnly} onChange={(e) => setAttendedOnly(e.target.checked)} className="h-4 w-4 accent-[color:rgb(var(--accent))]" />attended only</label>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button onClick={selectAllFiltered} className="rounded-lg border border-border-strong px-2.5 py-1 font-mono text-[11px] text-muted hover:text-foreground">Select all filtered ({filtered.length})</button>
              <button onClick={clearSel} className="rounded-lg border border-border-strong px-2.5 py-1 font-mono text-[11px] text-muted hover:text-foreground">Clear</button>
              <span className="ml-auto font-mono text-[11px] font-semibold text-heading">{selected.size} selected</span>
            </div>
            <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-border">
              {filtered.length === 0 ? <p className="p-3 text-center font-body text-xs text-muted">No matches</p> : filtered.map((r) => (
                <label key={r.email} className={["flex cursor-pointer items-center gap-2 border-b border-border px-3 py-1.5 text-sm last:border-0", selected.has(r.email) ? "bg-surface-warm" : ""].join(" ")}>
                  <input type="checkbox" checked={selected.has(r.email)} onChange={() => toggle(r.email)} className="h-4 w-4 accent-[color:rgb(var(--accent))]" />
                  <span className="min-w-0 flex-1 truncate text-foreground">{r.name || r.email} <span className="text-muted">· {r.email}</span></span>
                  {r.stream && <span className="shrink-0 font-mono text-[10px] text-muted">{r.stream}</span>}
                  {r.attended && <span className="shrink-0 font-mono text-[10px] text-[#12703f]">✓</span>}
                </label>
              ))}
            </div>
          </div>

          <div>
            <span className="mb-1.5 block font-body text-xs font-semibold text-foreground">Background template</span>
            <div className="flex flex-wrap gap-2">
              {EMAIL_TEMPLATES.map((t) => (
                <button key={t.key} onClick={() => setTemplate(t.key)}
                  className={["rounded-lg px-3.5 py-2 font-mono text-xs font-semibold transition-colors",
                    template === t.key ? "bg-brand-gradient text-white" : "border border-border-strong bg-surface text-muted hover:text-foreground"].join(" ")}>{t.label}</button>
              ))}
            </div>
          </div>

          <label className="block"><span className="mb-1.5 block font-body text-xs font-semibold text-foreground">Subject</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className={field} /></label>

          <div>
            <span className="mb-1.5 block font-body text-xs font-semibold text-foreground">Top image <span className="font-normal text-muted">(optional)</span></span>
            <div className="flex flex-wrap items-center gap-2">
              <label className="cursor-pointer rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm font-semibold text-foreground hover:bg-surface-warm">{uploading ? "Uploading…" : "Upload image"}
                <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(f); }} /></label>
              <span className="font-mono text-xs text-muted">or URL:</span>
              <input value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://…/banner.png" className={field + " flex-1"} />
            </div>
            {image && <div className="mt-2 flex items-center gap-2"><span className="truncate font-mono text-[11px] text-muted">{image}</span><button onClick={() => setImage("")} className="font-mono text-[11px] text-accent hover:underline">clear</button></div>}
            {uploadErr && <p className="mt-1 font-body text-xs text-red-500">{uploadErr}</p>}
          </div>

          <label className="block"><span className="mb-1.5 block font-body text-xs font-semibold text-foreground">Message</span>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={7}
              placeholder={"Hi there,\n\nA quick reminder…\n\n(Plain text becomes paragraphs. HTML allowed.)"} className={field + " font-mono"} /></label>

          <div>
            <div className="mb-1.5 flex items-center justify-between"><span className="font-body text-xs font-semibold text-foreground">Buttons</span>
              <button onClick={() => setButtons((b) => [...b, { label: "", url: "" }])} className="font-mono text-xs text-accent hover:underline">+ add button</button></div>
            <div className="space-y-2">
              {buttons.length === 0 && <p className="font-body text-xs text-muted">No buttons yet.</p>}
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
          <button onClick={send} disabled={sending || !subject.trim() || !message.trim() || selectedEmails.length === 0}
            className="rounded-xl bg-brand-gradient px-6 py-3 text-sm font-semibold text-white disabled:opacity-60">
            {sending ? "Sending…" : `Send to ${selectedEmails.length}`}
          </button>
          <p className="font-body text-xs text-muted">Sends in batches of {BATCH}. Pick recipients above — nobody is selected by default.</p>
        </div>

        <div className="lg:sticky lg:top-20">
          <span className="mb-1.5 block font-mono text-xs font-semibold uppercase tracking-wide text-muted">Live preview</span>
          <div className="overflow-hidden rounded-2xl border border-border"><iframe title="Email preview" srcDoc={previewHtml} className="h-[560px] w-full bg-white" /></div>
        </div>
      </div>
    </div>
  );
}
