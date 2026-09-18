"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CertificateModal } from "@/components/events/certificate-modal";
import { CsQuiz } from "@/components/codesprint/cs-quiz";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Lesson = { id: string; title: string; video_url: string | null; video_source: string; order: number };
type Module = { id: string; slug: string; title: string; lessons: Lesson[] };
type Progress = { module_id: string; total_lessons: number; completed_lessons: number; cert_id: string | null };

// Normalise a YouTube / Drive URL to an embeddable one.
function embedUrl(url: string | null, source: string): string {
  if (!url) return "";
  if (source === "drive") {
    const m = url.match(/\/d\/([^/]+)/) || url.match(/id=([^&]+)/);
    return m ? `https://drive.google.com/file/d/${m[1]}/preview` : url;
  }
  const m = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : url;
}

export function CsPlayer() {
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const params = useSearchParams();
  const moduleSlug = params.get("module");
  const [modules, setModules] = useState<Module[]>([]);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [certs, setCerts] = useState<Record<string, string>>({});
  const [openModule, setOpenModule] = useState<string | null>(null);
  const [current, setCurrent] = useState<{ moduleId: string; lesson: Lesson } | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openCert, setOpenCert] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        const dest = "/codesprint/learn" + (moduleSlug ? `?module=${moduleSlug}` : "");
        router.push(`/login?next=${encodeURIComponent(dest)}`);
        return;
      }
      await supabase.rpc("cs_enroll");
      const { data: mods } = await supabase.from("cs_modules").select("id, slug, title, cs_lessons(id, title, video_url, video_source, order)").eq("published", true).order("order");
      const list = (mods ?? []).map((m: Record<string, unknown>) => ({ id: m.id, slug: m.slug, title: m.title, lessons: ((m.cs_lessons as Lesson[]) ?? []).sort((a, b) => a.order - b.order) })) as Module[];
      setModules(list);
      // progress
      const { data: prog } = await supabase.from("cs_progress").select("lesson_id");
      setDone(new Set((prog ?? []).map((p) => p.lesson_id)));
      const { data: myProg } = await supabase.rpc("cs_my_progress");
      const cmap: Record<string, string> = {};
      (myProg as Progress[] ?? []).forEach((p) => { if (p.cert_id) cmap[p.module_id] = p.cert_id; });
      setCerts(cmap);
      // pick starting module + lesson
      const startMod = list.find((m) => m.slug === moduleSlug) || list[0];
      if (startMod) {
        try { await supabase.rpc("cs_log_module_start", { p_module: startMod.id }); } catch { /* best effort — logs the lead + creates the participation shell */ }
        setOpenModule(startMod.id);
        const doneSet = new Set((prog ?? []).map((p) => p.lesson_id));
        const next = startMod.lessons.find((l) => !doneSet.has(l.id)) || startMod.lessons[0];
        if (next) setCurrent({ moduleId: startMod.id, lesson: next });
      }
      setLoading(false);
    })();
    // eslint-disable-next-line
  }, [moduleSlug]);

  const currentModule = useMemo(() => modules.find((m) => m.id === current?.moduleId), [modules, current]);

  async function markComplete() {
    if (!current || busy) return;
    setBusy(true);
    const { data } = await supabase.rpc("cs_complete_lesson", { p_lesson_id: current.lesson.id });
    const res = data as { module_complete?: boolean; cert_id?: string } | null;
    setDone((s) => new Set(s).add(current.lesson.id));
    if (res?.module_complete && res.cert_id && currentModule) {
      setCerts((c) => ({ ...c, [currentModule.id]: res.cert_id! }));
      setToast(`🎉 Module complete! Certificate earned (+50 pts).`);
      // email the certificate (best effort)
      const { data: s } = await supabase.auth.getSession();
      void fetch("/api/codesprint/send-certificate", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ certId: res.cert_id, moduleName: currentModule.title, origin: window.location.origin, accessToken: s.session?.access_token }) });
    } else {
      setToast("Lesson complete · +10 pts");
    }
    setTimeout(() => setToast(null), 4000);
    // advance to next lesson
    if (currentModule) {
      const idx = currentModule.lessons.findIndex((l) => l.id === current.lesson.id);
      const next = currentModule.lessons[idx + 1];
      if (next) setCurrent({ moduleId: currentModule.id, lesson: next });
    }
    setBusy(false);
  }

  if (loading) return <div className="min-h-screen bg-[#0d0d0d] px-6 py-12"><div className="mx-auto h-96 max-w-6xl animate-pulse rounded-2xl border border-white/10 bg-[#141418]" /></div>;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0d0d0d]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/cs-polka.webp" alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-[0.14]" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-56" style={{ background: "radial-gradient(120% 100% at 50% 0%,rgba(253,120,3,0.14),transparent 70%)" }} />
      <div className="relative z-10 mx-auto max-w-6xl px-6 py-8">
      <Link href="/codesprint" className="font-mono text-xs text-white/50 hover:text-white/85">← CodeSprint</Link>
      <div className="mt-3 grid gap-6 lg:grid-cols-[1fr_360px] lg:items-start">
        {/* player */}
        <div>
          <h1 className="font-display text-2xl font-bold text-white">{current?.lesson.title || "Select a lesson"}</h1>
          <div className="relative mt-3 aspect-video w-full overflow-hidden rounded-2xl border border-border bg-black">
            {current?.lesson.video_url ? (
              <>
                <iframe src={embedUrl(current.lesson.video_url, current.lesson.video_source)} className="h-full w-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen title={current.lesson.title} />
                {current.lesson.video_source === "drive" && (
                  // Covers Google Drive's "open in new window" pop-out so students aren't
                  // redirected to Drive. Same corner + size as the button; it eats the click.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src="/icon.png" alt="Vedam" title="Vedam" className="absolute right-[10px] top-[10px] h-11 w-11 rounded-lg shadow-md" style={{ zIndex: 2 }} />
                )}
              </>
            ) : <div className="grid h-full place-items-center font-mono text-sm text-white/60">No video linked yet</div>}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#141418] p-4">
            <span className="font-mono text-xs text-white/50">Your progress · watch, then mark complete for +10</span>
            {current && (done.has(current.lesson.id)
              ? <span className="rounded-lg bg-[#FD7B03]/15 px-4 py-2 font-mono text-xs font-semibold text-[#FD8B03]">✓ Completed</span>
              : <button onClick={markComplete} disabled={busy} className="rounded-lg bg-brand-gradient px-5 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Saving…" : "Mark as completed"}</button>)}
          </div>
          {toast && <div className="mt-3 rounded-xl border border-white/10 bg-[#141418]-warm px-4 py-3 font-body text-sm text-white">{toast}</div>}
          {currentModule && currentModule.lessons.length > 0 && currentModule.lessons.every((l) => done.has(l.id)) && !certs[currentModule.id] && (
            <div className="mt-4">
              <CsQuiz moduleId={currentModule.id} onComplete={(cid) => { if (cid && currentModule) { setCerts((c) => ({ ...c, [currentModule.id]: cid })); setToast("🎉 Module complete! Certificate earned."); setTimeout(() => setToast(null), 4000); } }} />
            </div>
          )}
        </div>

        {/* module accordion */}
        <div className="space-y-2">
          <p className="font-mono text-xs font-semibold uppercase tracking-wide text-white/50">All modules</p>
          {modules.map((m) => {
            const total = m.lessons.length;
            const completed = m.lessons.filter((l) => done.has(l.id)).length;
            const open = openModule === m.id;
            const earned = certs[m.id];
            return (
              <div key={m.id} className="overflow-hidden rounded-2xl border border-white/10 bg-[#141418]">
                <button onClick={() => setOpenModule(open ? null : m.id)} className="flex w-full items-center justify-between gap-2 p-4 text-left">
                  <div className="min-w-0"><p className="truncate font-display text-sm font-bold text-white">{m.title}</p>
                    <p className="font-mono text-[11px] text-white/50">{completed}/{total} · {earned ? "✓ certificate earned" : total ? `${Math.round((completed / total) * 100)}%` : "no lessons"}</p></div>
                  <span className="text-white/50">{open ? "▲" : "▼"}</span>
                </button>
                {open && (
                  <div className="border-t border-white/10">
                    {m.lessons.map((l) => (
                      <button key={l.id} onClick={() => setCurrent({ moduleId: m.id, lesson: l })}
                        className={["flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-[#FD7B03]/10", current?.lesson.id === l.id ? "bg-[#FD7B03]/12" : ""].join(" ")}>
                        <span className={done.has(l.id) ? "text-[#FD8B03]" : "text-white/40"}>{done.has(l.id) ? "✓" : "○"}</span>
                        <span className="flex-1 truncate text-white/85">{l.title}</span>
                      </button>
                    ))}
                    {earned && <button onClick={() => setOpenCert(earned)} className="block w-full border-t border-white/10 px-4 py-2.5 text-left font-mono text-xs font-semibold text-[#FD8B03] hover:bg-[#FD7B03]/10">View certificate →</button>}
                    {m.lessons.length === 0 && <p className="px-4 py-3 font-body text-xs text-white/50">No lessons yet.</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    {openCert && <CertificateModal certId={openCert} onClose={() => setOpenCert(null)} />}
      </div>
    </div>
  );
}
