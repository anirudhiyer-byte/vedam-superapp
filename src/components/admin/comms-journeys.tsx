"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Cond = { field: string; op: string; value: string; value2?: string };
type Branch = { kind: "if" | "elif" | "else"; match: "all" | "any"; conditions: Cond[]; template_ref: string; message_type: string };
type Journey = { id: string; name: string; enabled: boolean; channel: string; product: string; branches: Branch[]; last_run_at: string | null };

const FIELDS: { key: string; label: string; type: "num" | "bool" | "date" | "text" }[] = [
  { key: "signup", label: "Signup date", type: "date" },
  { key: "state", label: "State", type: "text" },
  { key: "events_reg", label: "Events registered", type: "num" },
  { key: "events_attended", label: "Events attended", type: "num" },
  { key: "cs_enrolled", label: "CodeSprint enrolled", type: "bool" },
  { key: "cs_modules", label: "Modules completed", type: "num" },
  { key: "cs_completed_all", label: "Completed all modules", type: "bool" },
  { key: "cp_used", label: "Used College Predictor", type: "bool" },
  { key: "points", label: "Points", type: "num" },
];
const OPS: Record<string, [string, string][]> = {
  num: [["gte", "≥"], ["gt", ">"], ["eq", "="], ["ne", "≠"], ["lte", "≤"], ["lt", "<"], ["between", "between"]],
  date: [["after", "after"], ["before", "before"], ["between", "between"]],
  bool: [["is_true", "is true"], ["is_false", "is false"]],
  text: [["eq", "is"], ["ne", "is not"]],
};
const ftype = (f: string) => FIELDS.find((x) => x.key === f)?.type || "num";

export function CommsJourneys({ channel, product }: { channel: "whatsapp" | "email"; product: string }) {
  const [supabase] = useState(() => createClient());
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [waTpls, setWaTpls] = useState<{ ref: string; label: string }[]>([]);
  const [emTpls, setEmTpls] = useState<{ ref: string; label: string }[]>([]);

  const [name, setName] = useState("");
  const [branches, setBranches] = useState<Branch[]>([
    { kind: "if", match: "all", conditions: [{ field: "cs_modules", op: "gte", value: "1" }], template_ref: "", message_type: "media" },
    { kind: "else", match: "all", conditions: [], template_ref: "", message_type: "media" },
  ]);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.from("comms_journeys").select("*").eq("channel", channel).order("created_at", { ascending: false });
    setJourneys((data as Journey[]) ?? []);
    const { data: em } = await supabase.from("email_templates").select("id, name, product"); setEmTpls((em as { id: string; name: string; product: string }[] ?? []).filter((t) => product === "all" || t.product === product).map((t) => ({ ref: t.id, label: t.name })));
    const { data: tg } = await supabase.from("comms_template_tags").select("template_ref, product").eq("channel", "whatsapp");
    const tagMap: Record<string, string> = {}; (tg as { template_ref: string; product: string }[] ?? []).forEach((t) => tagMap[t.template_ref] = t.product);
    try { const r = await fetch("/api/whatsapp/templates"); const j = await r.json(); const raw = j?.data;
      const list = Array.isArray(raw) ? raw : Array.isArray(raw?.templates) ? raw.templates : Array.isArray(raw?.data) ? raw.data : [];
      setWaTpls((list as { name?: string; id?: string; status?: string }[]).filter((t) => (t.status || "APPROVED").toUpperCase() === "APPROVED" && (product === "all" || (tagMap[t.name || t.id || ""] || "general") === product)).map((t) => ({ ref: t.name || t.id || "", label: t.name || "" }))); } catch { /* */ }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [channel, product]);

  const templates = channel === "whatsapp" ? waTpls : emTpls;
  const setBr = (i: number, patch: Partial<Branch>) => setBranches((b) => b.map((x, j) => j === i ? { ...x, ...patch } : x));
  const setCond = (bi: number, ci: number, patch: Partial<Cond>) => setBranches((b) => b.map((x, j) => j === bi ? { ...x, conditions: x.conditions.map((c, k) => k === ci ? { ...c, ...patch } : c) } : x));

  function addElif() { setBranches((b) => { const els = b.filter((x) => x.kind === "else"); const rest = b.filter((x) => x.kind !== "else"); return [...rest, { kind: "elif", match: "all", conditions: [{ field: "cs_modules", op: "eq", value: "1" }], template_ref: "", message_type: "media" } as Branch, ...els]; }); }
  function addCond(bi: number) { setBranches((b) => b.map((x, j) => j === bi ? { ...x, conditions: [...x.conditions, { field: "points", op: "gte", value: "0" }] } : x)); }
  function delCond(bi: number, ci: number) { setBranches((b) => b.map((x, j) => j === bi ? { ...x, conditions: x.conditions.filter((_, k) => k !== ci) } : x)); }
  function delBranch(bi: number) { setBranches((b) => b.filter((_, j) => j !== bi)); }

  async function save() {
    setMsg(null);
    if (!name.trim()) return setMsg("Name the journey.");
    if (branches.some((b) => !b.template_ref)) return setMsg("Every branch needs a template.");
    const { error } = await supabase.from("comms_journeys").insert({ name: name.trim(), channel, product: product === "all" ? "general" : product, branches });
    if (error) return setMsg(error.message);
    setMsg("Journey saved & active."); setName(""); load();
  }
  async function toggle(j: Journey) { await supabase.from("comms_journeys").update({ enabled: !j.enabled }).eq("id", j.id); load(); }
  async function del(id: string) { if (confirm("Delete journey?")) { await supabase.from("comms_journeys").delete().eq("id", id); load(); } }

  const field = "rounded-lg border border-border-strong bg-background px-2.5 py-1.5 text-sm text-foreground outline-none";
  const badge = (k: string) => k === "if" ? "IF" : k === "elif" ? "ELSE IF" : "ELSE";
  const badgeCls = (k: string) => k === "if" ? "bg-[#8A18FF]" : k === "elif" ? "bg-[#F97D03]" : "bg-[#7a7396]";

  return (
    <div className="mt-5">
      <div className="rounded-2xl border border-border bg-surface p-5">
        <label className="mb-3 block"><span className="mb-1.5 block font-body text-xs font-semibold text-foreground">Journey name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="CodeSprint progression push" className={field + " w-full max-w-md"} /></label>
        <p className="mb-3 font-body text-xs text-muted">A user matches the <b>first</b> branch whose conditions pass → gets that branch&apos;s template. Runs continuously, once per user per branch.</p>

        {branches.map((br, bi) => (
          <div key={bi} className="mb-2.5 rounded-xl border border-border p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className={"rounded-full px-2.5 py-0.5 font-display text-[11px] font-extrabold text-white " + badgeCls(br.kind)}>{badge(br.kind)}</span>
              {br.kind !== "else" && <>
                <span className="font-body text-xs text-muted">match</span>
                <select value={br.match} onChange={(e) => setBr(bi, { match: e.target.value as "all" | "any" })} className={field + " py-1"}><option value="all">ALL (AND)</option><option value="any">ANY (OR)</option></select>
              </>}
              {br.kind !== "if" && <button onClick={() => delBranch(bi)} className="ml-auto font-mono text-xs text-red-400">remove</button>}
            </div>
            {br.kind !== "else" && (
              <div className="space-y-1.5">
                {br.conditions.map((c, ci) => (
                  <div key={ci} className="flex flex-wrap items-center gap-1.5">
                    <select value={c.field} onChange={(e) => setCond(bi, ci, { field: e.target.value, op: OPS[ftype(e.target.value)][0][0] })} className={field}>{FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select>
                    <select value={c.op} onChange={(e) => setCond(bi, ci, { op: e.target.value })} className={field}>{OPS[ftype(c.field)].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                    {ftype(c.field) !== "bool" && <input value={c.value} onChange={(e) => setCond(bi, ci, { value: e.target.value })} type={ftype(c.field) === "date" ? "date" : ftype(c.field) === "num" ? "number" : "text"} className={field + " w-28"} />}
                    {c.op === "between" && <input value={c.value2 || ""} onChange={(e) => setCond(bi, ci, { value2: e.target.value })} type={ftype(c.field) === "date" ? "date" : "number"} className={field + " w-28"} />}
                    <button onClick={() => delCond(bi, ci)} className="font-mono text-xs text-muted">✕</button>
                  </div>
                ))}
                <button onClick={() => addCond(bi)} className="font-mono text-[11px] text-accent">+ condition</button>
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-surface-warm/50 p-2">
              <span className="font-body text-xs font-semibold text-violet-600" style={{ color: "rgb(var(--accent))" }}>THEN send</span>
              <select value={br.template_ref} onChange={(e) => setBr(bi, { template_ref: e.target.value })} className={field}><option value="">Select template…</option>{templates.map((t) => <option key={t.ref} value={t.ref}>{t.label}</option>)}</select>
              {channel === "whatsapp" && <select value={br.message_type} onChange={(e) => setBr(bi, { message_type: e.target.value })} className={field}><option>media</option><option>text</option><option>text_var</option></select>}
            </div>
          </div>
        ))}
        <button onClick={addElif} className="mb-3 font-mono text-xs text-accent">+ Add ELSE-IF branch</button>
        {msg && <p className="mb-2 font-body text-sm text-foreground">{msg}</p>}
        <div><button onClick={save} className="rounded-xl bg-brand-gradient px-6 py-3 text-sm font-semibold text-white">Save &amp; activate</button></div>
      </div>

      <h3 className="mt-6 mb-2 font-mono text-xs font-semibold uppercase tracking-wide text-muted">Active journeys ({channel})</h3>
      <div className="space-y-2">
        {journeys.length === 0 ? <p className="font-body text-sm text-muted">No journeys yet.</p> : journeys.map((j) => (
          <div key={j.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
            <div className="min-w-0 flex-1"><div className="font-display text-sm font-extrabold text-heading">{j.name}</div><div className="font-body text-xs text-muted">{j.branches.length} branches · {j.product}{j.last_run_at ? ` · last run ${new Date(j.last_run_at).toLocaleDateString("en-IN")}` : ""}</div></div>
            <button onClick={() => toggle(j)} className={["relative h-6 w-11 rounded-full", j.enabled ? "bg-brand-gradient" : "bg-border-strong"].join(" ")}><span className={["absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all", j.enabled ? "left-[22px]" : "left-0.5"].join(" ")} /></button>
            <button onClick={() => del(j.id)} className="font-mono text-xs text-red-400">✕</button>
          </div>
        ))}
      </div>
      <p className="mt-3 font-body text-xs text-muted">A background job evaluates journeys every 30 min. WhatsApp fires now; email journeys activate with the email mirror (next stage).</p>
    </div>
  );
}
