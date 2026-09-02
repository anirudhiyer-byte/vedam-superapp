"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Ev = { id: string; name: string; starts_at: string | null };
type Tpl = { id?: string; name?: string; status?: string; placeholder?: { bodyvar?: number } };
type VarMap = { source: string; value: string };
type Auto = { id: string; name: string; enabled: boolean; trigger_type: string; offset_minutes: number; scheduled_at: string | null; last_run_at: string | null; event_id: string | null; events?: { name: string } | null };

const OFFSETS = [["60", "1 hour"], ["1440", "24 hours"], ["2880", "2 days"], ["180", "3 hours"]];

export function WhatsAppAutomations() {
  const [supabase] = useState(() => createClient());
  const [events, setEvents] = useState<Ev[]>([]);
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [autos, setAutos] = useState<Auto[]>([]);

  // form
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"event_before" | "event_after" | "scheduled">("event_before");
  const [eventId, setEventId] = useState("");
  const [offset, setOffset] = useState("1440");
  const [schedDate, setSchedDate] = useState("");
  const [schedTime, setSchedTime] = useState("10:00");
  const [state, setState] = useState("");
  const [attended, setAttended] = useState<"" | "yes" | "no">("");
  const [templateId, setTemplateId] = useState("");
  const [messageType, setMessageType] = useState("media");
  const [reach, setReach] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const selTpl = useMemo(() => tpls.find((t) => (t.name || t.id) === templateId), [tpls, templateId]);
  const bodyVarCount = selTpl?.placeholder?.bodyvar ?? 0;
  const [varMaps, setVarMaps] = useState<VarMap[]>([]);
  useEffect(() => { setVarMaps((v) => Array.from({ length: bodyVarCount }, (_, i) => v[i] || { source: "static", value: "" })); }, [bodyVarCount]);

  async function loadAll() {
    const { data: ev } = await supabase.from("events").select("id, name, starts_at").order("starts_at", { ascending: false }).limit(50);
    setEvents((ev as Ev[]) ?? []);
    const { data: au } = await supabase.from("whatsapp_automations").select("*, events(name)").order("created_at", { ascending: false });
    setAutos((au as Auto[]) ?? []);
    try { const r = await fetch("/api/whatsapp/templates"); const j = await r.json(); const raw = j?.data;
      const list = Array.isArray(raw) ? raw : Array.isArray(raw?.templates) ? raw.templates : Array.isArray(raw?.data) ? raw.data : [];
      setTpls((list as Tpl[]).filter((t) => (t.status || "APPROVED").toUpperCase() === "APPROVED")); } catch { /* */ }
  }
  useEffect(() => { loadAll(); }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("wa_automation_reach", { p_trigger: kind, p_event: kind === "scheduled" ? null : (eventId || null), p_state: state.trim() || null });
      setReach(typeof data === "number" ? data : null);
    })();
  }, [supabase, kind, eventId, state]);

  async function save() {
    setMsg(null);
    if (!name.trim() || !templateId) return setMsg("Name and template are required.");
    if (kind !== "scheduled" && !eventId) return setMsg("Pick an event.");
    if (kind === "scheduled" && !schedDate) return setMsg("Pick a send date.");
    setSaving(true);
    const conditions: Record<string, string> = {};
    if (state.trim()) conditions.state = state.trim();
    if (kind !== "scheduled" && attended) conditions.attended = attended;
    const row = {
      name: name.trim(), trigger_type: kind, template_id: templateId, message_type: messageType,
      event_id: kind === "scheduled" ? null : eventId,
      offset_minutes: kind === "scheduled" ? 0 : Number(offset),
      scheduled_at: kind === "scheduled" ? new Date(`${schedDate}T${schedTime}:00+05:30`).toISOString() : null,
      conditions, variable_mapping: varMaps,
    };
    const { error } = await supabase.from("whatsapp_automations").insert(row);
    setSaving(false);
    if (error) return setMsg(error.message);
    setMsg("Automation saved & active."); setName(""); loadAll();
  }

  async function toggle(a: Auto) { await supabase.from("whatsapp_automations").update({ enabled: !a.enabled }).eq("id", a.id); loadAll(); }
  async function del(id: string) { if (confirm("Delete this automation?")) { await supabase.from("whatsapp_automations").delete().eq("id", id); loadAll(); } }

  const field = "w-full rounded-lg border border-border-strong bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-[color:rgb(var(--accent))]";
  const seg = (on: boolean) => ["rounded-lg border px-3.5 py-2 text-xs font-bold", on ? "border-[color:rgb(var(--accent))] bg-surface-warm text-foreground" : "border-border-strong bg-surface text-muted"].join(" ");
  const desc = (a: Auto) => a.trigger_type === "scheduled" ? `Scheduled · ${a.scheduled_at ? new Date(a.scheduled_at).toLocaleString("en-IN") : ""}` : `${a.trigger_type === "event_before" ? "Before" : "After"} event · ${a.offset_minutes / 60}h · ${a.events?.name ?? ""}`;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <span className="font-mono text-xs font-semibold lowercase tracking-[0.12em] text-accent">// whatsapp · automations</span>
      <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-heading">Automations</h1>

      <div className="mt-5 space-y-4 rounded-2xl border border-border bg-surface p-5">
        <label className="block"><span className="mb-1.5 block font-body text-xs font-semibold text-foreground">Automation name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="24h reminder — Bootcamp" className={field} /></label>

        <div><span className="mb-1.5 block font-body text-xs font-semibold text-foreground">Trigger</span>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setKind("event_before")} className={seg(kind === "event_before")}>Before an event</button>
            <button onClick={() => setKind("event_after")} className={seg(kind === "event_after")}>After an event ends</button>
            <button onClick={() => setKind("scheduled")} className={seg(kind === "scheduled")}>Scheduled</button>
          </div>
        </div>

        {kind !== "scheduled" ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="mb-1.5 block font-body text-xs font-semibold text-foreground">Event</span>
              <select value={eventId} onChange={(e) => setEventId(e.target.value)} className={field}><option value="">Select…</option>{events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
            <label className="block"><span className="mb-1.5 block font-body text-xs font-semibold text-foreground">{kind === "event_before" ? "How long before?" : "How long after?"}</span>
              <select value={offset} onChange={(e) => setOffset(e.target.value)} className={field}>{OFFSETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="mb-1.5 block font-body text-xs font-semibold text-foreground">Send date</span><input type="date" value={schedDate} onChange={(e) => setSchedDate(e.target.value)} className={field} /></label>
            <label className="block"><span className="mb-1.5 block font-body text-xs font-semibold text-foreground">Send time (IST)</span><input type="time" value={schedTime} onChange={(e) => setSchedTime(e.target.value)} className={field} /></label>
          </div>
        )}

        {/* conditions */}
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="mb-1.5 block font-body text-xs font-semibold text-foreground">State filter (optional)</span><input value={state} onChange={(e) => setState(e.target.value)} placeholder="Leave blank for all" className={field} /></label>
          {kind !== "scheduled" && (
            <label className="block"><span className="mb-1.5 block font-body text-xs font-semibold text-foreground">Attendance</span>
              <select value={attended} onChange={(e) => setAttended(e.target.value as "" | "yes" | "no")} className={field}><option value="">All registrants</option><option value="yes">Attended only</option><option value="no">No-shows only</option></select></label>
          )}
        </div>
        {reach != null && <p className="font-mono text-xs text-muted">Estimated recipients: <b className="text-heading">~{reach.toLocaleString("en-IN")}</b></p>}

        {/* message */}
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="mb-1.5 block font-body text-xs font-semibold text-foreground">Approved template</span>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={field}><option value="">Select…</option>{tpls.map((t, i) => <option key={i} value={t.name || t.id}>{t.name}{t.placeholder?.bodyvar ? ` · ${t.placeholder.bodyvar} var` : ""}</option>)}</select></label>
          <label className="block"><span className="mb-1.5 block font-body text-xs font-semibold text-foreground">message_type</span>
            <select value={messageType} onChange={(e) => setMessageType(e.target.value)} className={field}><option value="media">media</option><option value="text">text</option><option value="text_var">text_var</option><option value="media_var">media_var</option></select></label>
        </div>
        {varMaps.length > 0 && (
          <div className="rounded-xl border border-dashed border-border-strong p-3">
            <span className="mb-2 block font-body text-xs font-semibold text-foreground">Map {"{{n}}"} variables</span>
            {varMaps.map((m, i) => (
              <div key={i} className="mt-1.5 flex items-center gap-2">
                <span className="w-10 font-mono text-xs text-muted">{`{{${i + 1}}}`}</span>
                <select value={m.source} onChange={(e) => setVarMaps((v) => v.map((x, j) => j === i ? { ...x, source: e.target.value } : x))} className={field + " w-32"}><option value="static">Static</option><option value="name">Recipient name</option><option value="state">State</option><option value="city">City</option></select>
                {m.source === "static" && <input value={m.value} onChange={(e) => setVarMaps((v) => v.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} placeholder="value" className={field + " flex-1"} />}
              </div>
            ))}
          </div>
        )}

        {msg && <p className="font-body text-sm text-foreground">{msg}</p>}
        <button onClick={save} disabled={saving} className="rounded-xl bg-brand-gradient px-6 py-3 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Saving…" : "Save & activate automation"}</button>
        <p className="font-body text-xs text-muted">A background job checks every 15 minutes and fires due automations once, automatically.</p>
      </div>

      {/* list */}
      <div className="mt-8">
        <span className="mb-2 block font-mono text-xs font-semibold uppercase tracking-wide text-muted">Your automations</span>
        <div className="space-y-2">
          {autos.length === 0 ? <p className="font-body text-sm text-muted">No automations yet.</p> : autos.map((a) => (
            <div key={a.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
              <div className="min-w-0 flex-1"><div className="font-display text-sm font-extrabold text-heading">{a.name}</div><div className="truncate font-body text-xs text-muted">{desc(a)}{a.last_run_at ? ` · last run ${new Date(a.last_run_at).toLocaleDateString("en-IN")}` : ""}</div></div>
              <button onClick={() => toggle(a)} className={["relative h-6 w-11 rounded-full transition-colors", a.enabled ? "bg-brand-gradient" : "bg-border-strong"].join(" ")}><span className={["absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all", a.enabled ? "left-[22px]" : "left-0.5"].join(" ")} /></button>
              <button onClick={() => del(a.id)} className="font-mono text-xs text-red-400 hover:text-red-500">✕</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
