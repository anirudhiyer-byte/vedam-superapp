"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DarkSelect } from "@/components/admin/dark-select";

/**
 * Calling CRM — admin panel for the Growth → Calling channel (3 pages).
 *
 * Every read/write goes through the SECURITY DEFINER RPCs added in migrations
 * 0071/0072 (calling_admin_list, calling_log_update, calling_assign,
 * calling_bulk_update, calling_import, calling_set_vsat_paid, calling_callers,
 * calling_dashboard, calling_utm_listing). The browser has NO direct table
 * access — the RPCs check the admin role server-side, so nothing here can be
 * hammered or bypassed from the client.
 *
 *  - "data" : Calling Data — filterable/searchable table, inline status/interested
 *             edits, single + bulk assignment, bulk status/trash, CSV add.
 *  - "dash" : Dashboards — telecalling KPIs + by-stream/status/assignee, and the
 *             "registered on Vedam One" cross-check.
 *  - "utm"  : UTM Listing — caller-shared UTM funnel (leads → shared → registered
 *             → VSAT paid → application → enrolled).
 */

export type CallingPage = "data" | "dash" | "utm" | "callers" | "elevate";
type Client = ReturnType<typeof createClient>;
type Json = Record<string, unknown>;

const CALL_STATUS = ["not_called", "connected", "not_connected", "disconnected", "blocked"] as const;
const INTERESTED = ["yes", "no", "undecided"] as const;
const SOURCES = ["school_connect", "csv", "inbound", "manual"] as const;

const STATUS_LABEL: Record<string, string> = {
  not_called: "Not called", connected: "Connected", not_connected: "Not connected",
  disconnected: "Disconnected", blocked: "Blocked",
};
const str = (v: unknown) => (v == null ? "" : String(v));
const fmtDate = (v: unknown) => {
  const s = str(v);
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
};

export function CallingPanel({ page }: { page: CallingPage }) {
  const [supabase] = useState(() => createClient());
  return (
    <div className="cl-wrap">
      <style>{CSS}</style>
      {page === "data" && <CallingData supabase={supabase} />}
      {page === "dash" && <CallingDash supabase={supabase} />}
      {page === "utm" && <CallingUtm supabase={supabase} />}
      {page === "callers" && <CallersManage supabase={supabase} />}
      {page === "elevate" && <ElevatePanel />}
    </div>
  );
}

/* ------------------------------------------------------------------ callers */
function useCallers(supabase: Client) {
  const [callers, setCallers] = useState<{ id: string; email: string }[]>([]);
  useEffect(() => {
    let on = true;
    (async () => {
      const { data } = await supabase.rpc("calling_callers");
      if (on && Array.isArray(data)) setCallers(data as { id: string; email: string }[]);
    })();
    return () => { on = false; };
  }, [supabase]);
  return callers;
}

/* ------------------------------------------------------------ Calling Data */
function CallingData({ supabase }: { supabase: Client }) {
  const callers = useCallers(supabase);
  const [rows, setRows] = useState<Json[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [showCsv, setShowCsv] = useState(false);
  const LIMIT = 50;

  const [f, setF] = useState({
    status: "", interested: "", source: "", assigned_to: "", registered: "", vsat_paid: "", search: "", trashed: false,
  });
  const [search, setSearch] = useState("");

  const assigneeOptions = useMemo(
    () => [
      { value: "", label: "All assignees" },
      { value: "unassigned", label: "Unassigned" },
      ...callers.map((c) => ({ value: c.id, label: c.email })),
    ],
    [callers],
  );
  const callerEmail = useMemo(() => {
    const m: Record<string, string> = {};
    callers.forEach((c) => (m[c.id] = c.email));
    return m;
  }, [callers]);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    const p: Json = { limit: LIMIT, offset: page * LIMIT, trashed: f.trashed };
    for (const k of ["status", "interested", "source", "assigned_to", "registered", "vsat_paid"] as const) if (f[k]) p[k] = f[k];
    if (f.search) p.search = f.search;
    const { data, error } = await supabase.rpc("calling_admin_list", { p });
    if (error) { setErr(error.message); setLoading(false); return; }
    const d = (data ?? {}) as { rows?: Json[]; total?: number };
    setRows(d.rows ?? []); setTotal(d.total ?? 0); setSel(new Set()); setLoading(false);
  }, [supabase, page, f]);

  useEffect(() => { void load(); }, [load]);

  function apply(patch: Partial<typeof f>) { setPage(0); setF((s) => ({ ...s, ...patch })); }

  async function inlineUpdate(id: string, body: Json) {
    setBusy(true);
    const { data, error } = await supabase.rpc("calling_log_update", { p: { id, ...body } });
    setBusy(false);
    const ok = !error && (data as Json)?.ok;
    if (!ok) { setErr(error?.message ?? `Update failed: ${str((data as Json)?.error)}`); return; }
    await load();
  }

  async function bulkAssign(assignee: string) {
    if (sel.size === 0) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("calling_assign", { p: { ids: [...sel], assignee: assignee || null } });
    setBusy(false);
    if (error || !(data as Json)?.ok) { setErr(error?.message ?? `Assign failed: ${str((data as Json)?.error)}`); return; }
    await load();
  }

  async function bulkPatch(patch: Json) {
    if (sel.size === 0) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("calling_bulk_update", { p: { ids: [...sel], patch } });
    setBusy(false);
    if (error || !(data as Json)?.ok) { setErr(error?.message ?? `Update failed: ${str((data as Json)?.error)}`); return; }
    await load();
  }

  async function markPaid(id: string) {
    const amtStr = window.prompt("VSAT amount paid (₹)?", "");
    if (amtStr == null) return;
    const amount = Number(amtStr);
    setBusy(true);
    const { data, error } = await supabase.rpc("calling_set_vsat_paid", { p: { id, amount: Number.isFinite(amount) && amount > 0 ? amount : undefined } });
    setBusy(false);
    if (error || !(data as Json)?.ok) { setErr(error?.message ?? "Mark paid failed"); return; }
    await load();
  }

  const allOnPage = rows.length > 0 && rows.every((r) => sel.has(str(r.id)));
  function toggleAll() {
    setSel((s) => {
      const n = new Set(s);
      if (allOnPage) rows.forEach((r) => n.delete(str(r.id)));
      else rows.forEach((r) => n.add(str(r.id)));
      return n;
    });
  }
  function toggle(id: string) {
    setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  const pages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="cl-page">
      {err && <div className="cl-err" onClick={() => setErr(null)}>{err} · dismiss</div>}

      {/* filters */}
      <div className="cl-bar">
        <form className="cl-search" onSubmit={(e) => { e.preventDefault(); apply({ search }); }}>
          <input placeholder="Search name / phone / email…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button type="submit">Search</button>
        </form>
        <div className="cl-filt"><DarkSelect value={f.status} onChange={(v) => apply({ status: v })} options={[{ value: "", label: "All status" }, ...CALL_STATUS.map((s) => ({ value: s, label: STATUS_LABEL[s] }))]} /></div>
        <div className="cl-filt"><DarkSelect value={f.interested} onChange={(v) => apply({ interested: v })} options={[{ value: "", label: "Any interest" }, ...INTERESTED.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))]} /></div>
        <div className="cl-filt"><DarkSelect value={f.source} onChange={(v) => apply({ source: v })} options={[{ value: "", label: "All sources" }, ...SOURCES.map((s) => ({ value: s, label: s.replace("_", " ") }))]} /></div>
        <div className="cl-filt cl-w160"><DarkSelect value={f.assigned_to} onChange={(v) => apply({ assigned_to: v })} options={assigneeOptions} /></div>
        <div className="cl-filt"><DarkSelect value={f.registered} onChange={(v) => apply({ registered: v })} options={[{ value: "", label: "Registered?" }, { value: "yes", label: "On Vedam One" }, { value: "no", label: "Not yet" }]} /></div>
        <div className="cl-filt"><DarkSelect value={f.vsat_paid} onChange={(v) => apply({ vsat_paid: v })} options={[{ value: "", label: "VSAT paid?" }, { value: "yes", label: "Paid" }, { value: "no", label: "Unpaid" }]} /></div>
        <label className="cl-chk"><input type="checkbox" checked={f.trashed} onChange={(e) => apply({ trashed: e.target.checked })} /> Trash</label>
        <button className="cl-ghost" onClick={() => { setSearch(""); setPage(0); setF({ status: "", interested: "", source: "", assigned_to: "", registered: "", vsat_paid: "", search: "", trashed: false }); }}>Reset</button>
        <button className="cl-add" onClick={() => setShowCsv(true)}>+ Add (CSV)</button>
      </div>

      {/* bulk bar */}
      {sel.size > 0 && (
        <div className="cl-bulk">
          <span>{sel.size} selected</span>
          <div className="cl-filt cl-w180"><DarkSelect value="" placeholder="Assign to…" onChange={bulkAssign} options={[{ value: "", label: "Unassign" }, ...callers.map((c) => ({ value: c.id, label: c.email }))]} /></div>
          <div className="cl-filt cl-w160"><DarkSelect value="" placeholder="Set status…" onChange={(v) => bulkPatch({ call_status: v })} options={CALL_STATUS.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} /></div>
          {!f.trashed
            ? <button className="cl-ghost" onClick={() => bulkPatch({ is_trashed: true })}>Trash</button>
            : <button className="cl-ghost" onClick={() => bulkPatch({ is_trashed: false })}>Restore</button>}
          <button className="cl-ghost" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}

      {/* table */}
      <div className="cl-tablewrap">
        <table className="cl-table">
          <thead>
            <tr>
              <th className="cl-cbx"><input type="checkbox" checked={allOnPage} onChange={toggleAll} /></th>
              <th>Name</th><th>Phone</th><th>Stream</th><th>Source</th>
              <th>Status</th><th>Interested</th><th>Assignee</th>
              <th>Reg.</th><th>VSAT</th><th>Calls</th><th>Last call</th><th>Remarks</th><th></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={14} className="cl-mid">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={14} className="cl-mid">No leads match these filters.</td></tr>}
            {!loading && rows.map((r) => {
              const id = str(r.id);
              return (
                <tr key={id} className={sel.has(id) ? "cl-on" : ""}>
                  <td className="cl-cbx"><input type="checkbox" checked={sel.has(id)} onChange={() => toggle(id)} /></td>
                  <td className="cl-name">{str(r.name) || "—"}{str(r.email) && <span className="cl-sub">{str(r.email)}</span>}</td>
                  <td className="cl-mono">{str(r.phone)}</td>
                  <td>{str(r.stream) || "—"}</td>
                  <td><span className="cl-tag">{str(r.source).replace("_", " ")}</span></td>
                  <td className="cl-min"><DarkSelect value={str(r.call_status)} onChange={(v) => inlineUpdate(id, { call_status: v })} options={CALL_STATUS.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} /></td>
                  <td className="cl-min"><DarkSelect value={str(r.interested)} placeholder="—" onChange={(v) => inlineUpdate(id, { interested: v })} options={INTERESTED.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))} /></td>
                  <td>{r.assigned_to ? <span className="cl-tag cl-tag-a">{callerEmail[str(r.assigned_to)] ?? str(r.assignee_email) ?? "caller"}</span> : <span className="cl-muted">—</span>}</td>
                  <td>{r.registered || r.linked_profile_id ? <span className="cl-dot cl-ok" title="Registered on Vedam One" /> : <span className="cl-dot" />}</td>
                  <td>{r.vsat_paid ? <span className="cl-tag cl-tag-paid">paid</span> : <button className="cl-link" onClick={() => markPaid(id)}>mark</button>}</td>
                  <td className="cl-c">{str(r.call_count) || "0"}</td>
                  <td>{fmtDate(r.last_called_at)}</td>
                  <td className="cl-rem"><Remarks value={str(r.remarks)} onSave={(v) => inlineUpdate(id, { remarks: v })} /></td>
                  <td>{!f.trashed && <button className="cl-link cl-del" onClick={() => bulkPatchOne(id)}>trash</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* pager */}
      <div className="cl-pager">
        <span>{total} leads{busy ? " · saving…" : ""}</span>
        <div className="cl-pg">
          <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>‹ Prev</button>
          <span>{page + 1} / {pages}</span>
          <button disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next ›</button>
        </div>
      </div>

      {showCsv && <CsvAdd supabase={supabase} onClose={() => setShowCsv(false)} onDone={() => { setShowCsv(false); void load(); }} setErr={setErr} />}
    </div>
  );

  async function bulkPatchOne(id: string) {
    setBusy(true);
    const { data, error } = await supabase.rpc("calling_bulk_update", { p: { ids: [id], patch: { is_trashed: true } } });
    setBusy(false);
    if (error || !(data as Json)?.ok) { setErr(error?.message ?? "Trash failed"); return; }
    await load();
  }
}

/* editable remarks cell */
function Remarks({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  if (!edit) return <div className="cl-remv" onClick={() => setEdit(true)} title={value}>{value || <span className="cl-muted">add…</span>}</div>;
  return (
    <div className="cl-remedit">
      <input autoFocus value={v} onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { setEdit(false); if (v !== value) onSave(v); } if (e.key === "Escape") { setEdit(false); setV(value); } }} />
      <button onMouseDown={(e) => { e.preventDefault(); setEdit(false); if (v !== value) onSave(v); }}>✓</button>
    </div>
  );
}

/* CSV add modal */
function CsvAdd({ supabase, onClose, onDone, setErr }: { supabase: Client; onClose: () => void; onDone: () => void; setErr: (s: string | null) => void }) {
  const [text, setText] = useState("");
  const [source, setSource] = useState<string>("csv");
  const [dedupe, setDedupe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Json[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function parse(raw: string): Json[] {
    const lines = raw.trim().split(/\r?\n/).filter((l) => l.trim());
    if (lines.length === 0) return [];
    const delim = lines[0].includes("\t") ? "\t" : ",";
    const head = lines[0].split(delim).map((h) => h.trim().toLowerCase());
    const hasHeader = head.some((h) => ["phone", "mobile", "whatsapp", "name", "email"].includes(h));
    const cols = hasHeader ? head : ["name", "phone", "email", "stream"];
    const body = hasHeader ? lines.slice(1) : lines;
    const key = (c: string[], ...names: string[]) => { for (const n of names) { const i = cols.indexOf(n); if (i >= 0 && c[i]) return c[i].trim(); } return ""; };
    return body.map((l) => {
      const c = l.split(delim);
      return {
        name: key(c, "name", "student name", "full name"),
        phone: key(c, "phone", "mobile", "whatsapp", "number"),
        email: key(c, "email"),
        stream: key(c, "stream"),
        utm_source: key(c, "utm_source"),
        utm_medium: key(c, "utm_medium"),
        utm_campaign: key(c, "utm_campaign"),
        remarks: key(c, "remarks"),
      };
    }).filter((r) => str(r.phone));
  }

  async function submit() {
    const parsed = preview ?? parse(text);
    if (parsed.length === 0) { setErr("No rows with a phone number found."); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("calling_import", { p: { rows: parsed, source, dedupe } });
    setBusy(false);
    if (error || !(data as Json)?.ok) { setErr(error?.message ?? "Import failed"); return; }
    const d = data as Json;
    setErr(`Imported ${str(d.inserted)} · skipped ${str(d.skipped)}`);
    onDone();
  }

  return (
    <div className="cl-modal" onClick={onClose}>
      <div className="cl-sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Add calling leads</h3>
        <p className="cl-hint">Paste CSV/TSV or choose a file. Columns matched by header: <code>name, phone, email, stream, utm_source, utm_medium, utm_campaign, remarks</code>. Phone required. No header → <code>name, phone, email, stream</code>.</p>
        <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" className="cl-file"
          onChange={async (e) => { const file = e.target.files?.[0]; if (file) { const t = await file.text(); setText(t); setPreview(parse(t)); } }} />
        <textarea value={text} onChange={(e) => { setText(e.target.value); setPreview(null); }} placeholder={"name,phone,email,stream\nAarav,9000000000,aarav@x.com,PCM"} rows={7} />
        <div className="cl-sheetrow">
          <div className="cl-filt cl-w160"><DarkSelect value={source} onChange={setSource} options={SOURCES.map((s) => ({ value: s, label: s.replace("_", " ") }))} /></div>
          <label className="cl-chk"><input type="checkbox" checked={dedupe} onChange={(e) => setDedupe(e.target.checked)} /> Skip existing phones</label>
          <button className="cl-ghost" onClick={() => setPreview(parse(text))}>Preview</button>
          {preview && <span className="cl-cnt">{preview.length} rows</span>}
        </div>
        <div className="cl-sheetfoot">
          <button className="cl-ghost" onClick={onClose}>Cancel</button>
          <button className="cl-add" disabled={busy} onClick={submit}>{busy ? "Importing…" : "Import"}</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- Dashboards */
function CallingDash({ supabase }: { supabase: Client }) {
  const callers = useCallers(supabase);
  const [d, setD] = useState<Json | null>(null);
  const [assignee, setAssignee] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let on = true;
    setLoading(true);
    (async () => {
      const p: Json = {};
      if (assignee) p.assigned_to = assignee;
      const { data } = await supabase.rpc("calling_dashboard", { p });
      if (on) { setD((data ?? null) as Json | null); setLoading(false); }
    })();
    return () => { on = false; };
  }, [supabase, assignee]);

  const n = (k: string) => Number((d?.[k] as number) ?? 0);
  const obj = (k: string) => (d?.[k] as Record<string, number>) ?? {};

  const cards = [
    { k: "total", label: "Total leads", v: n("total") },
    { k: "connected", label: "Connected", v: n("connected"), sub: `${n("connect_rate")}% connect rate` },
    { k: "not_called", label: "Not called", v: n("not_called") },
    { k: "interested", label: "Interested", v: n("interested"), accent: true },
    { k: "links_shared", label: "Links shared", v: n("links_shared") },
    { k: "registered_on_vedam", label: "Registered on Vedam One", v: n("registered_on_vedam"), sub: `${n("registered_of_link_shared")} of link-shared`, accent: true },
    { k: "vsat_paid", label: "VSAT paid", v: n("vsat_paid") },
    { k: "bad_numbers", label: "Bad numbers", v: n("bad_numbers") },
  ];

  return (
    <div className="cl-page">
      <div className="cl-bar">
        <div className="cl-filt cl-w180"><DarkSelect value={assignee} onChange={setAssignee} options={[{ value: "", label: "All callers" }, ...callers.map((c) => ({ value: c.id, label: c.email }))]} /></div>
        {loading && <span className="cl-muted">Loading…</span>}
      </div>
      <div className="cl-cards">
        {cards.map((c) => (
          <div key={c.k} className={`cl-card${c.accent ? " cl-card-a" : ""}`}>
            <div className="cl-cv">{c.v.toLocaleString("en-IN")}</div>
            <div className="cl-cl">{c.label}</div>
            {c.sub && <div className="cl-cs">{c.sub}</div>}
          </div>
        ))}
      </div>
      <div className="cl-breaks">
        <Breakdown title="By interest" data={{ Interested: n("interested"), "Not interested": n("not_interested"), Undecided: n("undecided") }} />
        <Breakdown title="By stream" data={obj("by_stream")} />
        <Breakdown title="By call status" data={obj("by_status")} labelMap={STATUS_LABEL} />
        <Breakdown title="By assignee" data={obj("by_assignee")} />
      </div>
    </div>
  );
}

function Breakdown({ title, data, labelMap }: { title: string; data: Record<string, number>; labelMap?: Record<string, string> }) {
  const entries = Object.entries(data).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return (
    <div className="cl-break">
      <h4>{title}</h4>
      {entries.length === 0 && <div className="cl-muted cl-mid">No data yet.</div>}
      {entries.map(([k, v]) => (
        <div key={k} className="cl-brow">
          <span className="cl-bk" title={k}>{labelMap?.[k] ?? k}</span>
          <span className="cl-bbar"><i style={{ width: `${(v / max) * 100}%` }} /></span>
          <span className="cl-bv">{v}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ UTM Listing */
function CallingUtm({ supabase }: { supabase: Client }) {
  const [d, setD] = useState<{ rows: Json[]; totals: Json } | null>(null);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let on = true; setLoading(true);
    (async () => {
      const { data } = await supabase.rpc("calling_utm_listing", { p: q ? { search: q } : {} });
      if (on) { setD((data ?? { rows: [], totals: {} }) as { rows: Json[]; totals: Json }); setLoading(false); }
    })();
    return () => { on = false; };
  }, [supabase, q]);

  const cols: { k: string; label: string }[] = [
    { k: "leads", label: "Leads" }, { k: "shared", label: "Link shared" }, { k: "registered", label: "Registered" },
    { k: "vsat_paid", label: "VSAT paid" }, { k: "applications", label: "Application" }, { k: "enrolled", label: "Enrolled" },
  ];
  const t = d?.totals ?? {};

  return (
    <div className="cl-page">
      <div className="cl-bar">
        <form className="cl-search" onSubmit={(e) => { e.preventDefault(); setQ(search); }}>
          <input placeholder="Filter by UTM source / medium / campaign…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button type="submit">Filter</button>
        </form>
        {loading && <span className="cl-muted">Loading…</span>}
      </div>
      <div className="cl-cards cl-cards-sm">
        {cols.map((c) => <div key={c.k} className="cl-card"><div className="cl-cv">{Number((t[c.k] as number) ?? 0).toLocaleString("en-IN")}</div><div className="cl-cl">{c.label}</div></div>)}
      </div>
      <div className="cl-tablewrap">
        <table className="cl-table">
          <thead>
            <tr><th>UTM source</th><th>Medium</th><th>Campaign</th>{cols.map((c) => <th key={c.k} className="cl-c">{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {!loading && (d?.rows.length ?? 0) === 0 && <tr><td colSpan={9} className="cl-mid">No UTM-tagged calling leads yet.</td></tr>}
            {d?.rows.map((r, i) => (
              <tr key={i}>
                <td className="cl-mono">{str(r.utm_source)}</td>
                <td className="cl-mono">{str(r.utm_medium)}</td>
                <td>{str(r.utm_campaign)}</td>
                {cols.map((c) => <td key={c.k} className="cl-c">{str(r[c.k]) || "0"}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Callers */
function CallersManage({ supabase }: { supabase: Client }) {
  const [roster, setRoster] = useState<Json[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: "ok" | "err"; s: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc("calling_caller_roster");
    setRoster(Array.isArray(data) ? (data as Json[]) : []);
    setLoading(false);
  }, [supabase]);
  useEffect(() => { void load(); }, [load]);

  async function add() {
    const e = email.trim();
    if (!e) return;
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc("calling_add_caller", { p: { email: e } });
    setBusy(false);
    const d = (data ?? {}) as Json;
    if (error) { setMsg({ t: "err", s: error.message }); return; }
    if (!d.ok) {
      setMsg({ t: "err", s: d.error === "user_not_found" ? "No Vedam One account with that email — they must sign up first." : `Couldn't add: ${str(d.error)}` });
      return;
    }
    setMsg({ t: "ok", s: `${e} is now a caller.` }); setEmail(""); await load();
  }

  async function remove(id: string, label: string) {
    if (!window.confirm(`Remove ${label} as a caller? Their assigned leads stay, but they lose access to the console.`)) return;
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc("calling_remove_caller", { p: { user_id: id } });
    setBusy(false);
    if (error || !(data as Json)?.ok) { setMsg({ t: "err", s: error?.message ?? "Remove failed" }); return; }
    setMsg({ t: "ok", s: `${label} removed.` }); await load();
  }

  return (
    <div className="cl-page">
      {msg && <div className={msg.t === "ok" ? "cl-ok-banner" : "cl-err"} onClick={() => setMsg(null)}>{msg.s} · dismiss</div>}
      <div className="cl-callhead">
        <div>
          <h3 className="cl-h3">Callers</h3>
          <p className="cl-sub2">A caller signs in and sees only their own assigned leads at <code>/caller</code>. Add by the email of an existing Vedam One account.</p>
        </div>
        <form className="cl-addcaller" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <input type="email" placeholder="person@vedam.org" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="submit" className="cl-add" disabled={busy}>{busy ? "…" : "+ Add caller"}</button>
        </form>
      </div>

      <div className="cl-tablewrap">
        <table className="cl-table">
          <thead><tr><th>Caller</th><th className="cl-c">Assigned</th><th className="cl-c">Connected</th><th className="cl-c">Interested</th><th></th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="cl-mid">Loading…</td></tr>}
            {!loading && roster.length === 0 && <tr><td colSpan={5} className="cl-mid">No callers yet. Add one above.</td></tr>}
            {!loading && roster.map((r) => (
              <tr key={str(r.id)}>
                <td className="cl-name">{str(r.email)}</td>
                <td className="cl-c">{str(r.assigned) || "0"}</td>
                <td className="cl-c">{str(r.connected) || "0"}</td>
                <td className="cl-c">{str(r.interested) || "0"}</td>
                <td className="cl-c"><button className="cl-link cl-del" onClick={() => remove(str(r.id), str(r.email))}>remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- Elevate */
function ElevatePanel() {
  const [status, setStatus] = useState<Json | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testRes, setTestRes] = useState<Json | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch("/api/admin/elevate/status");
      const d = (await r.json()) as Json;
      if (!d.ok) setErr(str(d.error) || "Couldn't load status");
      setStatus(d);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't load status"); }
    setLoading(false);
  }, []);
  useEffect(() => { void loadStatus(); }, [loadStatus]);

  async function runTest() {
    setTesting(true); setTestRes(null); setErr(null);
    try {
      const r = await fetch("/api/admin/elevate/test", { method: "POST" });
      setTestRes((await r.json()) as Json);
    } catch (e) { setErr(e instanceof Error ? e.message : "Test failed"); }
    setTesting(false);
    void loadStatus();
  }

  const stats = (status?.stats as Json) ?? {};
  const flag = str(stats.flag) || "off";
  const configured = status?.configured === true;
  const byState = (stats.by_state as Record<string, number>) ?? {};
  const problems = (stats.recent_problems as Json[]) ?? [];
  const live = flag === "on";

  return (
    <div className="cl-page">
      {err && <div className="cl-err" onClick={() => setErr(null)}>{err} · dismiss</div>}
      <div className="cl-callhead">
        <div>
          <h3 className="cl-h3">Elevate outbound webhook</h3>
          <p className="cl-sub2">Sends partner-credited lead events (UTM-medium leads) to Elevate down the funnel. Fires only when the flag is <b>on</b> and the secret is set. Rejections and dropouts are not sent.</p>
        </div>
        <button className="cl-add" disabled={testing || !configured} onClick={runTest} title={configured ? "" : "Set ELEVATE_WEBHOOK_URL / ELEVATE_WEBHOOK_SECRET first"}>
          {testing ? "Testing…" : "Test connection"}
        </button>
      </div>

      <div className="cl-cards">
        <div className={`cl-card${live ? " cl-card-a" : ""}`}><div className="cl-cv" style={{ fontSize: 18 }}>{live ? "LIVE" : "OFF"}</div><div className="cl-cl">Webhook flag</div><div className="cl-cs">app_flags.elevate_webhook</div></div>
        <div className={`cl-card${configured ? "" : ""}`}><div className="cl-cv" style={{ fontSize: 18 }}>{configured ? "Set" : "Missing"}</div><div className="cl-cl">Secret / URL env</div></div>
        <div className="cl-card"><div className="cl-cv">{str(stats.total) || "0"}</div><div className="cl-cl">Total events</div></div>
        <div className="cl-card"><div className="cl-cv">{byState.pending ?? 0}</div><div className="cl-cl">Pending</div></div>
        <div className="cl-card"><div className="cl-cv">{byState.sent ?? 0}</div><div className="cl-cl">Sent</div></div>
        <div className="cl-card"><div className="cl-cv">{(byState.held ?? 0) + (byState.rejected ?? 0) + (byState.dead ?? 0)}</div><div className="cl-cl">Held / rejected</div></div>
      </div>

      {testRes && (
        <div className={testRes.ok ? "cl-ok-banner" : "cl-err"} onClick={() => setTestRes(null)}>
          Test → HTTP {str(testRes.httpStatus) || "—"} {Array.isArray(testRes.results) && (testRes.results as Json[])[0] ? `· outcome: ${str((testRes.results as Json[])[0].outcome)}` : ""} {str(testRes.error) ? `· ${str(testRes.error)}` : ""} · dismiss
        </div>
      )}

      {!live && (
        <div className="cl-note">
          <b>To go live:</b> set <code>ELEVATE_WEBHOOK_URL</code> + <code>ELEVATE_WEBHOOK_SECRET</code> in the environment, run <b>Test connection</b> until it passes, then flip the flag:
          <pre>update public.app_flags set value=&apos;on&apos; where key=&apos;elevate_webhook&apos;;</pre>
        </div>
      )}

      <div className="cl-tablewrap">
        <table className="cl-table">
          <thead><tr><th>Recent problems</th><th>State</th><th>Error</th><th>When</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={4} className="cl-mid">Loading…</td></tr>}
            {!loading && problems.length === 0 && <tr><td colSpan={4} className="cl-mid">No held / rejected events.</td></tr>}
            {problems.map((p, i) => (
              <tr key={i}><td className="cl-name">{str(p.status)}</td><td>{str(p.state)}</td><td className="cl-muted">{str(p.error) || "—"}</td><td>{fmtDate(p.at)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------- CSS */
const CSS = `
.cl-wrap{--accent:52 226 176;--font-inter:'Inter',system-ui,sans-serif;height:100%;overflow:auto;color:var(--ink);font-family:var(--font)}
.cl-page{padding:18px 20px 40px;display:flex;flex-direction:column;gap:14px}
.cl-err{background:rgba(255,90,120,.14);border:1px solid rgba(255,90,120,.4);color:#ffd4dc;font-size:12.5px;padding:9px 13px;border-radius:10px;cursor:pointer}
.cl-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.cl-search{display:flex;gap:0;flex:1;min-width:220px;max-width:360px}
.cl-search input{flex:1;background:rgba(130,150,255,.06);border:1px solid var(--line);border-right:0;border-radius:10px 0 0 10px;color:var(--ink);font-size:13px;padding:9px 12px;outline:none}
.cl-search input:focus{border-color:rgba(52,226,176,.4)}
.cl-search button{border:1px solid var(--line);background:rgba(130,150,255,.1);color:var(--mut);border-radius:0 10px 10px 0;padding:0 14px;font-size:12.5px;cursor:pointer}
.cl-filt{min-width:130px}
.cl-w160{min-width:160px}.cl-w180{min-width:180px}
.cl-chk{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--mut);white-space:nowrap}
.cl-chk input{accent-color:#34e2b0}
.cl-ghost,.cl-add{font-size:12.5px;padding:9px 13px;border-radius:10px;cursor:pointer;border:1px solid var(--line);background:rgba(130,150,255,.06);color:var(--mut)}
.cl-ghost:hover{color:var(--ink)}
.cl-add{background:linear-gradient(90deg,var(--green),var(--cyan));color:#04101a;border:0;font-weight:600}
.cl-add:disabled{opacity:.6;cursor:default}
.cl-bulk{display:flex;flex-wrap:wrap;align-items:center;gap:10px;background:rgba(52,226,176,.08);border:1px solid rgba(52,226,176,.25);border-radius:12px;padding:8px 12px;font-size:12.5px;color:var(--ink)}
.cl-tablewrap{border:1px solid var(--line);border-radius:14px;overflow:auto;background:rgba(12,16,38,.4)}
.cl-table{width:100%;border-collapse:collapse;font-size:12.5px;min-width:1050px}
.cl-table th{position:sticky;top:0;background:rgba(14,18,40,.96);backdrop-filter:blur(6px);text-align:left;font-family:var(--mono);font-size:9.5px;letter-spacing:1.5px;text-transform:uppercase;color:var(--mut2);padding:11px 12px;border-bottom:1px solid var(--line);white-space:nowrap;z-index:2}
.cl-table td{padding:7px 12px;border-bottom:1px solid rgba(130,150,255,.06);vertical-align:middle;color:var(--mut)}
.cl-table tr:hover td{background:rgba(130,150,255,.04)}
.cl-table tr.cl-on td{background:rgba(52,226,176,.07)}
.cl-cbx{width:34px}.cl-cbx input{accent-color:#34e2b0}
.cl-c{text-align:center}
.cl-name{color:var(--ink);font-weight:500;display:flex;flex-direction:column;line-height:1.3;min-width:120px}
.cl-sub{color:var(--mut2);font-size:11px;font-weight:400}
.cl-mono{font-family:var(--mono);font-size:12px;color:var(--ink)}
.cl-min{min-width:124px}
.cl-tag{font-size:10.5px;padding:2px 8px;border-radius:999px;background:rgba(130,150,255,.1);border:1px solid var(--line);color:var(--mut);white-space:nowrap}
.cl-tag-a{background:rgba(139,92,246,.14);border-color:rgba(139,92,246,.3);color:#c4b5fd}
.cl-tag-paid{background:rgba(52,226,176,.14);border-color:rgba(52,226,176,.35);color:var(--green)}
.cl-muted{color:var(--mut2)}
.cl-dot{width:9px;height:9px;border-radius:50%;background:rgba(130,150,255,.18);display:inline-block}
.cl-dot.cl-ok{background:var(--green);box-shadow:0 0 0 3px rgba(52,226,176,.16)}
.cl-link{background:none;border:0;color:var(--cyan);font-size:11.5px;cursor:pointer;padding:2px 4px;text-decoration:underline}
.cl-del{color:var(--mut2)}
.cl-rem{min-width:150px;max-width:240px}
.cl-remv{cursor:text;min-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cl-remedit{display:flex;gap:4px}
.cl-remedit input{flex:1;background:rgba(130,150,255,.08);border:1px solid rgba(52,226,176,.4);border-radius:7px;color:var(--ink);font-size:12px;padding:4px 7px;outline:none}
.cl-remedit button{border:0;background:var(--green);color:#04101a;border-radius:7px;padding:0 9px;cursor:pointer;font-weight:700}
.cl-mid{text-align:center;color:var(--mut2);padding:26px!important}
.cl-pager{display:flex;align-items:center;justify-content:space-between;font-size:12.5px;color:var(--mut2)}
.cl-pg{display:flex;align-items:center;gap:10px}
.cl-pg button{background:rgba(130,150,255,.06);border:1px solid var(--line);color:var(--mut);border-radius:8px;padding:6px 11px;cursor:pointer;font-size:12px}
.cl-pg button:disabled{opacity:.4;cursor:default}
.cl-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px}
.cl-cards-sm{grid-template-columns:repeat(auto-fill,minmax(130px,1fr))}
.cl-card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:15px 16px}
.cl-card-a{border-color:rgba(52,226,176,.3);background:linear-gradient(160deg,rgba(52,226,176,.1),var(--panel))}
.cl-cv{font-family:var(--display);font-weight:700;font-size:26px;color:var(--ink);line-height:1}
.cl-cl{font-size:12px;color:var(--mut);margin-top:6px}
.cl-cs{font-size:11px;color:var(--mut2);margin-top:3px}
.cl-breaks{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
.cl-break{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:15px 16px}
.cl-break h4{font-family:var(--display);font-size:13px;margin:0 0 12px;color:var(--ink)}
.cl-brow{display:flex;align-items:center;gap:9px;margin-bottom:8px;font-size:12px}
.cl-bk{width:92px;flex:none;color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cl-bbar{flex:1;height:7px;background:rgba(130,150,255,.08);border-radius:999px;overflow:hidden}
.cl-bbar i{display:block;height:100%;background:linear-gradient(90deg,var(--green),var(--cyan));border-radius:999px}
.cl-bv{width:34px;text-align:right;color:var(--ink);font-family:var(--mono);font-size:11.5px}
.cl-modal{position:fixed;inset:0;background:rgba(4,6,16,.72);backdrop-filter:blur(4px);display:grid;place-items:center;z-index:60;padding:20px}
.cl-sheet{width:min(560px,100%);background:var(--bg2);border:1px solid var(--line);border-radius:18px;padding:22px;max-height:90vh;overflow:auto}
.cl-sheet h3{font-family:var(--display);margin:0 0 6px;font-size:17px;color:var(--ink)}
.cl-hint{font-size:11.5px;color:var(--mut2);margin:0 0 12px;line-height:1.5}
.cl-hint code{font-family:var(--mono);font-size:10.5px;color:var(--mut);background:rgba(130,150,255,.08);padding:1px 4px;border-radius:4px}
.cl-file{font-size:12px;color:var(--mut);margin-bottom:10px;width:100%}
.cl-sheet textarea{width:100%;background:rgba(130,150,255,.06);border:1px solid var(--line);border-radius:10px;color:var(--ink);font-family:var(--mono);font-size:12px;padding:10px;outline:none;resize:vertical}
.cl-sheet textarea:focus{border-color:rgba(52,226,176,.4)}
.cl-sheetrow{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:12px 0}
.cl-cnt{font-size:12px;color:var(--green)}
.cl-sheetfoot{display:flex;justify-content:flex-end;gap:10px;margin-top:6px}
.cl-ok-banner{background:rgba(52,226,176,.12);border:1px solid rgba(52,226,176,.35);color:var(--green);font-size:12.5px;padding:9px 13px;border-radius:10px;cursor:pointer}
.cl-callhead{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end;justify-content:space-between}
.cl-h3{font-family:var(--display);font-size:16px;margin:0 0 4px;color:var(--ink)}
.cl-sub2{font-size:12px;color:var(--mut2);margin:0;max-width:440px;line-height:1.5}
.cl-sub2 code{font-family:var(--mono);font-size:11px;color:var(--mut);background:rgba(130,150,255,.08);padding:1px 5px;border-radius:5px}
.cl-addcaller{display:flex;gap:8px}
.cl-addcaller input{background:rgba(130,150,255,.06);border:1px solid var(--line);border-radius:10px;color:var(--ink);font-size:13px;padding:9px 12px;outline:none;min-width:220px}
.cl-addcaller input:focus{border-color:rgba(52,226,176,.4)}
.cl-note{background:rgba(130,150,255,.06);border:1px solid var(--line);border-radius:12px;padding:13px 15px;font-size:12.5px;color:var(--mut);line-height:1.6}
.cl-note code{font-family:var(--mono);font-size:11px;color:var(--ink);background:rgba(130,150,255,.1);padding:1px 5px;border-radius:5px}
.cl-note pre{margin:8px 0 0;font-family:var(--mono);font-size:11.5px;color:var(--green);background:rgba(4,8,20,.5);border:1px solid var(--line);border-radius:8px;padding:9px 11px;overflow:auto}
@media(max-width:720px){.cl-search{max-width:none}}
`;
