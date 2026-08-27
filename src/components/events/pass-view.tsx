"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import InvitePass from "@/components/events/invite-pass";
import { extractSlotFromAnswers } from "@/lib/slot";
import { downloadNodePng } from "@/lib/download-node";

export function PassView() {
  const params = useSearchParams();
  const code = params.get("e") || "";
  const [supabase] = useState(() => createClient());
  const [pass, setPass] = useState<{ name: string; slot: string; date?: { day: string; month: string; weekday: string } } | null>(null);
  const [status, setStatus] = useState<"loading" | "need_login" | "not_found" | "ok">("loading");
  const [scale, setScale] = useState(0.7);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setScale(Math.min((window.innerWidth - 32) / 1000, 1));
    let active = true;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { if (active) setStatus("need_login"); return; }
      const { data: reg } = await supabase.from("event_registrations")
        .select("full_name, answers, event_id").eq("event_code", code).eq("user_id", u.user.id).maybeSingle();
      if (!reg) { if (active) setStatus("not_found"); return; }
      let date: { day: string; month: string; weekday: string } | undefined;
      if (reg.event_id) {
        const { data: ev } = await supabase.from("events").select("starts_at").eq("id", reg.event_id).single();
        if (ev?.starts_at) {
          const d = new Date(ev.starts_at);
          date = {
            day: d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric" }),
            month: d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", month: "long" }).toUpperCase(),
            weekday: d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short" }).toUpperCase(),
          };
        }
      }
      if (active) {
        setPass({ name: reg.full_name || "Guest", slot: extractSlotFromAnswers(reg.answers as Record<string, unknown>), date });
        setStatus("ok");
      }
    })();
    return () => { active = false; };
  }, [code, supabase]);

  if (status === "loading") return <div className="flex min-h-screen items-center justify-center"><div className="h-40 w-80 animate-pulse rounded-xl border border-border bg-surface" /></div>;
  if (status === "need_login") return <Centered title="Log in to view your pass" cta={<Link href={`/login?next=/pass?e=${code}`} className="rounded-xl bg-brand-gradient px-6 py-3 text-sm font-semibold text-white">Log in</Link>} />;
  if (status === "not_found" || !pass) return <Centered title="No pass found" sub="You don't have a registration for this event." />;

  return (
    <div className="flex min-h-screen flex-col items-center gap-6 px-4 py-10">
      <div className="rounded-xl border border-border shadow-lg">
        <InvitePass ref={ref} fullName={pass.name} slot={pass.slot} eventDate={pass.date} scale={scale} />
      </div>
      <button onClick={() => ref.current && downloadNodePng(ref.current, `vedam-pass-${code}.png`)}
        className="rounded-xl bg-brand-gradient px-6 py-3 text-sm font-semibold text-white">Download PNG</button>
    </div>
  );
}

function Centered({ title, sub, cta }: { title: string; sub?: string; cta?: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="font-display text-2xl font-bold text-heading">{title}</h1>
      {sub && <p className="font-body text-sm text-muted">{sub}</p>}
      {cta}
    </div>
  );
}
