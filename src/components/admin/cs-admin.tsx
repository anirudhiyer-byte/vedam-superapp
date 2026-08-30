"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Lesson = { id: string; module_id: string; title: string; video_url: string | null; video_source: string; order: number; points: number };
type Module = { id: string; slug: string; title: string; subtitle: string | null; taught_by: string | null; level: string | null; duration_label: string | null; order: number; published: boolean; points_per_lesson: number; points_module_complete: number; points_share: number; cs_lessons: Lesson[] };
type Analytics = { module_id: string; title: string; total_lessons: number; enrolled: number; started: number; completed: number; avg_completion: number; median_completion: number; not_started: number; certs_issued: number };

const field = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-[color:rgb(var(--accent))]";

export function CsAdmin() {
  const [supabase] = useState(() => createClient());
  const [tab, setTab] = useState<"modules" | "analytics">("modules");
  const [modules, setModules] = useState<Module[]>([]);
  const [analytics, setAnalytics] = useState<Analytics[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    const { data } = await supabase.from("cs_modules").select("*, cs_lessons(*)").order("order");
    const mods = (data as Module[] ?? []).map((m) => ({ ...m, cs_lessons: (m.cs_lessons ?? []).sort((a, b) => a.order - b.order) }));
    setModules(mods); setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { if (tab === "analytics") supabase.rpc("cs_module_analytics").then(({ data }) => setAnalytics((data as Analytics[]) ?? [])); }, [tab, supabase]);

  async function addModule() {
    const slug = `module-${Date.now().toString(36)}`;
    await supabase.from("cs_modules").insert({ slug, title: "New module", order: modules.length + 1 });
    load();
  }
  async function saveModule(m: Module) {
    await supabase.from("cs_modules").update({ title: m.title, slug: m.slug, subtitle: m.subtitle, taught_by: m.taught_by, level: m.level, duration_label: m.duration_label, order: m.order, published: m.published, points_per_lesson: m.points_per_lesson, points_module_complete: m.points_module_complete, points_share: m.points_share }).eq("id", m.id);
  }
  async function delModule(id: string) { if (confirm("Delete this module and its lessons?")) { await supabase.from("cs_modules").delete().eq("id", id); load(); } }
  async function addLesson(moduleId: string, order: number) { await supabase.from("cs_lessons").insert({ module_id: moduleId, title: "New lesson", order: order + 1 }); load(); }
  async function saveLesson(l: Lesson) { await supabase.from("cs_lessons").update({ title: l.title, video_url: l.video_url, video_source: l.video_source, order: l.order, points: l.points }).eq("id", l.id); }
  async function delLesson(id: string) { if (confirm("Delete this lesson?")) { await supabase.from("cs_lessons").delete().eq("id", id); load(); } }

  const setMod = (id: string, patch: Partial<Module>) => setModules((ms) => ms.map((m) => m.id === id ? { ...m, ...patch } : m));
  const setLes = (mid: string, lid: string, patch: Partial<Lesson>) => setModules((ms) => ms.map((m) => m.id === mid ? { ...m, cs_lessons: m.cs_lessons.map((l) => l.id === lid ? { ...l, ...patch } : l) } : m));

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <span className="font-mono text-xs font-semibold lowercase tracking-[0.12em] text-accent">// codesprint</span>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="font-display text-3xl font-extrabold tracking-tight text-heading">CodeSprint</h1>
          <p className="mt-1 font-body text-sm text-muted">Modules, lessons, points and completion analytics.</p></div>
        {tab === "modules" && <button onClick={addModule} className="rounded-xl bg-brand-gradient px-5 py-2.5 text-sm font-semibold text-white">+ New module</button>}
      </div>

      <div className="mb-5 mt-5 flex gap-2">
        {(["modules", "analytics"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={["rounded-lg px-4 py-2 font-mono text-xs font-semibold capitalize", tab === t ? "bg-brand-gradient text-white" : "border border-border-strong bg-surface text-muted"].join(" ")}>{t}</button>
        ))}
      </div>

      {loading ? <div className="h-64 animate-pulse rounded-2xl border border-border bg-surface" /> : tab === "analytics" ? (
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-border">{["Module", "Lessons", "Enrolled", "Started", "Completed", "Avg %", "Median %", "Not started", "Certs"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-3 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted">{h}</th>)}</tr></thead>
            <tbody>{analytics.map((a) => (
              <tr key={a.module_id} className="border-b border-border last:border-0">
                <td className="px-3 py-2.5 font-display font-semibold text-heading">{a.title}</td>
                <td className="px-3 py-2.5 text-muted">{a.total_lessons}</td><td className="px-3 py-2.5 text-muted">{a.enrolled}</td>
                <td className="px-3 py-2.5 text-primary">{a.started}</td><td className="px-3 py-2.5 text-accent">{a.completed}</td>
                <td className="px-3 py-2.5 text-muted">{a.avg_completion}%</td><td className="px-3 py-2.5 text-muted">{a.median_completion}%</td>
                <td className="px-3 py-2.5 text-[#E80074]">{a.not_started}</td><td className="px-3 py-2.5 text-muted">{a.certs_issued}</td>
              </tr>))}
              {analytics.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center font-body text-sm text-muted">No data yet.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-3">
          {modules.map((m) => (
            <div key={m.id} className="rounded-2xl border border-border bg-surface p-4">
              <div className="grid gap-2 sm:grid-cols-2">
                <input value={m.title} onChange={(e) => setMod(m.id, { title: e.target.value })} onBlur={() => saveModule(m)} placeholder="Title" className={field} />
                <input value={m.slug} onChange={(e) => setMod(m.id, { slug: e.target.value })} onBlur={() => saveModule(m)} placeholder="slug" className={field + " font-mono"} />
                <input value={m.taught_by ?? ""} onChange={(e) => setMod(m.id, { taught_by: e.target.value })} onBlur={() => saveModule(m)} placeholder="Taught by (e.g. Google)" className={field} />
                <input value={m.duration_label ?? ""} onChange={(e) => setMod(m.id, { duration_label: e.target.value })} onBlur={() => saveModule(m)} placeholder="Duration label" className={field} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 font-mono text-xs text-muted">lesson<input type="number" value={m.points_per_lesson} onChange={(e) => setMod(m.id, { points_per_lesson: +e.target.value })} onBlur={() => saveModule(m)} className={field + " w-16"} /></label>
                <label className="flex items-center gap-1.5 font-mono text-xs text-muted">module<input type="number" value={m.points_module_complete} onChange={(e) => setMod(m.id, { points_module_complete: +e.target.value })} onBlur={() => saveModule(m)} className={field + " w-16"} /></label>
                <label className="flex items-center gap-1.5 font-mono text-xs text-muted">share<input type="number" value={m.points_share} onChange={(e) => setMod(m.id, { points_share: +e.target.value })} onBlur={() => saveModule(m)} className={field + " w-16"} /></label>
                <label className="flex items-center gap-1.5 font-mono text-xs text-muted"><input type="checkbox" checked={m.published} onChange={(e) => { setMod(m.id, { published: e.target.checked }); setTimeout(() => saveModule({ ...m, published: e.target.checked }), 0); }} className="h-4 w-4 accent-[color:rgb(var(--accent))]" />published</label>
                <button onClick={() => setOpen(open === m.id ? null : m.id)} className="ml-auto font-mono text-xs text-accent">{open === m.id ? "hide lessons" : `lessons (${m.cs_lessons.length})`}</button>
                <button onClick={() => delModule(m.id)} className="font-mono text-xs text-red-500">delete</button>
              </div>

              {open === m.id && (
                <div className="mt-3 space-y-2 border-t border-border pt-3">
                  {m.cs_lessons.map((l) => (
                    <div key={l.id} className="flex flex-wrap items-center gap-2">
                      <input type="number" value={l.order} onChange={(e) => setLes(m.id, l.id, { order: +e.target.value })} onBlur={() => saveLesson(l)} className={field + " w-14"} />
                      <input value={l.title} onChange={(e) => setLes(m.id, l.id, { title: e.target.value })} onBlur={() => saveLesson(l)} placeholder="Lesson title" className={field + " min-w-[160px] flex-1"} />
                      <input value={l.video_url ?? ""} onChange={(e) => setLes(m.id, l.id, { video_url: e.target.value })} onBlur={() => saveLesson(l)} placeholder="Video URL" className={field + " min-w-[160px] flex-1 font-mono text-xs"} />
                      <select value={l.video_source} onChange={(e) => { setLes(m.id, l.id, { video_source: e.target.value }); setTimeout(() => saveLesson({ ...l, video_source: e.target.value }), 0); }} className={field}><option value="youtube">YouTube</option><option value="drive">Drive</option></select>
                      <button onClick={() => delLesson(l.id)} className="font-mono text-xs text-red-500">✕</button>
                    </div>
                  ))}
                  <button onClick={() => addLesson(m.id, m.cs_lessons.length)} className="font-mono text-xs text-accent hover:underline">+ add lesson</button>
                </div>
              )}
            </div>
          ))}
          {modules.length === 0 && <p className="font-body text-sm text-muted">No modules yet — create one to get started.</p>}
        </div>
      )}
    </div>
  );
}
