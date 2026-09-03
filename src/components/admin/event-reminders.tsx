"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Rem = { id: string; name: string; channel: string; trigger_type: string; offset_minutes: number; template_id: string; enabled: boolean; conditions: { attended?: string } };
type WaTpl = { id?: string; name?: string; status?: string };
type EmTpl = { id: string; name: string };

export function EventReminders({ eventId }: { eventId: string }) {
  const [supabase] = useState(() => createClient());
  const [rems, setRems] = useState<Rem[]>([]);
  const [waTpls, setWaTpls] = useState<WaTpl[]>([]);
  const [emTpls, setEmTpls] = useState<EmTpl[]>([]);

  const [channel, setChannel] = useState<"whatsapp" | "email">("whatsapp");
  const [dir, setDir] = useState<"before" | "after">("before");
  const [d, setD] = useState(0); const [h, setH] = useState(1); const [m, setM] = useState(0);
  const [templateRef, setTemplateRef] = useState("");
  const [messageType, setMessageType] = useState("media");
  const [audience, setAudience] = useState<"" | "attended" | "noshow">("");
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.from("whatsapp_automations").select("*").eq("event_id", eventId).in("trigger_type", ["event_before", "event_after"]).order("offset_minutes");
    setRems((data as Rem[]) ?? []);
    const { data: em } = await supabase.from("email_templates").select("id, name").order("created_at", { ascending: false }); setEmTpls((em as EmTpl[]) ?? []);
    try { const r = await fetch("/api/whatsapp/templates"); const j = await r.json(); const raw = j?.data;
      const list = Array.isArray(raw) ? raw : Array.isArray(raw?.templates) ? raw.templates : Array.isArray(raw?.data) ? raw.data : [];
      setWaTpls((list as WaTpl[]).filter((t) => (t.status || "APPROVED").toUpperCase() === "APPROVED")); } catch { /* */ }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [eventId]);

  const templates = useMemo(() => channel === "whatsapp" ? waTpls.map((t) => ({ ref: t.name || t.id || "", label: t.name || "" })) : emTpls.map((t) => ({ ref: t.id, label: t.name })), [channel, waTpls, emTpls]);

  async function add() {
    setMsg(null);
    if (!templateRef) return setMsg("Pick a template.");
    const mins = d * 1440 + h * 60 + m;
    if (mins <= 0) return setMsg("Set a non-zero offset.");
    const label = `T${dir === "before" ? "−" : "+"} ${d ? d + "d " : ""}${h ? h + "h " : ""}${m ? m + "m" : ""}`.trim();
    const conditions: Record<string, string> = {}; if (audience) conditions.attended = audience === "attended" ? "yes" : "no";
    const { error } = await supabase.from("whatsapp_automations").insert({
      name: `${label} reminder`, channel, trigger_type: dir === "before" ? "event_before" : "event_after",
      event_id: eventId, offset_minutes: mins, template_id: templateRef, message_type: channel === "whatsapp" ? messageType : "email", conditions, variable_mapping: [],
    });
    if (error) return setMsg(error.message);
    setMsg("Reminder added."); load();
  }
  async function toggle(r: Rem) { await supabase.from("whatsapp_automations").update({ enabled: !r.enabled }).eq("id", r.id); load(); }
  async function del(id: string) { await supabase.from("whatsapp_automations").delete().eq("id", id); load(); }

  const field = "rounded-lg border border-border-strong bg-background px-2.5 py-1.5 text-sm text-foreground outline-none";
  const fmt = (r: Rem) => `T${r.trigger_type === "event_before" ? "−" : "+"} ${Math.floor(r.offset_minutes / 1440) ? Math.floor(r.offset_minutes / 1440) + "d " : ""}${Math.floor((r.offset_minutes % 1440) / 60) ? Math.floor((r.offset_minutes % 1440) / 60) + "h " : ""}${r.offset_minutes % 60 ? (r.offset_minutes % 60) + "m" : ""}`.trim();

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h2 className="font-display text-lg font-bold text-heading">Reminders for this event</h2>
      <p className="mt-1 font-body text-sm text-muted">Custom T− (before) / T+ (after) offsets, WhatsApp or Email. Fires automatically to this event&apos;s registrants.</p>

      <div className="mt-4 flex flex-wrap items-end gap-2 rounded-2xl border border-border bg-surface p-4">
        <label className="flex flex-col text-[11px] font-semibold text-muted">Channel<select value={channel} onChange={(e) => setChannel(e.target.value as "whatsapp" | "email")} className={field + " mt-1"}><option value="whatsapp">WhatsApp</option><option value="email">Email</option></select></label>
        <label className="flex flex-col text-[11px] font-semibold text-muted">When<select value={dir} onChange={(e) => setDir(e.target.value as "before" | "after")} className={field + " mt-1"}><option value="before">T− before</option><option value="after">T+ after</option></select></label>
        <label className="flex flex-col text-[11px] font-semibold text-muted">Days<input type="number" min={0} value={d} onChange={(e) => setD(+e.target.value)} className={field + " mt-1 w-16"} /></label>
        <label className="flex flex-col text-[11px] font-semibold text-muted">Hours<input type="number" min={0} value={h} onChange={(e) => setH(+e.target.value)} className={field + " mt-1 w-16"} /></label>
        <label className="flex flex-col text-[11px] font-semibold text-muted">Min<input type="number" min={0} value={m} onChange={(e) => setM(+e.target.value)} className={field + " mt-1 w-16"} /></label>
        <label className="flex flex-col text-[11px] font-semibold text-muted">Template<select value={templateRef} onChange={(e) => setTemplateRef(e.target.value)} className={field + " mt-1 max-w-[180px]"}><option value="">Select…</option>{templates.map((t) => <option key={t.ref} value={t.ref}>{t.label}</option>)}</select></label>
        <label className="flex flex-col text-[11px] font-semibold text-muted">Audience<select value={audience} onChange={(e) => setAudience(e.target.value as "" | "attended" | "noshow")} className={field + " mt-1"}><option value="">All registrants</option><option value="attended">Attended</option><option value="noshow">No-show</option></select></label>
        <button onClick={add} className="rounded-lg bg-brand-gradient px-4 py-2 text-sm font-bold text-white">+ Add</button>
      </div>
      {msg && <p className="mt-2 font-body text-sm text-foreground">{msg}</p>}

      <h3 className="mt-6 mb-2 font-mono text-xs font-semibold uppercase tracking-wide text-muted">Scheduled for this event</h3>
      <div className="space-y-2">
        {rems.length === 0 ? <p className="font-body text-sm text-muted">No reminders yet.</p> : rems.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm">
            <span>{r.channel === "email" ? "✉️" : "💬"}</span>
            <span className="font-mono font-bold text-heading">{fmt(r)}</span>
            <span className="text-muted">{r.template_id}</span>
            {r.conditions?.attended && <span className="font-mono text-[11px] text-muted">· {r.conditions.attended === "yes" ? "attended" : "no-show"}</span>}
            <button onClick={() => toggle(r)} className={["ml-auto relative h-5 w-9 rounded-full", r.enabled ? "bg-brand-gradient" : "bg-border-strong"].join(" ")}><span className={["absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", r.enabled ? "left-[18px]" : "left-0.5"].join(" ")} /></button>
            <button onClick={() => del(r.id)} className="font-mono text-xs text-red-400">✕</button>
          </div>
        ))}
      </div>
      <p className="mt-3 font-body text-xs text-muted">WhatsApp reminders fire via the automations cron now. Email reminder execution activates with the email mirror (next stage).</p>
    </div>
  );
}
