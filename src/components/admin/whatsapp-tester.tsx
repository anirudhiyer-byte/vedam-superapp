"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Tpl = { id?: string; name?: string; status?: string; lang?: string; category?: string; placeholder?: { bodyvar?: number } };
type Send = { id: string; to_number: string; template_id: string; status: string; http_status: number; created_at: string };

export function WhatsAppTester() {
  const [supabase] = useState(() => createClient());
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [tplErr, setTplErr] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [messageType, setMessageType] = useState("text");
  const [sender, setSender] = useState("");
  const [sending, setSending] = useState(false);
  const [resp, setResp] = useState<string | null>(null);
  const [log, setLog] = useState<Send[]>([]);

  async function loadTemplates() {
    setTplErr(null);
    try {
      const r = await fetch("/api/whatsapp/templates");
      const j = await r.json();
      // provider shape unknown — try common containers
      const raw = j?.data;
      const list = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : Array.isArray(raw?.templates) ? raw.templates : Array.isArray(raw?.result) ? raw.result : [];
      setTpls(list as Tpl[]);
      if (!list.length) setTplErr("No templates parsed — check the raw response below when you send, or paste it to refine.");
    } catch { setTplErr("Couldn't fetch templates."); }
  }
  async function loadLog() { const { data } = await supabase.from("whatsapp_sends").select("id, to_number, template_id, status, http_status, created_at").order("created_at", { ascending: false }).limit(10); setLog((data as Send[]) ?? []); }
  useEffect(() => { loadTemplates(); loadLog(); /* eslint-disable-next-line */ }, []);

  async function send() {
    if (!to.trim() || !templateId.trim()) return;
    setSending(true); setResp(null);
    try {
      const r = await fetch("/api/whatsapp/send-test", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: to.trim(), templateId: templateId.trim(), messageType, sender: sender.trim() || undefined }),
      });
      const j = await r.json();
      setResp(JSON.stringify(j, null, 2));
    } catch (e) { setResp(String(e)); }
    setSending(false); loadLog();
  }

  const field = "w-full rounded-lg border border-border-strong bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-[color:rgb(var(--accent))]";
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <span className="font-mono text-xs font-semibold lowercase tracking-[0.12em] text-accent">// whatsapp · stage 1</span>
      <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-heading">WhatsApp tester</h1>
      <p className="mt-1 font-body text-sm text-muted">Send one real message via an approved template to confirm the pipe end-to-end.</p>

      <div className="mt-6 space-y-4 rounded-2xl border border-border bg-surface p-5">
        <label className="block"><span className="mb-1.5 block font-body text-xs font-semibold text-foreground">Approved template</span>
          {tpls.length > 0 ? (
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={field}>
              <option value="">Select a template…</option>
              {tpls.map((t, i) => <option key={i} value={t.name || t.id}>{(t.name || t.id)} {t.status ? `· ${t.status}` : ""} {t.placeholder?.bodyvar ? `· ${t.placeholder.bodyvar} var(s)` : "· 0 var"}</option>)}
            </select>
          ) : (
            <input value={templateId} onChange={(e) => setTemplateId(e.target.value)} placeholder="wearelive_jasbir14" className={field} />
          )}
          {tplErr && <p className="mt-1 font-body text-xs text-amber-600">{tplErr} <button onClick={loadTemplates} className="underline">retry</button></p>}
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="mb-1.5 block font-body text-xs font-semibold text-foreground">To (with country code)</span>
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="+919812345678" className={field} /></label>
          <label className="block"><span className="mb-1.5 block font-body text-xs font-semibold text-foreground">message_type</span>
            <select value={messageType} onChange={(e) => setMessageType(e.target.value)} className={field}>
              <option value="text">text</option><option value="media">media</option><option value="template">template</option>
            </select></label>
        </div>
        <label className="block"><span className="mb-1.5 block font-body text-xs font-semibold text-foreground">Sender <span className="font-normal text-muted">(blank = default env sender)</span></span>
          <input value={sender} onChange={(e) => setSender(e.target.value)} placeholder="+919289466254" className={field} /></label>

        <button onClick={send} disabled={sending || !to.trim() || !templateId.trim()} className="rounded-xl bg-brand-gradient px-6 py-3 text-sm font-semibold text-white disabled:opacity-60">{sending ? "Sending…" : "Send test WhatsApp"}</button>
      </div>

      {resp && (
        <div className="mt-4">
          <span className="mb-1.5 block font-mono text-xs font-semibold uppercase tracking-wide text-muted">Raw provider response</span>
          <pre className="overflow-x-auto rounded-xl border border-border bg-[#0e0a1c] p-4 font-mono text-xs text-[#c7f0d8]">{resp}</pre>
        </div>
      )}

      <div className="mt-6">
        <span className="mb-1.5 block font-mono text-xs font-semibold uppercase tracking-wide text-muted">Recent sends</span>
        <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {log.length === 0 ? <p className="p-4 font-body text-sm text-muted">No sends yet.</p> : log.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 font-mono text-xs">
              <span className={s.status === "sent" ? "text-[#12703f]" : "text-red-500"}>{s.status === "sent" ? "✓" : "✕"}</span>
              <span className="text-foreground">{s.to_number}</span>
              <span className="text-muted">{s.template_id}</span>
              <span className="ml-auto text-muted">HTTP {s.http_status} · {new Date(s.created_at).toLocaleString("en-IN")}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
