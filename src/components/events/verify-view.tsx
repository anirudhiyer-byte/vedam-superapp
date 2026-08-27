"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function VerifyView() {
  const params = useSearchParams();
  const certId = params.get("c") || "";
  const [supabase] = useState(() => createClient());
  const [state, setState] = useState<"loading" | "valid" | "invalid">("loading");
  const [data, setData] = useState<{ full_name: string; event_name: string; issued_on: string; kind?: string } | null>(null);

  useEffect(() => {
    if (!certId) { setState("invalid"); return; }
    let active = true;
    (async () => {
      const { data: rows } = await supabase.rpc("verify_certificate", { p_id: certId });
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (!active) return;
      if (row?.valid) { setData({ full_name: row.full_name, event_name: row.event_name, issued_on: row.issued_on, kind: row.kind }); setState("valid"); }
      else setState("invalid");
    })();
    return () => { active = false; };
  }, [certId, supabase]);

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 text-center">
        {state === "loading" && <p className="font-body text-sm text-muted">Verifying…</p>}
        {state === "invalid" && (
          <>
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-2xl">✕</div>
            <h1 className="font-display text-xl font-bold text-heading">Not a valid certificate</h1>
            <p className="mt-2 font-body text-sm text-muted">We couldn&apos;t verify this certificate ID.</p>
          </>
        )}
        {state === "valid" && data && (
          <>
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-gradient text-2xl text-white">✓</div>
            <h1 className="font-display text-xl font-bold text-heading">Verified {data.kind === "winner" ? "winner " : ""}certificate</h1>
            {data.kind === "winner" && <span className="mt-1 inline-block rounded-full bg-[linear-gradient(120deg,#B8860B,#F5C542)] px-3 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-[#3a2a00]">🏆 Winner</span>}
            <p className="mt-4 font-body text-sm text-muted">Issued to</p>
            <p className="font-display text-lg font-bold text-heading">{data.full_name}</p>
            <p className="mt-3 font-body text-sm text-muted">for</p>
            <p className="font-body text-base font-semibold text-foreground">{data.event_name}</p>
            <p className="mt-4 font-mono text-xs text-muted">Issued {new Date(data.issued_on).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric" })}</p>
          </>
        )}
      </div>
    </div>
  );
}
