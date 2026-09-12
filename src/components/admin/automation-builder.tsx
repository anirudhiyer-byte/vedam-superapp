"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Cond = { col: string; op: string; value: string; join: "AND" | "OR" };
const SOURCES = ["vedam_one_profiles", "vedam_one", "bootcamp_participation", "bootcamp_dropoffs", "codesprint_participation", "codesprint_dropoffs"];
const OPS = ["=", "<>", ">", "<", ">=", "<=", "ilike", "contains", "is null", "is not null"];
const inp = "rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-sm text-white outline-none focus:border-white/40";

type Auto = { id: string; name: string; scope: string; product: string | null; source_table: string; active: boolean; channels: string[]; trigger_type: string; };

export function AutomationBuilder() {
  const [supabase] = useState(() => createClient());
  const [list, setList] = useState<Auto[]>([]);
  const [name, setName] = useState("");
  const [scope, setScope] = useState("product");
  const [product, setProduct] = useState("bootcamp");
  const [source, setSource] = useState("vedam_one_profiles");
  const [conds, setConds] = useState<Cond[]>([{ col: "", op: "=", value: "", join: "AND" }]);
  const [channels, setChannels] = useState<string[]>(["email"]);
  const [triggerType, setTriggerType] = useState("on_condition");
  const [triggerTime, setTriggerTime] = useState("09:00");
  const [saving, setSaving] = useState(false);
  const [matchInfo, setMatchInfo] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.from("product_automations").select("id,name,scope,product,source_table,active,channels,trigger_type").order("created_at", { ascending: false });
    setList((data as Auto[]) ?? []);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function save() {
    setSaving(true);
    const { error } = await supabase.from("product_automations").insert({
      name, scope, product: scope === "global" ? null : product, source_table: source,
      conditions: conds.filter((c) => c.col), channels,
      trigger_type: triggerType, trigger_time: triggerType === "time_of_day" ? triggerTime : null,
    });
    setSaving(false);
    if (!error) { setName(""); setConds([{ col: "", op: "=", value: "", join: "AND" }]); load(); }
    else alert(error.message);
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 text-white">
      <h1 className="font-display text-2xl font-extrabold">Automations</h1>
      <p className="mt-1 text-sm text-white/55">Pick a data table, build conditions, choose channels + trigger. Email + WhatsApp.</p>

      <div className="mt-6 space-y-4 rounded-2xl border border-white/12 bg-white/[0.04] p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Name<input className={inp + " mt-1 w-full"} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bootcamp drop-off nudge" /></label>
          <label className="text-sm">Scope
            <select className={inp + " mt-1 w-full"} value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="product">Product</option><option value="global">Global</option>
            </select>
          </label>
          {scope === "product" && <label className="text-sm">Product
            <select className={inp + " mt-1 w-full"} value={product} onChange={(e) => setProduct(e.target.value)}>
              <option value="bootcamp">Bootcamp</option><option value="codesprint">CodeSprint</option><option value="college_predictor">College Predictor</option>
            </select>
          </label>}
          <label className="text-sm">Source table
            <select className={inp + " mt-1 w-full"} value={source} onChange={(e) => setSource(e.target.value)}>
              {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>

        <div>
          <div className="mb-2 text-sm font-semibold">Conditions (if/else · AND/OR)</div>
          {conds.map((c, i) => (
            <div key={i} className="mb-2 flex flex-wrap items-center gap-2">
              {i > 0 && (
                <select className={inp} value={c.join} onChange={(e) => setConds((x) => x.map((y, j) => j === i ? { ...y, join: e.target.value as "AND" | "OR" } : y))}>
                  <option>AND</option><option>OR</option>
                </select>
              )}
              <input className={inp + " w-44"} placeholder="column" value={c.col} onChange={(e) => setConds((x) => x.map((y, j) => j === i ? { ...y, col: e.target.value } : y))} />
              <select className={inp} value={c.op} onChange={(e) => setConds((x) => x.map((y, j) => j === i ? { ...y, op: e.target.value } : y))}>{OPS.map((o) => <option key={o}>{o}</option>)}</select>
              {!c.op.includes("null") && <input className={inp + " w-40"} placeholder="value" value={c.value} onChange={(e) => setConds((x) => x.map((y, j) => j === i ? { ...y, value: e.target.value } : y))} />}
              <button onClick={() => setConds((x) => x.filter((_, j) => j !== i))} className="text-white/40 hover:text-white">✕</button>
            </div>
          ))}
          <button onClick={() => setConds((x) => [...x, { col: "", op: "=", value: "", join: "AND" }])} className="text-sm text-[#8fe9f5]">+ add condition</button>
          <p className="mt-1 font-mono text-[11px] text-white/40">Tip: e.g. days_since_signup ≥ 3 AND activity_count_since_signup = 0 → new sign-ups gone cold.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="text-sm">Channels
            <div className="mt-1 flex gap-3">
              {["email", "whatsapp"].map((ch) => (
                <label key={ch} className="flex items-center gap-1.5"><input type="checkbox" checked={channels.includes(ch)} onChange={(e) => setChannels((x) => e.target.checked ? [...x, ch] : x.filter((y) => y !== ch))} />{ch}</label>
              ))}
            </div>
          </div>
          <label className="text-sm">Trigger
            <select className={inp + " mt-1 w-full"} value={triggerType} onChange={(e) => setTriggerType(e.target.value)}>
              <option value="on_condition">As soon as conditions are met</option>
              <option value="time_of_day">At a time of day</option>
            </select>
          </label>
          {triggerType === "time_of_day" && <label className="text-sm">Time<input type="time" className={inp + " mt-1 w-full"} value={triggerTime} onChange={(e) => setTriggerTime(e.target.value)} /></label>}
        </div>

        <div className="flex gap-3">
          <button disabled={saving || !name} onClick={save} className="rounded-xl bg-[#7629fc] px-5 py-2 text-sm font-semibold disabled:opacity-50">{saving ? "Saving…" : "Create automation"}</button>
        </div>
      </div>

      <h2 className="mt-8 font-display text-lg font-bold">Existing automations</h2>
      <div className="mt-3 space-y-2">
        {list.map((a) => (
          <div key={a.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div><div className="font-semibold">{a.name}</div><div className="font-mono text-xs text-white/50">{a.scope} · {a.product ?? "all"} · {a.source_table} · {a.channels?.join("+")} · {a.trigger_type}</div></div>
            <span className={a.active ? "text-[#34c759]" : "text-white/40"}>{a.active ? "● active" : "○ off"}</span>
          </div>
        ))}
        {list.length === 0 && <p className="text-sm text-white/40">No automations yet.</p>}
      </div>
    </div>
  );
}
