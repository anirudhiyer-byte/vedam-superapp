"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Ev = { id: string; name: string; starts_at: string | null; event_code: string };
type Reg = { user_id: string | null; full_name: string | null; user_email: string | null; whatsapp: string | null; joined: boolean | null };
type EmTpl = { id: string; name: string };
type WaTpl = { id?: string; name?: string; status?: string };

/** Send-NOW reminder: pick an upcoming bootcamp -> its registrants -> blast email/WhatsApp immediately. */
export function ReminderNow() {
  const [supabase] = useState(() => createClient());
  const [events, setEvents] = useState<Ev[]>([]);
  const [eventId, setEventId] = useState("");
  const [regs, setRegs] = useState<Reg[]>([]);
  const [audience, setAudience] = useState<"all" | "attended" | "noshow">("all");
  const [channel, setChannel] = useState<"email" | "whatsapp">("email");
  const [emTpls, setEmTpls] = useState<EmTpl[]>([]);
  const [waTpls, setWaTpls] = useState<WaTpl[]>([]);
  const [templateRef, setTemplateRef] = useState("");
  const [subject, setSubject] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("events").select("id, name, starts_at, event_code").gte("starts_at", new Date().toISOString()).order("starts_at");
      setEvents((data as Ev[]) ?? []);
      const { data: em } = await supabase.from("email_templates").select("id, name").order("created_at", { ascending: false });
      setEmTpls((em as EmTpl[]) ?? []);
      try { const r = await fetch("/api/whatsapp/templates"); const j = await r.json(); const raw = j?.data;
        const list = Array.isArray(raw) ? raw : Array.isArray(raw?.templates) ? raw.templates : Array.isArray(raw?.data) ? raw.data : [];
        setWaTpls((list as WaTpl[]).filter((t) => (t.status || "APPROVED").toUpperCase() === "APPROVED")); } catch { /* */ }
    })();
  }, [supabase]);

  useEffect(() => {
    if (!eventId) { setRegs([]); return; }
    (async () => {
      const { data } = await supabase.from("event_registrations").select("user_id, full_name, user_email, whatsapp, joined").eq("event_id", eventId);
      setRegs((data as Reg[]) ?? []);
    })();
  }, [eventId, supabase]);

  const targets = useMemo(() => regs.filter((r) => audience === "all" ? true : audience === "attended" ? r.joined : !r.joined), [regs, audience]);
  const templates = channel === "email" ? emTpls.map((t) => ({ ref: t.id, label: t.name })) : waTpls.map((t) => ({ ref: t.name || t.id || "", label: t.name || "" }));
  const field = "rounded-lg border border-border-strong bg-background px-3 py-2 text-sm text-foreground outline-none";

  async function send() {
    setMsg(null);
    if (!eventId) return setMsg("Pick an event.");
    if (!templateRef) return setMsg("Pick a template.");
    if (targets.length === 0) return setMsg("No recipients match.");
    if (!confirm(`Send this reminder to ${targets.length} ${audience === "all" ? "registrants" : audience} now?`)) return;
    setBusy(true);
    const { data: { session } } = await supabase.auth.getSession();
    const ev = events.find((e) => e.id === eventId);
    try {
      if (channel === "email") {
        const emails = targets.map((t) => t.user_email).filter(Boolean) as string[];
        const tpl = emTpls.find((t) => t.id === templateRef);
        // reuse the campaign send route (tracked) in batches of 40
        let sent = 0;
        for (let i = 0; i < emails.length; i += 40) {
          const batch = emails.slice(i, i + 40);
          const res = await fetch("/api/events/send-campaign", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subject: subject || `Reminder: ${ev?.name}`, body: `{{template:${templateRef}}}`, recipients: batch, template: "brand", accessToken: session?.access_token, kind: "reminder", refName: ev?.name, templateId: templateRef }) });
          const j = await res.json(); if (j.ok) sent += j.sent || 0;
        }
        setMsg(`Reminder emailed to ${sent} of ${emails.length}. (Template: ${tpl?.name})`);
      } else {
        const recips = targets.filter((t) => t.whatsapp).map((t) => ({ to: t.whatsapp as string }));
        let sent = 0;
        for (let i = 0; i < recips.length; i += 40) {
          const res = await fetch("/api/whatsapp/broadcast", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ templateId: templateRef, messageType: "template", recipients: recips.slice(i, i + 40) }) });
          const j = await res.json(); if (j?.ok !== false) sent += recips.slice(i, i + 40).length;
        }
        setMsg(`Reminder sent on WhatsApp to ${sent} of ${recips.length}.`);
      }
    } catch (e) { setMsg("Send failed: " + String((e as Error)?.message || e)); }
    setBusy(false);
  }

  return (
    <div className="rounded-xl border border-border p-4">
      <p className="font-body text-sm font-semibold text-heading">Send a reminder now</p>
      <p className="mt-1 font-body text-xs text-muted">Pick an upcoming bootcamp → send its registrants a reminder immediately (email is tracked; WhatsApp via TrustSignal).</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-[11px] font-semibold text-muted">Event
          <select value={eventId} onChange={(e) => setEventId(e.target.value)} className={field + " mt-1 max-w-[240px]"}>
            <option value="">Select upcoming event…</option>
            {events.map((e) => <option key={e.id} value={e.id}>{e.name}{e.starts_at ? ` · ${new Date(e.starts_at).toLocaleDateString()}` : ""}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-[11px] font-semibold text-muted">Audience
          <select value={audience} onChange={(e) => setAudience(e.target.value as typeof audience)} className={field + " mt-1"}>
            <option value="all">All registrants</option><option value="attended">Attended</option><option value="noshow">No-show</option>
          </select>
        </label>
        <label className="flex flex-col text-[11px] font-semibold text-muted">Channel
          <select value={channel} onChange={(e) => { setChannel(e.target.value as typeof channel); setTemplateRef(""); }} className={field + " mt-1"}>
            <option value="email">Email</option><option value="whatsapp">WhatsApp</option>
          </select>
        </label>
        <label className="flex flex-col text-[11px] font-semibold text-muted">Template
          <select value={templateRef} onChange={(e) => setTemplateRef(e.target.value)} className={field + " mt-1 max-w-[200px]"}>
            <option value="">Select…</option>{templates.map((t) => <option key={t.ref} value={t.ref}>{t.label}</option>)}
          </select>
        </label>
        {channel === "email" && <label className="flex flex-col text-[11px] font-semibold text-muted">Subject
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Reminder: …" className={field + " mt-1"} /></label>}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <span className="font-mono text-xs text-muted">{targets.length} recipient{targets.length === 1 ? "" : "s"}</span>
        <button onClick={send} disabled={busy} className="rounded-lg bg-brand-gradient px-5 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Sending…" : "Send reminder now"}</button>
        {msg && <span className="font-body text-xs text-muted">{msg}</span>}
      </div>
    </div>
  );
}
