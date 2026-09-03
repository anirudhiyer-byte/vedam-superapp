"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CommsBroadcast } from "@/components/admin/comms-broadcast";
import { EventReminders } from "@/components/admin/event-reminders";
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
  const [tab, setTab] = useState<"templates" | "broadcast" | "automations" | "spend">("templates");
  const [tplMode, setTplMode] = useState<"tag" | "build">("tag");

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
    <div className="mx-auto max-w-4xl px-6 py-10">
      <span className="font-mono text-xs font-semibold lowercase tracking-[0.12em] text-accent">// comms hub</span>
      <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-heading">Communications</h1>

      {/* channel toggle */}
      <div className="mt-4 inline-flex rounded-full border border-border bg-surface p-1">
        <button onClick={() => setChannel("whatsapp")} className={["rounded-full px-4 py-1.5 font-mono text-xs font-bold", channel === "whatsapp" ? "bg-heading text-white" : "text-muted"].join(" ")} style={channel === "whatsapp" ? { background: "rgb(var(--heading))" } : undefined}>💬 WhatsApp</button>
        <button onClick={() => setChannel("email")} className={["rounded-full px-4 py-1.5 font-mono text-xs font-bold", channel === "email" ? "bg-heading text-white" : "text-muted"].join(" ")} style={channel === "email" ? { background: "rgb(var(--heading))" } : undefined}>✉️ Email</button>
      </div>

      {/* product switcher */}
      <div className="mt-3 flex flex-wrap gap-2">
        {PRODUCTS.map((p) => (
          <button key={p.key} onClick={() => setProduct(p.key)} className={["rounded-xl border px-3.5 py-2 text-xs font-extrabold", product === p.key ? "border-[color:rgb(var(--accent))] bg-surface-warm text-foreground" : "border-border-strong bg-surface text-muted"].join(" ")}>{p.icon} {p.label}</button>
        ))}
      </div>

      {/* sub-tabs */}
      <div className="mt-4 inline-flex gap-1 rounded-lg bg-surface-warm p-1">
        {(["templates", "broadcast", "automations", "spend"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={["rounded-md px-3 py-1.5 text-xs font-bold capitalize", tab === t ? "bg-surface text-foreground shadow-sm" : "text-muted"].join(" ")}>{t}</button>
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
      ) : tab === "broadcast" ? (
        <CommsBroadcast channel={channel} product={product} />
      ) : tab === "automations" ? (
        <div className="mt-4">
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
      ) : (
        <div className="mt-6 rounded-2xl border border-dashed border-border-strong bg-surface-warm/40 p-8 text-center">
          <p className="font-display text-lg font-bold text-heading capitalize">{tab} — {pill(product === "all" ? "general" : product)}</p>
          <p className="mt-1 font-body text-sm text-muted">The product-scoped {tab} (filters + full ticklist + preview) is being built in the next stages. Templates tagging is live now.</p>
        </div>
      )}
    </div>
  );
}
