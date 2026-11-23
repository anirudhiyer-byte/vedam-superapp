"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DeletePerson } from "@/components/admin/vsat-delete-person";

/**
 * VSAT Applications — EVERY application (an application_manager row), regardless of
 * payment or exam booking. Paid / booked / exam-given show as badges. Data comes only
 * from vsat_applications_list (the database re-checks role + campus scope on every call).
 * This is deliberately NOT the exam pipeline (which lists from exam-booking onward).
 */

const PAGE = 50;
const input = "rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-[#22d3ee] focus:outline-none";
const btn = "rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-40";

type Row = {
  application_id: string; application_no: string | null; name: string | null; email: string | null; mobile: string | null;
  campus: "pune" | "gurugram" | null; stream: string | null; year: string | null; state: string | null; city: string | null;
  payment_stage: string | null; application_stage: string | null; paid: boolean; booked: boolean; exam_given: boolean;
  payment_amount: number | null; primary_utm: string | null; secondary_utm: string | null; tertiary_utm: string | null;
  latest_utm: string | null; primary_utm_source: string | null; primary_utm_medium: string | null; primary_utm_campaign: string | null;
  created_at: string | null;
};
type Result = { total: number; rows: Row[]; limit: number; offset: number };

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—");
const campusLabel = (c: string | null) => (c === "pune" ? "Pune" : c === "gurugram" ? "Gurugram" : "—");

function Pill({ on, label, tone }: { on: boolean; label: string; tone: "green" | "sky" | "violet" }) {
  const tones = {
    green: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
    sky: "border-sky-400/30 bg-sky-400/10 text-sky-300",
    violet: "border-violet-400/30 bg-violet-400/10 text-violet-300",
  } as const;
  return <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${on ? tones[tone] : "border-white/10 bg-white/5 text-white/35"}`}>{label}</span>;
}

/** primary + latest UTM, each as source / medium / campaign. */
function Utm({ value, muted }: { value: string | null; muted?: boolean }) {
  if (!value) return <span className="text-white/30">—</span>;
  return <span className={`font-mono text-[11px] ${muted ? "text-white/45" : "text-white/80"}`} title={value}>{value}</span>;
}

export function VsatApplicationsPanel() {
  const [supabase] = useState(() => createClient());
  const [campus, setCampus] = useState<"" | "pune" | "gurugram">("");
  const [paid, setPaid] = useState<"" | "paid" | "unpaid">("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let on = true;
    void supabase.rpc("is_admin").then(({ data: a }) => { if (on) setIsAdmin(a === true); });
    return () => { on = false; };
  }, [supabase]);

  useEffect(() => {
    const t = setTimeout(() => { setQ(qInput.trim().length >= 2 ? qInput.trim() : ""); setOffset(0); }, 350);
    return () => clearTimeout(t);
  }, [qInput]);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    const p: Record<string, unknown> = { limit: PAGE, offset };
    if (campus) p.campus = campus;
    if (paid) p.paid = paid;
    if (q) p.q = q;
    const { data: d, error } = await supabase.rpc("vsat_applications_list", { p });
    if (error) { setErr(error.message); setData(null); } else setData(d as Result);
    setLoading(false);
  }, [supabase, campus, paid, q, offset]);
  useEffect(() => { void load(); }, [load]);

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-4 p-5 text-white">
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${input} w-72`} placeholder="Search name, email, mobile or application no." value={qInput} onChange={(e) => setQInput(e.target.value)} maxLength={100} aria-label="Search" />
        <select className={input} value={paid} onChange={(e) => { setPaid(e.target.value as "" | "paid" | "unpaid"); setOffset(0); }} aria-label="Payment">
          <option value="">All payments</option>
          <option value="paid">Paid</option>
          <option value="unpaid">Unpaid</option>
        </select>
        <select className={input} value={campus} onChange={(e) => { setCampus(e.target.value as "" | "pune" | "gurugram"); setOffset(0); }} aria-label="Campus">
          <option value="">All campuses</option>
          <option value="pune">Pune</option>
          <option value="gurugram">Gurugram</option>
        </select>
        <span className="ml-auto text-xs text-white/50">{total} application{total === 1 ? "" : "s"}</span>
      </div>

      {err && <div className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">{err}</div>}

      <div className="overflow-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="bg-white/5 text-[11px] uppercase tracking-wider text-white/45">
            <tr>
              <th className="px-3 py-2.5 font-semibold">Applicant</th>
              <th className="px-3 py-2.5 font-semibold">Contact</th>
              <th className="px-3 py-2.5 font-semibold">Campus</th>
              <th className="px-3 py-2.5 font-semibold">Status</th>
              <th className="px-3 py-2.5 font-semibold">Primary campaign</th>
              <th className="px-3 py-2.5 font-semibold">Latest campaign</th>
              <th className="px-3 py-2.5 font-semibold">Applied</th>
              {isAdmin && <th className="px-3 py-2.5 text-right font-semibold">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {loading && <tr><td colSpan={isAdmin ? 8 : 7} className="px-3 py-8 text-center text-white/40">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={isAdmin ? 8 : 7} className="px-3 py-8 text-center text-white/40">No applications match.</td></tr>}
            {!loading && rows.map((r) => (
              <tr key={r.application_id} className="hover:bg-white/[.03]">
                <td className="px-3 py-2.5">
                  <div className="font-medium text-white/90">{r.name || "—"}</div>
                  <div className="font-mono text-[11px] text-white/40">{r.application_no || r.application_id}</div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="text-white/70">{r.email || "—"}</div>
                  <div className="text-[12px] text-white/45">{r.mobile || "—"}</div>
                </td>
                <td className="px-3 py-2.5 text-white/70">{campusLabel(r.campus)}</td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1.5">
                    <Pill on={r.paid} label={r.paid ? "Paid" : "Unpaid"} tone="green" />
                    <Pill on={r.booked} label="Booked" tone="sky" />
                    <Pill on={r.exam_given} label="Exam given" tone="violet" />
                  </div>
                </td>
                <td className="px-3 py-2.5"><Utm value={r.primary_utm} /></td>
                <td className="px-3 py-2.5"><Utm value={r.latest_utm} muted /></td>
                <td className="px-3 py-2.5 whitespace-nowrap text-white/60">{fmt(r.created_at)}</td>
                {isAdmin && (
                  <td className="px-3 py-2.5 text-right">
                    <DeletePerson kind="application" id={r.application_id} name={r.name} email={r.email} onDeleted={() => void load()} compact />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-white/40">{rows.length ? `${offset + 1}–${offset + rows.length} of ${total}` : "—"}</span>
        <div className="flex gap-2">
          <button className={`${btn} bg-white/5 text-white/70`} disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Prev</button>
          <button className={`${btn} bg-white/5 text-white/70`} disabled={offset + rows.length >= total || loading} onClick={() => setOffset(offset + PAGE)}>Next</button>
        </div>
      </div>
    </div>
  );
}
