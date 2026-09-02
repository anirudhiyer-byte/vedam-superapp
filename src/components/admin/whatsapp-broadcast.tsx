"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Tpl = { id?: string; name?: string; status?: string; placeholder?: { bodyvar?: number; header?: number } };
type Aud = { id: string; name: string; phone: string; state: string | null; city: string | null };
type VarMap = { source: "static" | "name" | "state" | "city" | "phone"; value: string };
const FIELDS: Record<string, (a: Aud) => string> = { name: (a) => a.name, state: (a) => a.state || "", city: (a) => a.city || "", phone: (a) => a.phone };
const BATCH = 40;

export function WhatsAppBroadcast() {
  const [supabase] = useState(() => createClient());
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [aud, setAud] = useState<Aud[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [messageType, setMessageType] = useState("text");
  const [headerVal, setHeaderVal] = useState("");
  const [varMaps, setVarMaps] = useState<VarMap[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const selTpl = useMemo(() => tpls.find((t) => (t.name || t.id) === templateId), [tpls, templateId]);
  const bodyVarCount = selTpl?.placeholder?.bodyvar ?? 0;
  const hasHeaderVar = (selTpl?.placeholder?.header ?? 0) > 0;

  useEffect(() => {
    (async () => {
      try { const r = await fetch("/api/whatsapp/templates"); const j = await r.json(); const raw = j?.data;
        const list = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : Array.isArray(raw?.templates) ? raw.templates : Array.isArray(raw?.result) ? raw.result : [];
        setTpls((list as Tpl[]).filter((t) => (t.status || "APPROVED").toUpperCase() === "APPROVED")); } catch { /* */ }
      const { data } = await supabase.rpc("wa_audience"); setAud((data as Aud[]) ?? []);
    })();
  }, [supabase]);

  useEffect(() => { setVarMaps(Array.from({ length: bodyVarCount }, (_, i) => varMaps[i] || { source: "static", value: "" })); /* eslint-disable-next-line */ }, [bodyVarCount]);

  const filtered = useMemo(() => {
    const terms = search.toLowerCase().split(",").map((t) => t.trim()).filter(Boolean);
    const inc = terms.filter((t) => !t.startsWith("!")); const exc = terms.filter((t) => t.startsWith("!")).map((t) => t.slice(1)).filter(Boolean);
    return aud.filter((a) => { const hay = `${a.name} ${a.phone} ${a.state ?? ""} ${a.city ?? ""}`.toLowerCase();
      if (exc.some((e) => hay.includes(e))) return false; if (inc.length === 0) return true; return inc.some((t) => hay.includes(t)); });
  }, [aud, search]);

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAll = () => setSelected((s) => { const n = new Set(s); filtered.forEach((a) => n.add(a.id)); return n; });
  const selectedAud = useMemo(() => aud.filter((a) => selected.has(a.id)), [aud, selected]);

  function sampleFor(a: Aud) {
    const bodyvar = varMaps.map((m) => m.source === "static" ? m.value : (FIELDS[m.source]?.(a) ?? ""));
    const sample: { header?: string; bodyvar?: string[] } = {};
    if (hasHeaderVar && headerVal.trim()) sample.header = headerVal.trim();
    if (bodyvar.length) sample.bodyvar = bodyvar;
    return Object.keys(sample).length ? sample : undefined;
  }

  async function send() {
    if (!templateId || selectedAud.length === 0) return;
    setSending(true); setResult(null);
    let sent = 0, failed = 0;
    for (let i = 0; i < selectedAud.length; i += BATCH) {
      const batch = selectedAud.slice(i, i + BATCH).map((a) => ({ to: a.phone, sample: sampleFor(a) }));
      try {
        const res = await fetch("/api/whatsapp/broadcast", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ templateId, messageType, recipients: batch }) });
        const j = await res.json(); if (j.ok) { sent += j.sent || 0; failed += j.failed || 0; } else failed += batch.length;
      } catch { failed += batch.length; }
      setResult(`Sending… ${sent + failed}/${selectedAud.length}`);
    }
    setSending(false); setResult(`Done — ${sent} sent${failed ? `, ${failed} failed` : ""}.`);
  }

  const field = "w-full rounded-lg border border-border-strong bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-[color:rgb(var(--accent))]";
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <span className="font-mono text-xs font-semibold lowercase tracking-[0.12em] text-accent">// whatsapp · broadcast</span>
      <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-heading">WhatsApp broadcast</h1>
      <p className="mt-1 font-body text-sm text-muted">Send an approved template to a chosen slice of the Vedam One audience.</p>

      <div className="mt-6 space-y-4 rounded-2xl border border-border bg-surface p-5">
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="mb-1.5 block font-body text-xs font-semibold text-foreground">Approved template</span>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={field}>
              <option value="">Select…</option>
              {tpls.map((t, i) => <option key={i} value={t.name || t.id}>{t.name || t.id}{t.placeholder?.bodyvar ? ` · ${t.placeholder.bodyvar} var` : ""}</option>)}
            </select></label>
          <label className="block"><span className="mb-1.5 block font-body text-xs font-semibold text-foreground">message_type</span>
            <select value={messageType} onChange={(e) => setMessageType(e.target.value)} className={field}>
              <option value="text">text</option><option value="text_var">text_var</option><option value="media">media</option><option value="media_var">media_var</option>
            </select></label>
        </div>

        {hasHeaderVar && <label className="block"><span className="mb-1.5 block font-body text-xs font-semibold text-foreground">Header value</span>
          <input value={headerVal} onChange={(e) => setHeaderVal(e.target.value)} placeholder="image URL or text" className={field} /></label>}

        {varMaps.length > 0 && (
          <div className="rounded-xl border border-dashed border-border-strong p-3">
            <span className="mb-2 block font-body text-xs font-semibold text-foreground">Body variables → map each {"{{n}}"}</span>
            <div className="space-y-2">
              {varMaps.map((m, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-10 font-mono text-xs text-muted">{`{{${i + 1}}}`}</span>
                  <select value={m.source} onChange={(e) => setVarMaps((v) => v.map((x, j) => j === i ? { ...x, source: e.target.value as VarMap["source"] } : x))} className={field + " w-32"}>
                    <option value="static">Static text</option><option value="name">Recipient name</option><option value="state">State</option><option value="city">City</option><option value="phone">Phone</option>
                  </select>
                  {m.source === "static" && <input value={m.value} onChange={(e) => setVarMaps((v) => v.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} placeholder="value" className={field + " flex-1"} />}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* audience picker */}
      <div className="mt-4 rounded-2xl border border-border bg-surface p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name/phone/state/city · comma-separate · ! exclude" className={field + " flex-1"} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button onClick={selectAll} className="rounded-lg border border-border-strong px-2.5 py-1 font-mono text-[11px] text-muted hover:text-foreground">Select all filtered ({filtered.length})</button>
          <button onClick={() => setSelected(new Set())} className="rounded-lg border border-border-strong px-2.5 py-1 font-mono text-[11px] text-muted hover:text-foreground">Clear</button>
          <span className="ml-auto font-mono text-[11px] font-semibold text-heading">{selected.size} selected · of {aud.length}</span>
        </div>
        <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border">
          {filtered.length === 0 ? <p className="p-3 text-center font-body text-xs text-muted">No audience with a phone number yet.</p> : filtered.slice(0, 500).map((a) => (
            <label key={a.id} className={["flex cursor-pointer items-center gap-2 border-b border-border px-3 py-1.5 text-sm last:border-0", selected.has(a.id) ? "bg-surface-warm" : ""].join(" ")}>
              <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} className="h-4 w-4 accent-[color:rgb(var(--accent))]" />
              <span className="min-w-0 flex-1 truncate text-foreground">{a.name} <span className="text-muted">· {a.phone}</span></span>
              {a.state && <span className="shrink-0 font-mono text-[10px] text-muted">{a.state}</span>}
            </label>
          ))}
        </div>
      </div>

      {result && <p className="mt-4 font-body text-sm text-foreground">{result}</p>}
      <button onClick={send} disabled={sending || !templateId || selected.size === 0} className="mt-4 rounded-xl bg-brand-gradient px-6 py-3 text-sm font-semibold text-white disabled:opacity-60">
        {sending ? "Sending…" : `Send to ${selected.size}`}
      </button>
      <p className="mt-2 font-body text-xs text-muted">Each recipient gets the template with their mapped variables. Sends in batches of {BATCH}. Only approved templates appear.</p>
    </div>
  );
}
