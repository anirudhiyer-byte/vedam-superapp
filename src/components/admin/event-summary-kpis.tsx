"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Summary = {
  total_registrations: number; total_dropoffs: number; registration_pct: number | null;
  attendees: number; stayed_75_and_full: number; github_shares: number;
  cert_linkedin_shares: number; winner_cert_linkedin_shares: number;
};

export function EventSummaryKpis({ eventId }: { eventId: string }) {
  const [supabase] = useState(() => createClient());
  const [s, setS] = useState<Summary | null>(null);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("bootcamp_event_summary").select("*").eq("event_id", eventId).maybeSingle();
      setS((data as Summary) ?? null);
    })();
  }, [supabase, eventId]);
  const items: [string, string | number][] = [
    ["Total Registrations", s?.total_registrations ?? 0],
    ["Total Drop-offs", s?.total_dropoffs ?? 0],
    ["Registration %", s?.registration_pct != null ? `${s.registration_pct}%` : "—"],
    ["Attendees (joined Zoom)", s?.attendees ?? 0],
    ["Stayed >75% / full", s?.stayed_75_and_full ?? 0],
    ["GitHub repos shared", s?.github_shares ?? 0],
    ["Cert LinkedIn shares", s?.cert_linkedin_shares ?? 0],
    ["Winner-cert LinkedIn shares", s?.winner_cert_linkedin_shares ?? 0],
  ];
  return (
    <div className="rounded-2xl border border-white/12 bg-white/[0.04] p-5 backdrop-blur">
      <h3 className="mb-4 font-display text-lg font-bold text-white">Event summary</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map(([label, val]) => (
          <div key={label} className="rounded-xl border border-white/10 bg-black/30 p-3">
            <div className="font-mono text-[10px] uppercase tracking-wide text-white/45">{label}</div>
            <div className="mt-1 font-display text-2xl font-extrabold text-white">{val}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
