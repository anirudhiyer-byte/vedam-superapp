"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  type EventRow, type EventField, type ScheduleDay,
  CATEGORIES, normalizeSchema, DEFAULT_ONLINE_REG, DEFAULT_OFFLINE_REG,
} from "@/lib/events";
import { FieldBuilder } from "@/components/admin/field-builder";
import { ScheduleEditor } from "@/components/admin/schedule-editor";

const input = "w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-[color:rgb(var(--accent))]";

type Form = {
  name: string; category: string; mode: "online" | "offline"; host: string; blurb: string; details: string;
  platform: string; join_link: string; zoom_id: string; zoom_passcode: string; date: string; time: string; duration_minutes: string;
  venue: string; map_link: string; schedule: ScheduleDay[];
  banner_url: string; whatsapp_community_url: string; max_attendees: string; reg_close_at: string;
  ribbon_label: string; ribbon_value: string; dashboard_enabled: boolean;
  registration_schema: EventField[];
};

const blank: Form = {
  name: "", category: "Workshop", mode: "online", host: "", blurb: "", details: "",
  platform: "", join_link: "", zoom_id: "", zoom_passcode: "", date: "", time: "", duration_minutes: "60",
  venue: "", map_link: "", schedule: [{ date: "", slots: [{ start: "", end: "" }] }],
  banner_url: "", whatsapp_community_url: "", max_attendees: "", reg_close_at: "",
  ribbon_label: "", ribbon_value: "", dashboard_enabled: false,
  registration_schema: DEFAULT_ONLINE_REG,
};

export function EventEditor({ id }: { id?: string }) {
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const [f, setF] = useState<Form>(blank);
  const [status, setStatus] = useState<string>("draft");
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      const { data } = await supabase.from("events").select("*").eq("id", id).single();
      if (active && data) {
        const e = data as EventRow;
        const starts = e.starts_at ? new Date(e.starts_at) : null;
        setStatus(e.status);
        setF({
          name: e.name, category: e.category || "Workshop", mode: e.mode, host: e.host || "", blurb: e.blurb || "", details: e.details || "",
          platform: e.platform || "", join_link: e.join_link || "", zoom_id: e.zoom_id || "", zoom_passcode: e.zoom_passcode || "",
          date: starts ? starts.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : "",
          time: starts ? starts.toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }) : "",
          duration_minutes: e.duration_minutes ? String(e.duration_minutes) : "60",
          venue: e.venue || "", map_link: e.map_link || "", schedule: e.schedule || [{ date: "", slots: [{ start: "", end: "" }] }],
          banner_url: e.banner_url || "", whatsapp_community_url: e.whatsapp_community_url || "",
          max_attendees: e.max_attendees ? String(e.max_attendees) : "", reg_close_at: e.reg_close_at ? new Date(e.reg_close_at).toISOString().slice(0, 16) : "",
          ribbon_label: e.ribbon_label || "", ribbon_value: e.ribbon_value || "", dashboard_enabled: e.dashboard_enabled,
          registration_schema: e.registration_schema?.length ? e.registration_schema : (e.mode === "offline" ? DEFAULT_OFFLINE_REG : DEFAULT_ONLINE_REG),
        });
      }
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [id, supabase]);

  async function uploadBanner(file: File) {
    setUploading(true);
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `banners/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const { error } = await supabase.storage.from("event-banners").upload(path, file, { upsert: true, contentType: file.type });
    if (error) { setError("Upload failed: " + error.message); setUploading(false); return; }
    const { data } = supabase.storage.from("event-banners").getPublicUrl(path);
    if (data?.publicUrl) set("banner_url", data.publicUrl);
    setUploading(false);
  }

  function buildPayload(publish: boolean) {
    const off = f.mode === "offline";
    let starts_at: string | null = null;
    if (off) {
      const d0 = f.schedule.find((d) => d.date);
      const s0 = d0?.slots?.find((s) => s.start);
      starts_at = d0?.date ? new Date(`${d0.date}T${s0?.start || "00:00"}:00+05:30`).toISOString() : null;
    } else if (f.date) {
      starts_at = new Date(`${f.date}T${f.time || "00:00"}:00+05:30`).toISOString();
    }
    return {
      name: f.name.trim(), category: f.category, host: f.host || null, blurb: f.blurb || null, details: f.details || null,
      mode: f.mode, starts_at,
      duration_minutes: !off && f.duration_minutes ? Number(f.duration_minutes) : null,
      platform: off ? null : f.platform || null,
      join_link: off ? null : f.join_link || null,
      zoom_id: !off && f.platform === "Zoom" ? f.zoom_id || null : null,
      zoom_passcode: !off && f.platform === "Zoom" ? f.zoom_passcode || null : null,
      venue: off ? f.venue || null : null,
      map_link: off ? f.map_link || null : null,
      schedule: off ? f.schedule.filter((d) => d.date) : null,
      banner_url: f.banner_url || null, whatsapp_community_url: f.whatsapp_community_url || null,
      max_attendees: f.max_attendees ? Number(f.max_attendees) : null,
      reg_close_at: f.reg_close_at ? new Date(f.reg_close_at + ":00+05:30").toISOString() : null,
      ribbon_label: f.ribbon_label.trim() || null, ribbon_value: f.ribbon_value.trim() || null,
      dashboard_enabled: f.dashboard_enabled,
      registration_schema: normalizeSchema(f.registration_schema),
      status: publish ? "open" : "draft",
    };
  }

  async function save(publish: boolean) {
    setError(null);
    if (!f.name.trim()) return setError("Give the event a name.");
    setSaving(true);
    const payload = buildPayload(publish);

    let code: string | null = null;
    if (id) {
      const { error } = await supabase.from("events").update(payload).eq("id", id);
      if (error) { setSaving(false); return setError(error.message); }
      const { data } = await supabase.from("events").select("event_code").eq("id", id).single();
      code = data?.event_code ?? null;
    } else {
      const { data, error } = await supabase.from("events").insert(payload).select("event_code").single();
      if (error) { setSaving(false); return setError(error.message); }
      code = data?.event_code ?? null;
    }
    if (code) {
      try { await supabase.rpc("sync_event_view", { p_code: code, p_fields: payload.registration_schema }); } catch { /* view is best-effort */ }
    }
    setSaving(false);
    router.push("/admin/events");
    router.refresh();
  }

  if (loading) return <div className="mx-auto max-w-2xl px-6 py-16"><div className="h-96 animate-pulse rounded-2xl border border-border bg-surface" /></div>;
  const off = f.mode === "offline";

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="font-display text-2xl font-bold text-heading">{id ? "Edit event" : "New event"}</h1>
      {id && <p className="mt-1 font-body text-xs text-muted">Status: {status}</p>}

      <div className="mt-6 space-y-5">
        <Row label="Event name"><input className={input} value={f.name} onChange={(e) => set("name", e.target.value)} /></Row>

        <div className="grid gap-4 sm:grid-cols-2">
          <Row label="Category">
            <select className={input} value={f.category} onChange={(e) => set("category", e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Row>
          <Row label="Mode">
            <select className={input} value={f.mode} onChange={(e) => {
              const m = e.target.value as Form["mode"];
              set("mode", m);
              if (!f.registration_schema.length) set("registration_schema", m === "offline" ? DEFAULT_OFFLINE_REG : DEFAULT_ONLINE_REG);
            }}>
              <option value="online">Online</option>
              <option value="offline">In person</option>
            </select>
          </Row>
        </div>

        <Row label="Host (optional)"><input className={input} value={f.host} onChange={(e) => set("host", e.target.value)} /></Row>
        <Row label="Short blurb"><textarea className={input} rows={2} value={f.blurb} onChange={(e) => set("blurb", e.target.value)} /></Row>
        <Row label="Details (optional)"><textarea className={input} rows={4} value={f.details} onChange={(e) => set("details", e.target.value)} /></Row>

        {off ? (
          <>
            <Row label="Venue"><input className={input} value={f.venue} onChange={(e) => set("venue", e.target.value)} /></Row>
            <Row label="Map link (optional)"><input className={input} value={f.map_link} onChange={(e) => set("map_link", e.target.value)} /></Row>
            <Row label="Schedule"><ScheduleEditor value={f.schedule} onChange={(v) => set("schedule", v)} /></Row>
          </>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Row label="Date"><input type="date" className={input} value={f.date} onChange={(e) => set("date", e.target.value)} /></Row>
              <Row label="Start time (IST)"><input type="time" className={input} value={f.time} onChange={(e) => set("time", e.target.value)} /></Row>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Row label="Platform"><input className={input} value={f.platform} onChange={(e) => set("platform", e.target.value)} placeholder="Zoom, Google Meet…" /></Row>
              <Row label="Duration (min)"><input type="number" className={input} value={f.duration_minutes} onChange={(e) => set("duration_minutes", e.target.value)} /></Row>
            </div>
            <Row label="Join link"><input className={input} value={f.join_link} onChange={(e) => set("join_link", e.target.value)} /></Row>
            {f.platform === "Zoom" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Row label="Zoom meeting ID"><input className={input} value={f.zoom_id} onChange={(e) => set("zoom_id", e.target.value)} /></Row>
                <Row label="Zoom passcode"><input className={input} value={f.zoom_passcode} onChange={(e) => set("zoom_passcode", e.target.value)} /></Row>
              </div>
            )}
          </>
        )}

        <Row label="Banner image">
          <div className="flex items-center gap-3">
            {f.banner_url && /* eslint-disable-next-line @next/next/no-img-element */ <img src={f.banner_url} alt="" className="h-12 w-20 rounded-md object-cover" />}
            <input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadBanner(file); }} className="text-xs text-muted" />
            {uploading && <span className="font-body text-xs text-muted">Uploading…</span>}
          </div>
        </Row>

        <div className="grid gap-4 sm:grid-cols-2">
          <Row label="WhatsApp community URL"><input className={input} value={f.whatsapp_community_url} onChange={(e) => set("whatsapp_community_url", e.target.value)} /></Row>
          <Row label="Max attendees (0 = unlimited)"><input type="number" className={input} value={f.max_attendees} onChange={(e) => set("max_attendees", e.target.value)} /></Row>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Row label="Registration closes (optional)"><input type="datetime-local" className={input} value={f.reg_close_at} onChange={(e) => set("reg_close_at", e.target.value)} /></Row>
          <div className="grid grid-cols-2 gap-3">
            <Row label="Ribbon label"><input className={input} value={f.ribbon_label} onChange={(e) => set("ribbon_label", e.target.value)} /></Row>
            <Row label="Ribbon value"><input className={input} value={f.ribbon_value} onChange={(e) => set("ribbon_value", e.target.value)} /></Row>
          </div>
        </div>

        <div>
          <h2 className="font-display text-sm font-bold text-heading">Registration form</h2>
          <p className="mb-3 mt-1 font-body text-xs text-muted">Fields students fill when registering. WhatsApp, passout year, and stream auto-fill from their profile.</p>
          <FieldBuilder value={f.registration_schema} onChange={(v) => set("registration_schema", v)} />
        </div>

        {error && <p className="font-body text-sm text-red-500">{error}</p>}

        <div className="flex flex-wrap gap-3 border-t border-border pt-5">
          <button onClick={() => save(true)} disabled={saving} className="rounded-xl bg-brand-gradient px-6 py-3 text-sm font-semibold text-white disabled:opacity-60">
            {saving ? "Saving…" : "Publish"}
          </button>
          <button onClick={() => save(false)} disabled={saving} className="rounded-xl border border-border px-6 py-3 text-sm font-semibold text-foreground hover:bg-surface-warm disabled:opacity-60">
            Save as draft
          </button>
          <button onClick={() => router.push("/admin/events")} className="ml-auto font-body text-sm text-muted">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-body text-xs font-semibold text-foreground">{label}</span>
      {children}
    </label>
  );
}
