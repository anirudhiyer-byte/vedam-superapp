"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CommsBroadcast } from "@/components/admin/comms-broadcast";
import { CampaignReport } from "@/components/admin/campaign-report";
import { AdvancedAudience } from "@/components/admin/advanced-audience";
import { EventReminders } from "@/components/admin/event-reminders";
import { ReminderNow } from "@/components/admin/reminder-now";
import { CommsJourneys } from "@/components/admin/comms-journeys";
import { WhatsAppTemplateBuilder } from "@/components/admin/whatsapp-template-builder";
import { EmailTemplateComposer } from "@/components/admin/email-template-composer";

type Channel = "whatsapp" | "email";
type Product = "all" | "events" | "codesprint" | "college_predictor" | "general";
const PRODUCTS: { key: Product; label: string; icon: string }[] = [
  { key: "all", label: "All", icon: "📚" },
  { key: "events", label: "Events", icon: "📅" },
  { key: "codesprint", label: "CodeSprint", icon: "🚀" },
  { key: "college_predictor", label: "College Predictor", icon: "🎓" },
  { key: "general", label: "General", icon: "🌐" },
];
const TAGS = PRODUCTS.filter((p) => p.key !== "all");

type WaTpl = { id?: string; name?: string; status?: string; placeholder?: { bodyvar?: number } };
type EmTpl = { id: string; name: string; product: string };
type Tagged = { channel: string; template_ref: string; product: string };

export function CommsHub() {
  const [supabase] = useState(() => createClient());
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [product, setProduct] = useState<Product>("all");
  const [tab, setTab] = useState<"campaigns" | "automations" | "reminders" | "report" | "templates">("campaigns");
  const [tplMode, setTplMode] = useState<"tag" | "build">("tag");
  const [advRecips, setAdvRecips] = useState<{ user_id: string; email: string | null; phone: string | null; full_name: string | null }[] | null>(null);

  const [waTpls, setWaTpls] = useState<WaTpl[]>([]);
  const [emTpls, setEmTpls] = useState<EmTpl[]>([]);
  const [tags, setTags] = useState<Record<string, string>>({}); // ref -> product (whatsapp)
  const [events, setEvents] = useState<{ id: string; name: string }[]>([]);
  const [pickedEvent, setPickedEvent] = useState("");

  async function loadTags() {
    const { data } = await supabase.from("comms_template_tags").select("channel, template_ref, product").eq("channel", "whatsapp");
    const m: Record<string, string> = {}; (data as Tagged[] ?? []).forEach((t) => { m[t.template_ref] = t.product; }); setTags(m);
  }
  async function load() {
    if (channel === "whatsapp") {
      try { const r = await fetch("/api/whatsapp/templates"); const j = await r.json(); const raw = j?.data;
        const list = Array.isArray(raw) ? raw : Array.isArray(raw?.templates) ? raw.templates : Array.isArray(raw?.data) ? raw.data : [];
        setWaTpls(list as WaTpl[]); } catch { /* */ }
      loadTags();
    } else {
      const { data } = await supabase.from("email_templates").select("id, name, product").order("created_at", { ascending: false });
      setEmTpls((data as EmTpl[]) ?? []);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [channel]);
  useEffect(() => { supabase.from("events").select("id, name").order("starts_at", { ascending: false }).limit(50).then(({ data }) => setEvents((data as { id: string; name: string }[]) ?? [])); }, [supabase]);

  async function tagWa(ref: string, p: string) {
    setTags((t) => ({ ...t, [ref]: p }));
    await supabase.from("comms_template_tags").upsert({ channel: "whatsapp", template_ref: ref, product: p, updated_at: new Date().toISOString() });
  }
  async function tagEm(id: string, p: string) {
    setEmTpls((ts) => ts.map((t) => t.id === id ? { ...t, product: p } : t));
    await supabase.from("email_templates").update({ product: p }).eq("id", id);
  }

  const waFiltered = useMemo(() => waTpls.filter((t) => product === "all" || (tags[t.name || t.id || ""] || "general") === product), [waTpls, tags, product]);
  const emFiltered = useMemo(() => emTpls.filter((t) => product === "all" || (t.product || "general") === product), [emTpls, product]);

  const field = "rounded-lg border border-border-strong bg-background px-2.5 py-1.5 text-sm text-foreground outline-none";
  const pill = (p: string) => { const t = TAGS.find((x) => x.key === p); return t ? `${t.icon} ${t.label}` : p; };

  return (
    <div className="neural-glass relative min-h-screen" style={{ background: "#070a16", color: "#f2f5ff" }}>
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(760px 440px at 85% -6%, rgba(139,92,246,.14), transparent 60%), radial-gradient(620px 420px at -6% 108%, rgba(34,211,238,.09), transparent 60%)" }} />
      <div className="relative mx-auto max-w-5xl px-6 py-10">
      <span className="font-mono text-xs font-semibold lowercase tracking-[0.12em]" style={{ color: "#a78bfa" }}>// comms hub</span>
      <h1 className="mt-2 text-4xl font-bold tracking-tight" style={{ fontFamily: "var(--font-outfit), system-ui, sans-serif", background: "linear-gradient(92deg,#8b5cf6,#c4b5fd 85%)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", filter: "drop-shadow(0 0 26px rgba(139,92,246,.25))" }}>Communications</h1>

      {/* channel toggle */}
      <div className="mt-4 inline-flex rounded-full border border-border bg-surface p-1">
        {(["whatsapp", "email"] as const).map((c) => (
          <button key={c} onClick={() => setChannel(c)}
            className="rounded-full px-5 py-1.5 font-mono text-xs font-bold transition-colors"
            style={channel === c ? { background: "linear-gradient(90deg,#8b5cf6,#6d4bd6)", color: "#fff", boxShadow: "0 8px 22px -12px rgba(139,92,246,.8)" } : { color: "#aeb8e0" }}>
            {c === "whatsapp" ? "WhatsApp" : "Email"}
          </button>
        ))}
      </div>

      {/* product switcher */}
      <div className="mt-3 flex flex-wrap gap-2">
        {PRODUCTS.map((p) => (
          <button key={p.key} onClick={() => setProduct(p.key)} className={["rounded-xl border px-3.5 py-2 text-xs font-extrabold", product === p.key ? "border-[color:rgb(var(--accent))] bg-surface-warm text-foreground" : "border-border-strong bg-surface text-muted"].join(" ")}>{p.icon} {p.label}</button>
        ))}
      </div>

      {/* sub-tabs */}
      <div className="mt-4 inline-flex gap-1 rounded-lg border border-border bg-surface p-1">
        {(["campaigns","automations","reminders","report","templates"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className="rounded-md px-3.5 py-1.5 text-xs font-bold capitalize transition-colors"
            style={tab === t ? { background: "rgba(139,92,246,.18)", color: "#f2f5ff", boxShadow: "inset 0 0 0 1px rgba(139,92,246,.35)" } : { color: "#aeb8e0" }}>{t}</button>
        ))}
      </div>

      {tab === "templates" ? (
        <div className="mt-5">
          <div className="mb-3 inline-flex gap-1 rounded-lg bg-surface-warm p-1">
            <button onClick={() => setTplMode("tag")} className={["rounded-md px-3 py-1.5 text-xs font-bold", tplMode === "tag" ? "bg-surface text-foreground shadow-sm" : "text-muted"].join(" ")}>Tag existing</button>
            <button onClick={() => setTplMode("build")} className={["rounded-md px-3 py-1.5 text-xs font-bold", tplMode === "build" ? "bg-surface text-foreground shadow-sm" : "text-muted"].join(" ")}>+ Build new</button>
          </div>
          {tplMode === "build" ? (
            channel === "whatsapp" ? <WhatsAppTemplateBuilder /> : <EmailTemplateComposer product={product === "all" ? "general" : product} onSaved={load} />
          ) : (
          <>
          <p className="mb-3 font-body text-sm text-muted">Tag each template with the product it belongs to. Tagged templates surface in that product's Broadcast &amp; Automations.</p>
          <div className="space-y-2">
            {channel === "whatsapp" ? (
              waFiltered.length === 0 ? <p className="font-body text-sm text-muted">No templates{product !== "all" ? ` tagged “${pill(product)}”` : ""}.</p> :
              waFiltered.map((t, i) => {
                const ref = t.name || t.id || "";
                return (
                  <div key={i} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-2.5">
                    <span className="flex-1 font-body text-sm font-semibold text-heading">{t.name}{t.placeholder?.bodyvar ? <span className="ml-2 font-mono text-[11px] text-muted">{t.placeholder.bodyvar} var</span> : null}</span>
                    {t.status && <span className={["rounded-full px-2 py-0.5 font-mono text-[10px] font-bold", t.status.toUpperCase() === "APPROVED" ? "bg-[#eafaf0] text-[#12703f]" : "bg-[#fff6ec] text-[#7a5a2a]"].join(" ")}>{t.status.toUpperCase()}</span>}
                    <select value={tags[ref] || "general"} onChange={(e) => tagWa(ref, e.target.value)} className={field}>{TAGS.map((p) => <option key={p.key} value={p.key}>{p.icon} {p.label}</option>)}</select>
                  </div>
                );
              })
            ) : (
              emFiltered.length === 0 ? <p className="font-body text-sm text-muted">No email templates{product !== "all" ? ` tagged “${pill(product)}”` : ""}. Create them in the emailer.</p> :
              emFiltered.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-2.5">
                  <span className="flex-1 font-body text-sm font-semibold text-heading">{t.name}</span>
                  <select value={t.product || "general"} onChange={(e) => tagEm(t.id, e.target.value)} className={field}>{TAGS.map((p) => <option key={p.key} value={p.key}>{p.icon} {p.label}</option>)}</select>
                </div>
              ))
            )}
          </div>
          </>
          )}
        </div>
      ) : tab === "campaigns" ? (
        <div className="space-y-4">
          <details className="rounded-2xl border border-border">
            <summary className="cursor-pointer px-4 py-3 font-body text-sm font-semibold text-heading">Advanced audience builder (optional) ▾</summary>
            <div className="border-t border-border p-4"><AdvancedAudience onResolved={setAdvRecips} /></div>
          </details>
          {advRecips && advRecips.length > 0 && <div className="rounded-lg border border-accent/40 bg-surface px-3 py-2 font-body text-xs text-heading">Using <b>{advRecips.length}</b> recipients from the advanced builder for the send below. <button onClick={() => setAdvRecips(null)} className="ml-2 font-semibold text-accent">clear</button></div>}
          <CommsBroadcast channel={channel} product={product} overrideRecipients={advRecips} />
        </div>
      ) : tab === "automations" ? (
        <div>
          <p className="mb-2 font-body text-sm font-semibold text-heading">Stage-based automations (if / else-if / else)</p>
          <CommsJourneys channel={channel} product={product} />
        </div>
      ) : tab === "reminders" ? (
        <div className="mt-4 space-y-4">
          <ReminderNow />
          {product === "events" && (
            <div className="mb-4 rounded-2xl border border-border bg-surface p-4">
              <p className="mb-2 font-body text-sm font-semibold text-heading">Per-event reminders (custom T− / T+)</p>
              <select value={pickedEvent} onChange={(e) => setPickedEvent(e.target.value)} className="rounded-lg border border-border-strong bg-background px-3 py-2 text-sm text-foreground outline-none"><option value="">Select an event…</option>{events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
              {pickedEvent && <div className="mt-2"><EventReminders eventId={pickedEvent} /></div>}
            </div>
          )}
          <p className="mb-2 font-body text-sm font-semibold text-heading">Journey automations (if / else-if / else)</p>
          <CommsJourneys channel={channel} product={product} />
        </div>
      ) : tab === "report" ? (
        <div className="mt-6"><CampaignReport /></div>
      ) : (
        <div className="mt-6 rounded-2xl border border-dashed border-border-strong bg-surface-warm/40 p-8 text-center">
          <p className="font-display text-lg font-bold text-heading capitalize">{tab} — {pill(product === "all" ? "general" : product)}</p>
          <p className="mt-1 font-body text-sm text-muted">This section is being built next.</p>
        </div>
      )}
      </div>
    </div>
  );
}
