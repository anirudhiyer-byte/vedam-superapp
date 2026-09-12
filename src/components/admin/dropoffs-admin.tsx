"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type BcDrop = { id: string; full_name: string; email: string; phone: string; event_name: string; viewed_at: string; resolved: boolean; };
type CsDrop = { user_id: string; full_name: string; email: string; phone: string; registered_at: string; started_any_module: boolean; last_used_at: string; dormant_days: number; };

export function DropoffsAdmin() {
  const [supabase] = useState(() => createClient());
  const [tab, setTab] = useState<"bootcamp" | "codesprint">("bootcamp");
  const [bc, setBc] = useState<BcDrop[]>([]);
  const [cs, setCs] = useState<CsDrop[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data: b } = await supabase.from("bootcamp_dropoffs").select("*").eq("resolved", false).order("viewed_at", { ascending: false });
    setBc((b as BcDrop[]) ?? []);
    const { data: c } = await supabase.from("codesprint_dropoffs").select("*").order("dormant_days", { ascending: false });
    setCs((c as CsDrop[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function resolve(id: string) {
    await supabase.from("bootcamp_dropoffs").update({ resolved: true }).eq("id", id);
    setBc((x) => x.filter((r) => r.id !== id));
  }
  const wa = (phone: string) => `https://wa.me/${(phone || "").replace(/\D/g, "")}`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 text-white">
      <h1 className="font-display text-2xl font-extrabold">Drop-offs</h1>
      <p className="mt-1 text-sm text-white/55">Logged-in users who engaged but didn&apos;t convert. Message them or push into an automation.</p>
      <div className="mt-5 flex gap-2">
        {(["bootcamp", "codesprint"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={["rounded-full px-4 py-1.5 text-sm font-semibold capitalize", tab === t ? "bg-[#7629fc] text-white" : "border border-white/15 text-white/70"].join(" ")}>
            {t} ({t === "bootcamp" ? bc.length : cs.length})
          </button>
        ))}
      </div>

      {loading ? <p className="mt-6 text-white/50">Loading…</p> : tab === "bootcamp" ? (
        <div className="mt-5 overflow-x-auto rounded-2xl border border-white/12">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/[0.04] text-white/50"><tr>
              <th className="p-3">Name</th><th className="p-3">Event</th><th className="p-3">Contact</th><th className="p-3">Viewed</th><th className="p-3">Actions</th>
            </tr></thead>
            <tbody>
              {bc.map((r) => (
                <tr key={r.id} className="border-t border-white/8">
                  <td className="p-3 font-medium">{r.full_name}</td>
                  <td className="p-3 text-white/80">{r.event_name}</td>
                  <td className="p-3 text-white/70">{r.email}<br />{r.phone}</td>
                  <td className="p-3 font-mono text-xs text-white/50">{new Date(r.viewed_at).toLocaleString()}</td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      {r.email && <a href={`mailto:${r.email}`} className="rounded border border-white/20 px-2 py-1 text-xs">Email</a>}
                      {r.phone && <a href={wa(r.phone)} target="_blank" className="rounded border border-[#34c759]/40 px-2 py-1 text-xs text-[#7ee2a0]">WhatsApp</a>}
                      <button onClick={() => resolve(r.id)} className="rounded bg-white/10 px-2 py-1 text-xs">Resolve</button>
                    </div>
                  </td>
                </tr>
              ))}
              {bc.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-white/40">No bootcamp drop-offs.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto rounded-2xl border border-white/12">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/[0.04] text-white/50"><tr>
              <th className="p-3">Name</th><th className="p-3">Contact</th><th className="p-3">Started module?</th><th className="p-3">Dormant (days)</th><th className="p-3">Actions</th>
            </tr></thead>
            <tbody>
              {cs.map((r) => (
                <tr key={r.user_id} className="border-t border-white/8">
                  <td className="p-3 font-medium">{r.full_name}</td>
                  <td className="p-3 text-white/70">{r.email}<br />{r.phone}</td>
                  <td className="p-3">{r.started_any_module ? "Yes" : "No"}</td>
                  <td className="p-3 font-mono">{r.dormant_days ?? "—"}</td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      {r.email && <a href={`mailto:${r.email}`} className="rounded border border-white/20 px-2 py-1 text-xs">Email</a>}
                      {r.phone && <a href={wa(r.phone)} target="_blank" className="rounded border border-[#34c759]/40 px-2 py-1 text-xs text-[#7ee2a0]">WhatsApp</a>}
                    </div>
                  </td>
                </tr>
              ))}
              {cs.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-white/40">No CodeSprint drop-offs.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
