"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { cx, vx } from "@/components/admin/ui/vx";

/**
 * Admin toggles for the two VSAT landing pages (Exam Center). Each switch flips an
 * app_flag via an admin-only RPC:
 *   /apply (new VSAT signup)       ← vsat_public         (ON = public, OFF = admins only)
 *   /vsat  (old early-registration) ← vsat_legacy_public  (ON = public, OFF = admins only)
 * Go-live = turn /apply ON and /vsat OFF.
 */
type Flags = { vsat_public?: string; vsat_legacy_public?: string };
const card = cx(vx.card, "p-5 sm:p-6");

export function VsatLandingToggles() {
  const [supabase] = useState(() => createClient());
  const [flags, setFlags] = useState<Flags>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    const { data, error } = await supabase.rpc("vsat_landing_flags_get");
    setLoading(false);
    if (error) { setErr("Admins only."); return; }
    setFlags((data as Flags) ?? {});
  }, [supabase]);
  useEffect(() => { void load(); }, [load]);

  async function toggle(key: "vsat_public" | "vsat_legacy_public") {
    const next = flags[key] === "on" ? "off" : "on";
    setBusy(key); setErr("");
    const { data, error } = await supabase.rpc("vsat_landing_flag_set", { p: { key, value: next } });
    setBusy("");
    if (error || !data?.ok) { setErr("Couldn't update the toggle."); return; }
    setFlags((f) => ({ ...f, [key]: next }));
  }

  function row(key: "vsat_public" | "vsat_legacy_public", title: string, desc: ReactNode) {
    const on = flags[key] === "on";
    return (
      <div className="flex items-center justify-between gap-4 border-t border-vx-line py-3 first:border-t-0">
        <div>
          <div className="text-sm font-semibold text-vx-ink">{title}</div>
          <div className="text-[11px] text-vx-faint">{desc}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[12.5px] font-medium ${on ? "text-vx-green" : "text-vx-faint"}`}>{on ? "Public" : "Admins only"}</span>
          <button onClick={() => toggle(key)} disabled={!!busy || loading} aria-label={`toggle ${title}`}
            className={`relative h-7 w-12 shrink-0 rounded-full transition ${on ? "bg-vx-green" : "bg-white/15"} disabled:opacity-50`}>
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${on ? "left-6" : "left-1"}`} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className={`${card} mt-6`}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-vx-ink">Landing pages</h2>
        <span className="text-xs text-vx-faint">{loading ? "…" : "Go-live: /apply ON, /vsat OFF"}</span>
      </div>
      <div className="mt-3">
        {row("vsat_public", "New VSAT signup — /apply", "The main signup landing. ON = all students; OFF = admins only (students sent to the early-reg).")}
        {row("vsat_legacy_public", "Old early-registration — /vsat", "The previous one-click form. ON = public; OFF = admins only (archived). Its data is untouched.")}
      </div>
      {err && <p className="mt-3 text-xs font-semibold text-vx-red">{err}</p>}
    </section>
  );
}
