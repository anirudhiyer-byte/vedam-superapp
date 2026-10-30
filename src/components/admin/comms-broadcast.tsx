"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { renderEmailTemplateHtml } from "@/lib/email/render";
import { DarkSelect } from "@/components/admin/dark-select";

type Row = { id: string; name: string; phone: string | null; email: string | null; state: string | null; city: string | null; signup: string;
  events_reg: number; events_attended: number; cs_enrolled: boolean; cs_modules: number; cs_total: number; cp_used: boolean; points: number };
type WaTpl = { id?: string; name?: string; status?: string; placeholder?: { bodyvar?: number } };
type EmTpl = { id: string; name: string; subject: string | null; product: string; message: string | null; template_style: string | null; image: string | null; buttons: { label: string; url: string }[] | null };
type Product = "all" | "events" | "codesprint" | "college_predictor" | "general";
type DateCond = "any" | "after" | "before" | "between";

export function CommsBroadcast({ channel, product, overrideRecipients }: { channel: "whatsapp" | "email"; product: Product; overrideRecipients?: { user_id: string; email: string | null; phone: string | null; full_name: string | null }[] | null }) {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  // filters
  const [dateCond, setDateCond] = useState<DateCond>("any");
  const [d1, setD1] = useState(""); const [d2, setD2] = useState("");
  const [state, setState] = useState("");
  const [attend, setAttend] = useState<"" | "attended" | "noshow">("");
  const [csState, setCsState] = useState<"" | "enrolled" | "notenrolled" | "all_done" | "partial" | "none_done">("");
  const [cpUsed, setCpUsed] = useState<"" | "yes" | "no">("");

  // selection + template
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [waTpls, setWaTpls] = useState<WaTpl[]>([]); const [emTpls, setEmTpls] = useState<EmTpl[]>([]);
  const [tags, setTags] = useState<Record<string, string>>({});
  const [templateRef, setTemplateRef] = useState("");
  const [messageType, setMessageType] = useState("media");
  const [varMaps, setVarMaps] = useState<{ source: string; value: string }[]>([]);
  const [pvChannel, setPvChannel] = useState<"whatsapp" | "email">(channel);
  const [sending, setSending] = useState(false); const [result, setResult] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [campaignName, setCampaignName] = useState("");

  useEffect(() => { setPvChannel(channel); }, [channel]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("comms_audience"); setRows((data as Row[]) ?? []); setLoading(false);
      if (channel === "whatsapp") {
        const { data: tg } = await supabase.from("comms_template_tags").select("template_ref, product").eq("channel", "whatsapp");
        const m: Record<string, string> = {}; (tg as { template_ref: string; product: string }[] ?? []).forEach((t) => m[t.template_ref] = t.product); setTags(m);
        try { const r = await fetch("/api/whatsapp/templates"); const j = await r.json(); const raw = j?.data;
          const list = Array.isArray(raw) ? raw : Array.isArray(raw?.templates) ? raw.templates : Array.isArray(raw?.data) ? raw.data : [];
          setWaTpls((list as WaTpl[]).filter((t) => (t.status || "APPROVED").toUpperCase() === "APPROVED")); } catch { /* */ }
      } else {
        const { data: em } = await supabase.from("email_templates").select("id, name, subject, product, message, template_style, image, buttons").order("created_at", { ascending: false });
        setEmTpls((em as EmTpl[]) ?? []);
      }
    })();
  }, [supabase, channel]);

  const selVarCount = useMemo(() => channel === "whatsapp" ? (waTpls.find((t) => (t.name || t.id) === templateRef)?.placeholder?.bodyvar || 0) : 0, [channel, waTpls, templateRef]);
  useEffect(() => { setVarMaps((v) => Array.from({ length: selVarCount }, (_, i) => v[i] || { source: "static", value: "" })); }, [selVarCount]);
  const templates = useMemo(() => {
    if (channel === "whatsapp") return waTpls.filter((t) => product === "all" || (tags[t.name || t.id || ""] || "general") === product).map((t) => ({ ref: t.name || t.id || "", label: t.name || "", vars: t.placeholder?.bodyvar || 0 }));
    return emTpls.filter((t) => product === "all" || (t.product || "general") === product).map((t) => ({ ref: t.id, label: t.name, vars: 0 }));
  }, [channel, product, waTpls, emTpls, tags]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (channel === "whatsapp" ? !r.phone : !r.email) return false;
    if (dateCond !== "any" && r.signup) { const s = new Date(r.signup).getTime();
      if (dateCond === "after" && d1 && s < new Date(d1).getTime()) return false;
      if (dateCond === "before" && d1 && s > new Date(d1).getTime()) return false;
      if (dateCond === "between" && d1 && d2 && (s < new Date(d1).getTime() || s > new Date(d2 + "T23:59:59").getTime())) return false;
    }
    if (state.trim() && (r.state || "").toLowerCase() !== state.trim().toLowerCase()) return false;
    if (attend === "attended" && r.events_attended === 0) return false;
    if (attend === "noshow" && !(r.events_reg > 0 && r.events_attended === 0)) return false;
    if (csState === "enrolled" && !r.cs_enrolled) return false;
    if (csState === "notenrolled" && r.cs_enrolled) return false;
    if (csState === "all_done" && !(r.cs_total > 0 && r.cs_modules >= r.cs_total)) return false;
    if (csState === "partial" && !(r.cs_modules > 0 && r.cs_modules < r.cs_total)) return false;
    if (csState === "none_done" && !(r.cs_enrolled && r.cs_modules === 0)) return false;
    if (cpUsed === "yes" && !r.cp_used) return false;
    if (cpUsed === "no" && r.cp_used) return false;
    return true;
  }), [rows, channel, dateCond, d1, d2, state, attend, csState, cpUsed]);

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selAll = () => setSelected((s) => { const n = new Set(s); filtered.forEach((r) => n.add(r.id)); return n; });
  const selRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);
  const sendRows = useMemo(() => (overrideRecipients && overrideRecipients.length)
    ? overrideRecipients.map((r) => ({ id: r.user_id, name: r.full_name || "", email: r.email, phone: r.phone, state: null, city: null, points: 0, events_reg: 0, events_attended: 0, cs_enrolled: false, cs_modules: 0, cs_total: 0, cp_used: false } as Row))
    : selRows, [overrideRecipients, selRows]);
  const ov = Boolean(overrideRecipients && overrideRecipients.length);

  // re-arm the Send button when the template, channel, or recipient set changes
  useEffect(() => { setDone(false); setResult(null); }, [templateRef, channel, sendRows.length]);

  async function send() {
    if (!templateRef || sendRows.length === 0 || done) return;
    setSending(true); setResult(null); setDone(false);
    const audDesc = overrideRecipients ? "advanced audience" : [state && `state=${state}`, attend, csState, cpUsed && `cp=${cpUsed}`].filter(Boolean).join(", ");
    let campaignId: string | null = null;
    try { const { data: cid } = await supabase.rpc("campaign_create", { p_name: campaignName || `${channel} · ${new Date().toLocaleDateString()}`, p_channel: channel, p_kind: "campaign", p_product: product === "all" ? "global" : product, p_sub_ref: null, p_template: templateRef, p_source: overrideRecipients ? "advanced" : "simple", p_desc: audDesc, p_count: sendRows.length }); campaignId = (cid as string) || null; } catch { /* */ }
    if (channel === "whatsapp") {
      const F: Record<string, (r: Row) => string> = { name: (r) => r.name, state: (r) => r.state || "", city: (r) => r.city || "", points: (r) => String(r.points) };
      const recips = sendRows.filter((r) => r.phone).map((r) => ({ to: r.phone as string, sample: varMaps.length ? { bodyvar: varMaps.map((m) => m.source === "static" ? m.value : (F[m.source]?.(r) ?? "")) } : undefined }));
      let sent = 0, failed = 0;
      for (let i = 0; i < recips.length; i += 40) {
        const batch = recips.slice(i, i + 40);
        try { const res = await fetch("/api/whatsapp/broadcast", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateId: templateRef, messageType, recipients: batch, campaignId, campaignName }) });
          const j = await res.json(); if (j.ok) { sent += j.sent || 0; failed += j.failed || 0; } else failed += batch.length; } catch { failed += batch.length; }
      }
      setResult(`Done — ${sent} sent${failed ? `, ${failed} failed` : ""}.`); if (sent > 0 && failed === 0) setDone(true);
    } else {
      const tpl = emTpls.find((t) => t.id === templateRef);
      const emails = sendRows.filter((r) => r.email).map((r) => r.email as string);
      const { data: s } = await supabase.auth.getSession();
      let sent = 0, failed = 0;
      for (let i = 0; i < emails.length; i += 40) {
        const batch = emails.slice(i, i + 40);
        // Pass templateId so the server renders the saved template once (single header).
        // Rendering on the client and passing the full card as `body` double-wrapped it in campaignShell.
        try { const res = await fetch("/api/events/send-campaign", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject: tpl?.subject || "Vedam", body: tpl?.message || "<p>&nbsp;</p>", templateId: templateRef, recipients: batch, template: (tpl?.template_style || "brand"), accessToken: s.session?.access_token , campaignId, kind: "campaign", refName: campaignName}) });
          const j = await res.json(); if (j.ok) { sent += j.sent || 0; failed += j.failed || 0; } else failed += batch.length; } catch { failed += batch.length; }
      }
      setResult(`Done — ${sent} sent${failed ? `, ${failed} failed` : ""}.`); if (sent > 0 && failed === 0) setDone(true);
    }
    setSending(false);
  }

  const field = "rounded-lg border border-white/15 bg-white/[0.06] px-2.5 py-1.5 text-sm text-white outline-none transition-colors [color-scheme:dark] focus:border-[color:rgb(var(--accent))]";
  const yn = (b: boolean) => <span className={["rounded-full px-2 py-0.5 font-mono text-[9px] font-bold", b ? "bg-[#eafaf0] text-[#12703f]" : "bg-[#fdeded] text-[#a3271d]"].join(" ")}>{b ? "Yes" : "No"}</span>;

  if (loading) return <div className="mt-6 h-40 animate-pulse rounded-2xl border border-white/10 bg-white/[0.03]" />;

  return (
    <div className="mt-5 space-y-4 font-[family-name:var(--font-inter)] text-white">
      {/* template */}
      <div><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-white/55">Template ({product === "all" ? "all products" : product})</span>
        <div className="flex flex-wrap items-center gap-2">
          <DarkSelect className="w-full max-w-md" value={templateRef} placeholder="Select a template" onChange={setTemplateRef} options={templates.map((t) => ({ value: t.ref, label: `${t.label}${t.vars ? ` · ${t.vars} var` : ""}` }))} />
          {channel === "whatsapp" && <DarkSelect className="w-40" value={messageType} onChange={setMessageType} options={["media", "text", "text_var", "media_var"].map((v) => ({ value: v, label: v }))} />}
        </div>
        {selVarCount > 0 && (
          <div className="mt-2 rounded-xl border border-dashed border-white/15 p-3">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-white/55">Map {"{{n}}"} variables</span>
            {varMaps.map((m, i) => (
              <div key={i} className="mt-1.5 flex items-center gap-2">
                <span className="w-10 font-mono text-xs text-muted">{`{{${i + 1}}}`}</span>
                <DarkSelect className="w-40" value={m.source} onChange={(val) => setVarMaps((v) => v.map((x, j) => j === i ? { ...x, source: val } : x))} options={[{ value: "static", label: "Static text" }, { value: "name", label: "Recipient name" }, { value: "state", label: "State" }, { value: "city", label: "City" }, { value: "points", label: "Points" }]} />
                {m.source === "static" && <input value={m.value} onChange={(e) => setVarMaps((v) => v.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} placeholder="value" className={field + " flex-1"} />}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* filter bar — hidden when recipients come from an external selector (e.g. Product Users) */}
      {!ov && (
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface-warm/40 p-3">
        <label className="flex flex-col text-[11px] font-semibold text-muted">Signup<select value={dateCond} onChange={(e) => setDateCond(e.target.value as DateCond)} className={field + " mt-1"}><option value="any">Any time</option><option value="after">After</option><option value="before">Before</option><option value="between">Between</option></select></label>
        {dateCond !== "any" && <input type="date" value={d1} onChange={(e) => setD1(e.target.value)} className={field} />}
        {dateCond === "between" && <input type="date" value={d2} onChange={(e) => setD2(e.target.value)} className={field} />}
        <label className="flex flex-col text-[11px] font-semibold text-muted">State<input value={state} onChange={(e) => setState(e.target.value)} placeholder="all" className={field + " mt-1 w-24"} /></label>
        <label className="flex flex-col text-[11px] font-semibold text-muted">Attendance<select value={attend} onChange={(e) => setAttend(e.target.value as "" | "attended" | "noshow")} className={field + " mt-1"}><option value="">All</option><option value="attended">Attended</option><option value="noshow">No-show</option></select></label>
        <label className="flex flex-col text-[11px] font-semibold text-muted">CodeSprint<select value={csState} onChange={(e) => setCsState(e.target.value as typeof csState)} className={field + " mt-1"}><option value="">Any</option><option value="enrolled">Enrolled</option><option value="notenrolled">Not enrolled</option><option value="all_done">Completed all</option><option value="partial">Completed 1–2</option><option value="none_done">Enrolled, 0 done</option></select></label>
        <label className="flex flex-col text-[11px] font-semibold text-muted">CP<select value={cpUsed} onChange={(e) => setCpUsed(e.target.value as "" | "yes" | "no")} className={field + " mt-1"}><option value="">Any</option><option value="yes">Used</option><option value="no">Not used</option></select></label>
      </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_290px] lg:items-start">
        <div>
          {ov ? (<div className="mb-2 rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2.5 text-[13px] text-white/70">Sending to <b className="font-semibold text-white">{sendRows.length}</b> recipient{sendRows.length === 1 ? "" : "s"} selected in Product Users.</div>) : (<>
          <div className="mb-2 flex items-center gap-2"><button onClick={selAll} className="rounded-lg border border-border-strong px-2.5 py-1 font-mono text-[11px] text-muted">Select all filtered ({filtered.length})</button><button onClick={() => setSelected(new Set())} className="rounded-lg border border-border-strong px-2.5 py-1 font-mono text-[11px] text-muted">Clear</button><span className="ml-auto font-mono text-[11px] font-bold text-heading">{selected.size} selected</span></div>
          <div className="max-h-[360px] overflow-auto rounded-xl border border-border">
            <table className="w-full border-collapse whitespace-nowrap text-xs">
              <thead><tr className="sticky top-0 bg-surface-warm">{["", "Name", "Signup", "State", "City", channel === "whatsapp" ? "Phone" : "Email", "Events", "Att.", "CS", "Mod", "CP", "Pts"].map((h, i) => <th key={i} className="border-b border-border px-2.5 py-2 text-left font-mono text-[10px] uppercase text-muted">{h}</th>)}</tr></thead>
              <tbody>
                {filtered.slice(0, 400).map((r) => (
                  <tr key={r.id} className={selected.has(r.id) ? "bg-surface-warm" : ""}>
                    <td className="px-2.5 py-1.5"><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="h-4 w-4 accent-[color:rgb(var(--accent))]" /></td>
                    <td className="px-2.5 py-1.5 font-semibold text-heading">{r.name}</td>
                    <td className="px-2.5 py-1.5 text-muted">{r.signup ? new Date(r.signup).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : ""}</td>
                    <td className="px-2.5 py-1.5">{r.state || ""}</td><td className="px-2.5 py-1.5">{r.city || ""}</td>
                    <td className="px-2.5 py-1.5 text-muted">{channel === "whatsapp" ? r.phone : r.email}</td>
                    <td className="px-2.5 py-1.5 text-center">{r.events_reg}</td><td className="px-2.5 py-1.5">{yn(r.events_attended > 0)}</td>
                    <td className="px-2.5 py-1.5">{yn(r.cs_enrolled)}</td><td className="px-2.5 py-1.5 text-center">{r.cs_modules}/{r.cs_total}</td>
                    <td className="px-2.5 py-1.5">{yn(r.cp_used)}</td><td className="px-2.5 py-1.5 text-center font-mono">{r.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>)}
          {result && <p className="mt-3 text-sm text-white/85">{result}</p>}
          <label className="mt-3 block"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-white/55">Campaign name (for the report)</span>
            <input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="e.g. Bootcamp reminder — Spotify build" className="w-full max-w-md rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-sm text-white outline-none transition-colors [color-scheme:dark] placeholder:text-white/35 focus:border-[color:rgb(var(--accent))]" /></label>
          <button onClick={send} disabled={sending || done || !templateRef || sendRows.length === 0} className={["mt-3 rounded-xl px-6 py-3 text-sm font-semibold text-white transition-[filter] disabled:opacity-60", done ? "bg-emerald-600" : "bg-[color:rgb(var(--accent))] hover:brightness-110 disabled:opacity-50"].join(" ")}>{sending ? "Sending…" : done ? "Sent ✓" : `Send to ${sendRows.length} →`}</button>
        </div>

        {/* live preview */}
        <div className="lg:sticky lg:top-20">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-white/45">Live preview</span>
          <div className="mb-2 inline-flex rounded-full border border-white/10 bg-white/[0.05] p-0.5">
            <button onClick={() => setPvChannel("whatsapp")} aria-label="WhatsApp preview" className={["grid h-6 w-8 place-items-center rounded-full transition-colors", pvChannel === "whatsapp" ? "bg-[color:rgb(var(--accent))] text-white" : "text-white/50 hover:text-white/80"].join(" ")}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5"><path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.5L3 21l2-5.4A8.5 8.5 0 1 1 21 11.5z" /></svg></button>
            <button onClick={() => setPvChannel("email")} aria-label="Email preview" className={["grid h-6 w-8 place-items-center rounded-full transition-colors", pvChannel === "email" ? "bg-[color:rgb(var(--accent))] text-white" : "text-white/50 hover:text-white/80"].join(" ")}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg></button>
          </div>
          {pvChannel === "whatsapp" ? (
            <div className="rounded-2xl bg-[#E5DDD5] p-3"><div className="overflow-hidden rounded-xl bg-white shadow-sm">
              <div className="grid h-20 place-items-center bg-brand-gradient text-[11px] font-bold text-white">Header image</div>
              <div className="px-3 py-2 text-[12.5px] leading-relaxed">{templateRef ? `Preview of “${templates.find((t) => t.ref === templateRef)?.label}” with a sample recipient's variables.` : "Select a template to preview."}</div>
              <div className="border-t border-[#eee] py-2 text-center text-[12px] font-bold text-[#0a8]">Button</div>
            </div></div>
          ) : (
            channel === "email" && templateRef && emTpls.find((t) => t.id === templateRef) ? (
              <iframe title="Email preview" className="h-[420px] w-full rounded-2xl border border-border bg-white" srcDoc={renderEmailTemplateHtml(emTpls.find((t) => t.id === templateRef)!)} />
            ) : (
            <div className="rounded-2xl bg-[#eef] p-3"><div className="overflow-hidden rounded-xl border border-[#e5e5f0] bg-white">
              <div className="grid h-16 place-items-center bg-[linear-gradient(125deg,#2B135C,#8A18FF)] text-[12px] font-extrabold text-white">Vedam</div>
              <div className="p-3 text-[12.5px] leading-relaxed">Select an email template to preview.</div>
            </div></div>)
          )}
          <p className="mt-2 text-[11px] text-white/40">Preview reflects the selected template. Toggle channel to preview each.</p>
        </div>
      </div>
    </div>
  );
}
