"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DarkSelect } from "@/components/admin/dark-select";

/**
 * Calling Console — the caller's own surface. Shows ONLY leads assigned to the
 * signed-in caller (calling_my_queue) and lets them update just those leads
 * (calling_log_update, whitelisted fields). Stats come from calling_dashboard,
 * which scopes to the caller automatically. No admin data or actions exist here,
 * and the RPCs enforce all of it server-side — nothing on this page can reach
 * another caller's leads, payment fields, or assignment.
 */

type Json = Record<string, unknown>;
const CALL_STATUS = ["not_called", "connected", "not_connected", "disconnected", "blocked"] as const;
const INTERESTED = ["yes", "no", "undecided"] as const;
const STATUS_LABEL: Record<string, string> = {
  not_called: "Not called", connected: "Connected", not_connected: "Not connected",
  disconnected: "Disconnected", blocked: "Blocked",
};
const str = (v: unknown) => (v == null ? "" : String(v));
const fmtDate = (v: unknown) => {
  const s = str(v); if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
};
const toLocalInput = (v: unknown) => {
  const s = str(v); if (!s) return "";
  const d = new Date(s); if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function CallerConsole() {
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const [tab, setTab] = useState<"queue" | "stats">("queue");

  return (
    <div className="cc">
      <style>{CSS}</style>
      <header className="cc-top">
        <div className="cc-brand"><Image src="/vedam-logo-dark.png" alt="Vedam" width={104} height={38} className="cc-logo" priority /><span className="cc-ttl">Calling Console</span></div>
        <nav className="cc-tabs">
          <button className={tab === "queue" ? "on" : ""} onClick={() => setTab("queue")}>My Queue</button>
          <button className={tab === "stats" ? "on" : ""} onClick={() => setTab("stats")}>My Stats</button>
        </nav>
        <button className="cc-out" onClick={async () => { await supabase.auth.signOut(); router.push("/login"); }}>Sign out</button>
      </header>
      <main className="cc-main">
        {tab === "queue" ? <Queue supabase={supabase} /> : <Stats supabase={supabase} />}
      </main>
    </div>
  );
}

function Queue({ supabase }: { supabase: ReturnType<typeof createClient> }) {
  const [rows, setRows] = useState<Json[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState("");
  const [due, setDue] = useState(false);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const LIMIT = 50;

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    const p: Json = { limit: LIMIT, offset: page * LIMIT, due };
    if (status) p.status = status;
    if (q) p.search = q;
    const { data, error } = await supabase.rpc("calling_my_queue", { p });
    if (error) { setErr(error.message); setLoading(false); return; }
    const d = (data ?? {}) as { rows?: Json[]; total?: number };
    setRows(d.rows ?? []); setTotal(d.total ?? 0); setLoading(false);
  }, [supabase, page, status, due, q]);

  useEffect(() => { void load(); }, [load]);

  async function update(id: string, body: Json) {
    setBusy(true);
    const { data, error } = await supabase.rpc("calling_log_update", { p: { id, ...body } });
    setBusy(false);
    if (error || !(data as Json)?.ok) { setErr(error?.message ?? `Update failed: ${str((data as Json)?.error)}`); return; }
    await load();
  }

  const pages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="cc-page">
      {err && <div className="cc-err" onClick={() => setErr(null)}>{err} · dismiss</div>}
      <div className="cc-bar">
        <form className="cc-search" onSubmit={(e) => { e.preventDefault(); setPage(0); setQ(search); }}>
          <input placeholder="Search name / phone…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button type="submit">Search</button>
        </form>
        <div className="cc-filt"><DarkSelect value={status} onChange={(v) => { setPage(0); setStatus(v); }} options={[{ value: "", label: "All status" }, ...CALL_STATUS.map((s) => ({ value: s, label: STATUS_LABEL[s] }))]} /></div>
        <label className="cc-chk"><input type="checkbox" checked={due} onChange={(e) => { setPage(0); setDue(e.target.checked); }} /> Follow-ups due</label>
        {busy && <span className="cc-mut">saving…</span>}
      </div>

      <div className="cc-list">
        {loading && <div className="cc-mid">Loading…</div>}
        {!loading && rows.length === 0 && <div className="cc-mid">No leads in your queue{status || due || q ? " for these filters" : " yet"}.</div>}
        {!loading && rows.map((r) => {
          const id = str(r.id);
          return (
            <div className="cc-card" key={id}>
              <div className="cc-cmain">
                <div className="cc-cname">{str(r.name) || "—"}
                  {r.registered ? <span className="cc-badge cc-ok" title="Registered on Vedam One">on Vedam One</span> : null}
                  {r.vsat_paid ? <span className="cc-badge cc-paid">VSAT paid</span> : null}
                </div>
                <div className="cc-cmeta">
                  {str(r.stream) && <span>{str(r.stream)}</span>}
                  <a className="cc-tel" href={`tel:${str(r.phone)}`}>{str(r.phone)}</a>
                  {str(r.email) && <span className="cc-mut">{str(r.email)}</span>}
                  <span className="cc-mut">· {str(r.call_count) || "0"} calls · last {fmtDate(r.last_called_at)}</span>
                </div>
              </div>
              <div className="cc-controls">
                <div className="cc-ct"><label>Status</label><DarkSelect value={str(r.call_status)} onChange={(v) => update(id, { call_status: v })} options={CALL_STATUS.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} /></div>
                <div className="cc-ct"><label>Interested</label><DarkSelect value={str(r.interested)} placeholder="—" onChange={(v) => update(id, { interested: v })} options={INTERESTED.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))} /></div>
                <div className="cc-ct cc-grow"><label>Remarks</label><RemarkInput value={str(r.remarks)} onSave={(v) => update(id, { remarks: v })} /></div>
                <div className="cc-ct"><label>Next follow-up</label>
                  <input className="cc-dt" type="datetime-local" defaultValue={toLocalInput(r.next_followup_at)}
                    onBlur={(e) => { const v = e.target.value; const iso = v ? new Date(v).toISOString() : ""; if (iso !== str(r.next_followup_at)) update(id, { next_followup_at: iso }); }} />
                </div>
                <button className="cc-log" onClick={() => update(id, { logged_call: true })}>＋ Log call</button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="cc-pager">
        <span>{total} leads</span>
        <div className="cc-pg">
          <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>‹ Prev</button>
          <span>{page + 1} / {pages}</span>
          <button disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next ›</button>
        </div>
      </div>
    </div>
  );
}

function RemarkInput({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input className="cc-rem" value={v} placeholder="add a note…"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v !== value) onSave(v); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
  );
}

function Stats({ supabase }: { supabase: ReturnType<typeof createClient> }) {
  const [d, setD] = useState<Json | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let on = true; setLoading(true);
    (async () => { const { data } = await supabase.rpc("calling_dashboard", { p: {} }); if (on) { setD((data ?? null) as Json | null); setLoading(false); } })();
    return () => { on = false; };
  }, [supabase]);

  const n = (k: string) => Number((d?.[k] as number) ?? 0);
  const byStatus = (d?.by_status as Record<string, number>) ?? {};
  const cards = [
    { label: "My leads", v: n("total") },
    { label: "Connected", v: n("connected"), sub: `${n("connect_rate")}% connect rate` },
    { label: "Interested", v: n("interested"), accent: true },
    { label: "Links shared", v: n("links_shared") },
    { label: "Registered on Vedam One", v: n("registered_on_vedam"), accent: true },
    { label: "VSAT paid", v: n("vsat_paid") },
    { label: "Not called", v: n("not_called") },
    { label: "Bad numbers", v: n("bad_numbers") },
  ];
  const entries = Object.entries(byStatus).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));

  return (
    <div className="cc-page">
      {loading && <div className="cc-mid">Loading…</div>}
      {!loading && (
        <>
          <div className="cc-cards">
            {cards.map((c) => (
              <div key={c.label} className={`cc-kc${c.accent ? " cc-kc-a" : ""}`}>
                <div className="cc-kv">{c.v.toLocaleString("en-IN")}</div>
                <div className="cc-kl">{c.label}</div>
                {c.sub && <div className="cc-ks">{c.sub}</div>}
              </div>
            ))}
          </div>
          <div className="cc-break">
            <h4>By call status</h4>
            {entries.length === 0 && <div className="cc-mut cc-mid">No calls logged yet.</div>}
            {entries.map(([k, v]) => (
              <div key={k} className="cc-brow"><span className="cc-bk">{STATUS_LABEL[k] ?? k}</span><span className="cc-bbar"><i style={{ width: `${(v / max) * 100}%` }} /></span><span className="cc-bv">{v}</span></div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
.cc{--bg:#070a16;--bg2:#0b1024;--panel:rgba(20,26,54,.55);--ink:#f2f5ff;--mut:#aeb8e0;--mut2:#7681b2;--green:#34e2b0;--cyan:#22d3ee;--violet:#8b5cf6;--line:rgba(130,150,255,.12);--accent:52 226 176;--font-inter:'Inter',system-ui,sans-serif;--display:'Sora',system-ui,sans-serif;--font:'Inter',system-ui,sans-serif;--mono:'JetBrains Mono',monospace;min-height:100vh;color:var(--ink);font-family:var(--font);background:radial-gradient(1100px 700px at 82% -8%,rgba(139,92,246,.16),transparent 60%),radial-gradient(900px 620px at -6% 108%,rgba(34,211,238,.13),transparent 58%),linear-gradient(180deg,var(--bg),var(--bg2))}
.cc-top{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:16px;padding:12px 20px;border-bottom:1px solid var(--line);background:rgba(12,16,38,.72);backdrop-filter:blur(14px)}
.cc-brand{display:flex;align-items:center;gap:12px}
.cc-logo{width:104px;height:auto;display:block}
.cc-ttl{font-family:var(--display);font-weight:600;font-size:15px}
.cc-tabs{display:flex;gap:4px;margin-left:8px;background:rgba(130,150,255,.06);border:1px solid var(--line);border-radius:12px;padding:4px}
.cc-tabs button{border:0;background:transparent;color:var(--mut);font-family:var(--display);font-weight:600;font-size:12.5px;padding:7px 16px;border-radius:9px;cursor:pointer}
.cc-tabs button.on{color:#04101a;background:linear-gradient(90deg,var(--green),var(--cyan))}
.cc-out{margin-left:auto;border:1px solid var(--line);background:rgba(130,150,255,.06);color:var(--mut);border-radius:10px;padding:8px 14px;font-size:12.5px;cursor:pointer}
.cc-out:hover{color:var(--ink)}
.cc-main{max-width:1100px;margin:0 auto}
.cc-page{padding:18px 20px 48px;display:flex;flex-direction:column;gap:14px}
.cc-err{background:rgba(255,90,120,.14);border:1px solid rgba(255,90,120,.4);color:#ffd4dc;font-size:12.5px;padding:9px 13px;border-radius:10px;cursor:pointer}
.cc-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.cc-search{display:flex;flex:1;min-width:220px;max-width:380px}
.cc-search input{flex:1;background:rgba(130,150,255,.06);border:1px solid var(--line);border-right:0;border-radius:10px 0 0 10px;color:var(--ink);font-size:13px;padding:9px 12px;outline:none}
.cc-search input:focus{border-color:rgba(52,226,176,.4)}
.cc-search button{border:1px solid var(--line);background:rgba(130,150,255,.1);color:var(--mut);border-radius:0 10px 10px 0;padding:0 14px;font-size:12.5px;cursor:pointer}
.cc-filt{min-width:150px}
.cc-chk{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--mut);white-space:nowrap}
.cc-chk input{accent-color:#34e2b0}
.cc-mut{color:var(--mut2);font-size:12px}
.cc-list{display:flex;flex-direction:column;gap:10px}
.cc-card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:13px 15px;display:flex;flex-direction:column;gap:11px}
.cc-cname{font-family:var(--display);font-weight:600;font-size:14.5px;color:var(--ink);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.cc-badge{font-size:10px;font-weight:600;padding:2px 8px;border-radius:999px;border:1px solid var(--line)}
.cc-ok{background:rgba(52,226,176,.14);border-color:rgba(52,226,176,.35);color:var(--green)}
.cc-paid{background:rgba(139,92,246,.14);border-color:rgba(139,92,246,.3);color:#c4b5fd}
.cc-cmeta{display:flex;flex-wrap:wrap;gap:10px;align-items:center;font-size:12.5px;color:var(--mut);margin-top:3px}
.cc-tel{font-family:var(--mono);color:var(--cyan);text-decoration:none;font-size:13px}
.cc-tel:hover{text-decoration:underline}
.cc-controls{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end}
.cc-ct{display:flex;flex-direction:column;gap:4px;min-width:140px}
.cc-ct label{font-family:var(--mono);font-size:9px;letter-spacing:1.2px;text-transform:uppercase;color:var(--mut2)}
.cc-grow{flex:1;min-width:180px}
.cc-rem,.cc-dt{background:rgba(130,150,255,.06);border:1px solid var(--line);border-radius:9px;color:var(--ink);font-size:12.5px;padding:8px 10px;outline:none;width:100%;font-family:var(--font)}
.cc-rem:focus,.cc-dt:focus{border-color:rgba(52,226,176,.4)}
.cc-dt{color-scheme:dark}
.cc-log{border:0;background:linear-gradient(90deg,var(--green),var(--cyan));color:#04101a;font-weight:600;font-size:12.5px;border-radius:10px;padding:9px 14px;cursor:pointer;height:36px}
.cc-mid{text-align:center;color:var(--mut2);padding:28px}
.cc-pager{display:flex;align-items:center;justify-content:space-between;font-size:12.5px;color:var(--mut2)}
.cc-pg{display:flex;align-items:center;gap:10px}
.cc-pg button{background:rgba(130,150,255,.06);border:1px solid var(--line);color:var(--mut);border-radius:8px;padding:6px 11px;cursor:pointer;font-size:12px}
.cc-pg button:disabled{opacity:.4;cursor:default}
.cc-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}
.cc-kc{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:15px 16px}
.cc-kc-a{border-color:rgba(52,226,176,.3);background:linear-gradient(160deg,rgba(52,226,176,.1),var(--panel))}
.cc-kv{font-family:var(--display);font-weight:700;font-size:25px;line-height:1}
.cc-kl{font-size:12px;color:var(--mut);margin-top:6px}
.cc-ks{font-size:11px;color:var(--mut2);margin-top:3px}
.cc-break{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:15px 16px;max-width:460px}
.cc-break h4{font-family:var(--display);font-size:13px;margin:0 0 12px}
.cc-brow{display:flex;align-items:center;gap:9px;margin-bottom:8px;font-size:12px}
.cc-bk{width:100px;flex:none;color:var(--mut)}
.cc-bbar{flex:1;height:7px;background:rgba(130,150,255,.08);border-radius:999px;overflow:hidden}
.cc-bbar i{display:block;height:100%;background:linear-gradient(90deg,var(--green),var(--cyan))}
.cc-bv{width:30px;text-align:right;font-family:var(--mono);font-size:11.5px;color:var(--ink)}
@media(max-width:620px){.cc-ttl{display:none}.cc-search{max-width:none}}
`;
