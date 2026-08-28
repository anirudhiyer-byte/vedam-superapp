"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { EventRow, EventField } from "@/lib/events";

type Reg = {
  id: string; full_name: string | null; user_email: string | null; whatsapp: string | null;
  passout_year: string | null; stream: string | null; created_at: string;
  answers: Record<string, unknown> | null; joined: boolean; attended_minutes: number;
  utm_source: string | null; utm_medium: string | null; utm_campaign: string | null;
};
type Col = { key: string; label: string; get: (r: Reg) => string };

const cell = (v: unknown) => (Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v));
const istDate = (s: string) => new Date(s).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });

export function Registrants({ id }: { id: string }) {
  const [supabase] = useState(() => createClient());
  const [event, setEvent] = useState<EventRow | null>(null);
  const [rows, setRows] = useState<Reg[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [winnerPos, setWinnerPos] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function load() {
    const { data: ev } = await supabase.from("events").select("*").eq("id", id).single();
    const { data: regs } = await supabase.from("event_registrations")
      .select("id, full_name, user_email, whatsapp, passout_year, stream, created_at, answers, joined, attended_minutes, utm_source, utm_medium, utm_campaign")
      .eq("event_id", id).order("created_at", { ascending: false });
    setEvent((ev as EventRow) ?? null);
    setRows((regs as Reg[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const schema: EventField[] = event?.registration_schema ?? [];
  const extraKeys = useMemo(() => schema.map((f) => f.key).filter((k) => !["whatsapp", "passout_year", "stream"].includes(k)), [schema]);
  const keyLabel = (k: string) => schema.find((f) => f.key === k)?.label || k;

  const columns = useMemo<Col[]>(() => [
    { key: "full_name", label: "Name", get: (r) => r.full_name ?? "" },
    { key: "user_email", label: "Email", get: (r) => r.user_email ?? "" },
    { key: "whatsapp", label: "WhatsApp", get: (r) => r.whatsapp ?? "" },
    { key: "passout_year", label: "Passout", get: (r) => r.passout_year ?? "" },
    { key: "stream", label: "Stream", get: (r) => r.stream ?? "" },
    { key: "joined", label: "Joined", get: (r) => (r.joined ? "Yes" : "No") },
    { key: "attended_minutes", label: "Mins", get: (r) => String(r.attended_minutes ?? 0) },
    { key: "utm_source", label: "Source", get: (r) => r.utm_source ?? "" },
    { key: "utm_campaign", label: "Campaign", get: (r) => r.utm_campaign ?? "" },
    ...extraKeys.map((k) => ({ key: "a:" + k, label: keyLabel(k), get: (r: Reg) => cell(r.answers?.[k]) })),
    { key: "created_at", label: "Registered", get: (r) => istDate(r.created_at) },
  ], [extraKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const terms = q.toLowerCase().split(/[,;\n]/).map((t) => t.trim()).filter(Boolean);
    const neg = terms.filter((t) => t.startsWith("!")).map((t) => t.slice(1));
    const pos = terms.filter((t) => !t.startsWith("!"));
    return rows.filter((r) => {
      const hay = `${r.full_name ?? ""} ${r.user_email ?? ""} ${r.whatsapp ?? ""} ${JSON.stringify(r.answers ?? {})}`.toLowerCase();
      if (neg.some((t) => hay.includes(t))) return false;
      if (pos.length && !pos.some((t) => hay.includes(t))) return false;
      for (const c of columns) {
        const f = (colFilters[c.key] || "").toLowerCase().trim();
        if (f && !c.get(r).toLowerCase().includes(f)) return false;
      }
      return true;
    });
  }, [rows, q, colFilters, columns]);

  // Actions target the selected rows if any, else the filtered set.
  const targets = useMemo(() => selected.size ? rows.filter((r) => selected.has(r.id)) : filtered, [selected, rows, filtered]);
  const allFilteredSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filtered.forEach((r) => next.delete(r.id));
      else filtered.forEach((r) => next.add(r.id));
      return next;
    });
  }
  function toggleRow(rid: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(rid) ? n.delete(rid) : n.add(rid); return n; });
  }

  async function token() { const { data } = await supabase.auth.getSession(); return data.session?.access_token; }

  async function issueCerts(kind: "participation" | "winner") {
    const list = targets;
    const label = kind === "winner" ? `winner certificates${winnerPos ? ` (${winnerPos})` : ""}` : "certificates";
    if (!list.length || !confirm(`Issue & email ${label} to ${list.length} registrant(s)?`)) return;
    setBusy(kind); setNote(null);
    const res = await fetch("/api/events/send-certificates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ registrationIds: list.map((r) => r.id), origin: window.location.origin, eventName: event?.name, kind, position: kind === "winner" ? (winnerPos || null) : null, accessToken: await token() }),
    });
    const j = await res.json(); setBusy(null);
    setNote(j.ok ? `${label}: sent ${j.sent}${j.failed ? `, ${j.failed} failed` : ""}.` : `Error: ${j.error}`);
  }

  async function emailPasses() {
    const list = targets;
    if (!list.length || !event) return;
    setBusy("passes"); setNote(null);
    const res = await fetch("/api/events/send-passes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipients: list.map((r) => r.user_email).filter(Boolean), origin: window.location.origin, eventCode: event.event_code, eventName: event.name, accessToken: await token() }),
    });
    const j = await res.json(); setBusy(null);
    setNote(j.ok ? `Passes: sent ${j.sent}${j.failed ? `, ${j.failed} failed` : ""}.` : `Error: ${j.error}`);
  }

  async function sync() {
    setBusy("sync"); setNote(null);
    const res = await fetch("/api/zoom/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: id, accessToken: await token() }) });
    const j = await res.json(); setBusy(null);
    if (!j.ok) setNote(`Error: ${j.error}`);
    else { setNote(j.source === "report" ? `Synced ${j.applied} attendee(s) from Zoom.` : "Finalized from live data (Zoom report not ready — retry in a few minutes)."); load(); }
  }

  function exportCsv() {
    const list = targets;
    const header = columns.map((c) => c.label);
    const lines = [header, ...list.map((r) => columns.map((c) => c.get(r)))];
    const csv = lines.map((row) => row.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${event?.event_code || "event"}-registrants.csv`; a.click();
    URL.revokeObjectURL(a.href);
  }

  if (loading) return <div className="mx-auto max-w-6xl px-6 py-10"><div className="h-64 animate-pulse rounded-2xl border border-border bg-surface" /></div>;

  const btn = "rounded-lg border border-border px-3.5 py-2 text-sm font-semibold text-foreground hover:bg-surface-warm disabled:opacity-50";
  const targetLabel = selected.size ? `${selected.size} selected` : `${filtered.length} shown`;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold text-heading">{filtered.length} registrant{filtered.length === 1 ? "" : "s"}{selected.size ? ` · ${selected.size} selected` : ""}</h2>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search (! to exclude)"
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-[color:rgb(var(--accent))]" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button onClick={exportCsv} disabled={!targets.length} className="rounded-lg bg-brand-gradient px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50">Export CSV</button>
        <button onClick={() => issueCerts("participation")} disabled={!targets.length || busy !== null} className={btn}>{busy === "participation" ? "Issuing…" : "Issue certificates"}</button>
        <div className="flex items-center gap-1 rounded-lg border border-border">
          <button onClick={() => issueCerts("winner")} disabled={!targets.length || busy !== null} className="px-3.5 py-2 text-sm font-semibold text-foreground hover:bg-surface-warm disabled:opacity-50">{busy === "winner" ? "Issuing…" : "Issue winner certs"}</button>
          <select value={winnerPos} onChange={(e) => setWinnerPos(e.target.value)} className="border-l border-border bg-transparent px-2 py-2 font-mono text-xs text-foreground outline-none" title="Position (ties: select multiple people)">
            <option value="">no position</option>
            <option value="1st">🥇 1st</option>
            <option value="2nd">🥈 2nd</option>
            <option value="3rd">🥉 3rd</option>
          </select>
        </div>
        <button onClick={emailPasses} disabled={!targets.length || busy !== null} className={btn}>{busy === "passes" ? "Sending…" : "Email passes"}</button>
        {event?.zoom_meeting_id && <button onClick={sync} disabled={busy !== null} className={btn}>{busy === "sync" ? "Syncing…" : "Sync attendance from Zoom"}</button>}
        <span className="font-mono text-xs text-muted">actions apply to {targetLabel}</span>
      </div>
      {note && <p className="mb-4 font-body text-sm text-foreground">{note}</p>}

      {filtered.length === 0 ? (
        <p className="font-body text-sm text-muted">No registrants{q || Object.values(colFilters).some(Boolean) ? " match" : " yet"}.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-surface-warm">
              <tr>
                <th className="px-3 py-2.5"><input type="checkbox" checked={allFilteredSelected} onChange={toggleAll} className="h-4 w-4 accent-[color:rgb(var(--accent))]" /></th>
                {columns.map((c) => (
                  <th key={c.key} className="whitespace-nowrap px-3 py-2.5 font-body text-xs font-semibold text-foreground">{c.label}</th>
                ))}
              </tr>
              <tr className="border-t border-border">
                <th className="px-3 py-1.5" />
                {columns.map((c) => (
                  <th key={c.key} className="px-2 py-1.5">
                    <input value={colFilters[c.key] || ""} onChange={(e) => setColFilters((f) => ({ ...f, [c.key]: e.target.value }))}
                      placeholder="filter" className="w-full min-w-[70px] rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground outline-none focus:border-[color:rgb(var(--accent))]" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className={["border-t border-border", selected.has(r.id) ? "bg-surface-warm/50" : ""].join(" ")}>
                  <td className="px-3 py-2"><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleRow(r.id)} className="h-4 w-4 accent-[color:rgb(var(--accent))]" /></td>
                  {columns.map((c) => (
                    <td key={c.key} className={["whitespace-nowrap px-3 py-2", c.key === "full_name" ? "text-foreground" : "text-muted"].join(" ")}>
                      {c.key === "joined" ? (r.joined ? <span className="text-accent">✓</span> : "—") : c.get(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
