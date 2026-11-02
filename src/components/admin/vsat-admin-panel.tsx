"use client";
import { useState } from "react";
import Link from "next/link";
import { VsatFormBuilder } from "@/components/admin/vsat-form-builder";
import { VsatExamCenter, type WheeboxStatus } from "@/components/admin/vsat-exam-center";
import { VsatExamDates } from "@/components/admin/vsat-exam-dates";
import { GrowthHub } from "@/components/admin/growth-hub";

/**
 * VSAT Admin Panel — one home for everything VSAT, with the Growth panel folded in.
 *
 * Top-of-sidebar pills switch between VSAT and Growth. The VSAT side groups tools
 * into categories (Leads & Applications, Process, Settings, Communications); the
 * Growth side shows the existing Growth hub exactly as built.
 *
 * Built tools are mounted inline (Form Builder, Exam Center — with Exam dates
 * merged in). The rest are placeholders we'll build out at the admin level next.
 */

type Item = { key: string; label: string; soon?: boolean };
type Category = { title: string; items: Item[] };

const CATEGORIES: Category[] = [
  { title: "Leads & Applications", items: [
    { key: "leads", label: "VSAT Leads", soon: true },
    { key: "applications", label: "VSAT Applications", soon: true },
  ] },
  { title: "VSAT Process", items: [
    { key: "exam", label: "VSAT Exam", soon: true },
    { key: "interview", label: "Interview", soon: true },
    { key: "counselling", label: "Counselling", soon: true },
  ] },
  { title: "VSAT Settings", items: [
    { key: "form-builder", label: "Form Builder" },
    { key: "exam-center", label: "Exam Center" },
  ] },
  { title: "VSAT Communications", items: [
    { key: "comms", label: "Communications", soon: true },
  ] },
];

const EXTERNAL = [
  { href: "/vsat", label: "VSAT registration (internal)" },
  { href: "/vsat/dashboard", label: "Applicant dashboard" },
  { href: "/admin/vsat-early", label: "Early-Reg Analytics" },
];

const soonBadge = "ml-auto rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white/40";

function Placeholder({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white/5 text-xl">🧩</div>
      <h2 className="mt-4 font-display text-xl font-bold text-white">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-white/50">This section isn&apos;t built yet. We&apos;re wiring up the VSAT admin level next — Leads &amp; Applications (like Product Users), the Process actions, and Communications.</p>
      <span className="mt-4 inline-block rounded-full border border-white/15 px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-white/40">Coming next</span>
    </div>
  );
}

export function VsatAdminPanel({ wheebox }: { wheebox: WheeboxStatus }) {
  const [panel, setPanel] = useState<"vsat" | "growth">("vsat");
  const [active, setActive] = useState("form-builder");

  const labelFor = (k: string) => CATEGORIES.flatMap((c) => c.items).find((i) => i.key === k)?.label ?? k;

  return (
    <div className="flex min-h-[calc(100vh-64px)]">
      {/* ── sidebar ── */}
      <aside className="w-60 shrink-0 border-r border-white/10 bg-white/[0.02]">
        <div className="sticky top-0 p-4">
          {/* pills */}
          <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-white/[0.04] p-1">
            {(["vsat", "growth"] as const).map((p) => (
              <button key={p} onClick={() => setPanel(p)}
                className={`rounded-lg py-1.5 text-xs font-bold uppercase tracking-wide transition ${panel === p ? "bg-gradient-to-r from-[#00cfe5] to-[#c200db] text-white" : "text-white/55 hover:text-white"}`}>
                {p === "vsat" ? "VSAT" : "Growth"}
              </button>
            ))}
          </div>

          {panel === "vsat" ? (
            <>
              <nav className="mt-4 space-y-4">
                {CATEGORIES.map((cat) => (
                  <div key={cat.title}>
                    <p className="mb-1.5 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">{cat.title}</p>
                    <div className="space-y-0.5">
                      {cat.items.map((it) => (
                        <button key={it.key} onClick={() => setActive(it.key)}
                          className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition ${active === it.key ? "bg-white/10 font-semibold text-white" : "text-white/60 hover:bg-white/5 hover:text-white/90"}`}>
                          <span className="truncate">{it.label}</span>
                          {it.soon && <span className={soonBadge}>soon</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </nav>
              <div className="mt-5 border-t border-white/10 pt-3">
                <p className="mb-1.5 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">Open</p>
                {EXTERNAL.map((e) => (
                  <Link key={e.href} href={e.href} className="block rounded-lg px-2.5 py-1.5 text-[13px] text-white/60 transition hover:bg-white/5 hover:text-white/90">{e.label} ↗</Link>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-4 px-2 text-[13px] leading-relaxed text-white/45">The full Growth panel, exactly as built — marketing &amp; admissions dashboards.</p>
          )}
        </div>
      </aside>

      {/* ── main ── */}
      <main className="min-w-0 flex-1">
        {panel === "growth" ? (
          <GrowthHub />
        ) : active === "form-builder" ? (
          <VsatFormBuilder />
        ) : active === "exam-center" ? (
          <div>
            <VsatExamCenter wheebox={wheebox} />
            {/* Exam dates merged into the Exam Center view */}
            <div className="mx-auto max-w-3xl px-6">
              <div className="border-t border-white/10 pt-2" />
            </div>
            <VsatExamDates />
          </div>
        ) : (
          <Placeholder title={labelFor(active)} />
        )}
      </main>
    </div>
  );
}
