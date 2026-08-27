"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { EventRow, EventField } from "@/lib/events";

type Reg = {
  id: string; full_name: string | null; user_email: string | null; whatsapp: string | null;
  passout_year: string | null; stream: string | null; created_at: string;
  answers: Record<string, unknown> | null;
};

const cell = (v: unknown) => (Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v));

export function Registrants({ id }: { id: string }) {
  const [supabase] = useState(() => createClient());
  const [event, setEvent] = useState<EventRow | null>(null);
  const [rows, setRows] = useState<Reg[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: ev } = await supabase.from("events").select("*").eq("id", id).single();
      const { data: regs } = await supabase.from("event_registrations")
        .select("id, full_name, user_email, whatsapp, passout_year, stream, created_at, answers")
        .eq("event_id", id).order("created_at", { ascending: false });
      if (active) { setEvent((ev as EventRow) ?? null); setRows((regs as Reg[]) ?? []); setLoading(false); }
    })();
    return () => { active = false; };
  }, [id, supabase]);

  const schema: EventField[] = event?.registration_schema ?? [];
  // Extra answer columns beyond the base snapshot fields
  const extraKeys = useMemo(
    () => schema.map((f) => f.key).filter((k) => !["whatsapp", "passout_year", "stream"].includes(k)),
    [schema]
  );
  const keyLabel = (k: string) => schema.find((f) => f.key === k)?.label || k;

  const filtered = useMemo(() => {
    const terms = q.toLowerCase().split(/[,;\n]/).map((t) => t.trim()).filter(Boolean);
    const neg = terms.filter((t) => t.startsWith("!")).map((t) => t.slice(1));
    const pos = terms.filter((t) => !t.startsWith("!"));
    return rows.filter((r) => {
      const hay = `${r.full_name ?? ""} ${r.user_email ?? ""} ${r.whatsapp ?? ""} ${JSON.stringify(r.answers ?? {})}`.toLowerCase();
      if (neg.some((t) => hay.includes(t))) return false;
      return pos.length === 0 || pos.some((t) => hay.includes(t));
    });
  }, [rows, q]);

  function exportCsv() {
    const headers = ["Name", "Email", "WhatsApp", "Passout", "Stream", "Registered", ...extraKeys.map(keyLabel)];
    const lines = [headers, ...filtered.map((r) => [
      r.full_name, r.user_email, r.whatsapp, r.passout_year, r.stream,
      new Date(r.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      ...extraKeys.map((k) => cell(r.answers?.[k])),
    ])];
    const csv = lines.map((row) => row.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${event?.event_code || "event"}-registrants.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (loading) return <div className="mx-auto max-w-4xl px-6 py-10"><div className="h-64 animate-pulse rounded-2xl border border-border bg-surface" /></div>;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold text-heading">{filtered.length} registrant{filtered.length === 1 ? "" : "s"}</h2>
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search (! to exclude)"
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-[color:rgb(var(--accent))]" />
          <button onClick={exportCsv} disabled={!filtered.length} className="rounded-lg bg-brand-gradient px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Export CSV</button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="font-body text-sm text-muted">No registrants{q ? " match" : " yet"}.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-surface-warm">
              <tr>
                {["Name", "Email", "WhatsApp", "Passout", "Stream", ...extraKeys.map(keyLabel), "Registered"].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2.5 font-body text-xs font-semibold text-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="whitespace-nowrap px-3 py-2 text-foreground">{r.full_name}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted">{r.user_email}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted">{r.whatsapp}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted">{r.passout_year}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted">{r.stream}</td>
                  {extraKeys.map((k) => <td key={k} className="whitespace-nowrap px-3 py-2 text-muted">{cell(r.answers?.[k])}</td>)}
                  <td className="whitespace-nowrap px-3 py-2 text-muted">{new Date(r.created_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
