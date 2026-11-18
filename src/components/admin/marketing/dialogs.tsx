"use client";

import { useMemo, useState } from "react";
import { checkCsvFile, decodeCsvBytes } from "@/components/admin/communication/lib/csv-identifiers";
import {
  AD_PLATFORMS, INFL_PLATFORMS, csvToRows, fmtDate, fmtInr, importErrors,
  type Campaign, type Channel, type ColType, type CsvImport, type CustomColumn, type Influencer, type Meta,
} from "@/lib/growth/marketing";
import { Err, Field, Modal, rpc, type Client } from "./shared";

/**
 * Dialogs for the Ads / Influencer listings: add-edit row, add-remove column, CSV upload, campaigns.
 * Every save goes through an admin-only RPC (migration 0105) that checks the values again.
 */

export type FieldSpec = {
  key: string; label: string; kind: "text" | "number" | "date" | "url" | "select" | "campaign" | "influencer";
  required?: boolean; options?: readonly string[]; hint?: string; wide?: boolean;
};

export const AD_FIELDS: FieldSpec[] = [
  { key: "ad_name", label: "Ad name", kind: "text", required: true, wide: true },
  { key: "platform", label: "Platform", kind: "select", required: true, options: AD_PLATFORMS },
  { key: "campaign", label: "Used in (campaign)", kind: "campaign", required: true },
  { key: "campaign_status", label: "Status", kind: "select", options: ["Enabled", "Paused"] },
  { key: "live_date", label: "Live date", kind: "date" },
  { key: "spend", label: "Spend (₹)", kind: "number" },
  { key: "serial_no", label: "Serial no.", kind: "number", hint: "Leave empty to number it automatically." },
  { key: "utm_link", label: "UTM link", kind: "url", wide: true, hint: "Leads, payments and enrollments are matched on its utm_source / utm_medium / utm_campaign." },
  { key: "notes", label: "Notes", kind: "text", wide: true },
];

export const INFL_FIELDS: FieldSpec[] = [
  { key: "influencer", label: "Influencer", kind: "influencer", required: true, wide: true },
  { key: "platform", label: "Platform", kind: "select", required: true, options: INFL_PLATFORMS },
  { key: "live_status", label: "Live status", kind: "select", required: true, options: ["Planned", "Live"] },
  { key: "live_date", label: "Live date", kind: "date" },
  { key: "campaign", label: "Campaign", kind: "campaign" },
  { key: "live_link", label: "Live link", kind: "url", wide: true, hint: "The YouTube / Instagram post. YouTube views are synced from this link." },
  { key: "utm_link", label: "UTM link", kind: "url", wide: true, hint: "The link the creator put in the post; leads are matched on it." },
  { key: "expected_views", label: "Expected views", kind: "number" },
  { key: "actual_views", label: "Actual views", kind: "number", hint: "Instagram: type it in. YouTube: filled by Sync YouTube views." },
  { key: "cost", label: "Cost (₹)", kind: "number", hint: "0 for a free post in a bulk deal; say so in Notes." },
  { key: "serial_no", label: "Serial no.", kind: "number", hint: "Leave empty to number it automatically." },
  { key: "notes", label: "Notes", kind: "text", wide: true },
];

const inputType = (k: FieldSpec["kind"] | ColType) => (k === "number" ? "text" : k === "date" ? "date" : k === "url" ? "url" : "text");

// ───────────────────────────── add / edit row ─────────────────────────────

export function RowDialog({ sb, channel, meta, initial, onClose, onSaved, reloadMeta, openCampaigns }: {
  sb: Client; channel: Channel; meta: Meta; initial: Record<string, string> & { id?: string }; onClose: () => void; onSaved: () => void;
  reloadMeta: () => void; openCampaigns: () => void;
}) {
  const fields = channel === "ads" ? AD_FIELDS : INFL_FIELDS;
  const custom = meta.columns.filter((c) => c.channel === channel);
  const [v, setV] = useState<Record<string, string>>(initial);
  const [extra, setExtra] = useState<Record<string, string>>(() => Object.fromEntries(custom.map((c) => [c.key, initial[`x:${c.key}`] ?? ""])));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const labelOf = (k: string) => custom.find((c) => c.key === k)?.label ?? k;

  async function save() {
    for (const f of fields) if (f.required && !(v[f.key] ?? "").trim()) return setErr(`${f.label} is required.`);
    for (const c of custom) if (c.required && !(extra[c.key] ?? "").trim()) return setErr(`${c.label} is required.`);
    setBusy(true); setErr("");
    const row: Record<string, unknown> = Object.fromEntries(fields.map((f) => [f.key, (v[f.key] ?? "").trim()]));
    if (initial.id) row.id = initial.id;
    if (custom.length) row.extra = Object.fromEntries(custom.map((c) => [c.key, (extra[c.key] ?? "").trim()]));
    const r = await rpc<{ id: string }>(sb, "growth_row_save", { channel, row }, labelOf);
    setBusy(false);
    if (r.error) return setErr(r.error);
    onSaved();
  }

  return (
    <Modal title={initial.id ? "Edit row" : channel === "ads" ? "Add ad" : "Add influencer post"} sub="Fields marked * are required." onClose={onClose} wide>
      <div className="mk-form">
        {fields.map((f) => (
          <div key={f.key} className={f.wide ? "mk-wide" : ""}>
            <Field label={f.label} required={f.required} hint={f.hint}>
              {f.kind === "select" ? (
                <select className="mk-sel" value={v[f.key] ?? ""} onChange={(e) => setV({ ...v, [f.key]: e.target.value })}>
                  <option value="">{f.required ? "Select…" : "—"}</option>
                  {f.options!.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : f.kind === "campaign" ? (
                <div className="mk-bar">
                  <select className="mk-sel" style={{ flex: 1 }} value={v[f.key] ?? ""} onChange={(e) => setV({ ...v, [f.key]: e.target.value })}>
                    <option value="">{f.required ? "Select…" : "—"}</option>
                    {meta.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button type="button" className="mk-link" onClick={openCampaigns}>Campaigns…</button>
                </div>
              ) : f.kind === "influencer" ? (
                <InfluencerPick sb={sb} list={meta.influencers} value={v[f.key] ?? ""} onChange={(id) => setV({ ...v, [f.key]: id })} reloadMeta={reloadMeta} />
              ) : (
                <input className="mk-in" type={inputType(f.kind)} inputMode={f.kind === "number" ? "decimal" : undefined} value={v[f.key] ?? ""}
                  onChange={(e) => setV({ ...v, [f.key]: e.target.value })} maxLength={f.kind === "url" ? 2000 : 1000} />
              )}
            </Field>
          </div>
        ))}
        {custom.map((c) => (
          <div key={c.key}>
            <Field label={c.label} required={c.required}>
              {c.type === "select" ? (
                <select className="mk-sel" value={extra[c.key] ?? ""} onChange={(e) => setExtra({ ...extra, [c.key]: e.target.value })}>
                  <option value="">{c.required ? "Select…" : "—"}</option>
                  {(c.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input className="mk-in" type={inputType(c.type)} inputMode={c.type === "number" ? "decimal" : undefined} value={extra[c.key] ?? ""}
                  onChange={(e) => setExtra({ ...extra, [c.key]: e.target.value })} maxLength={500} />
              )}
            </Field>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12 }}><Err msg={err} onClose={() => setErr("")} /></div>
      <div className="mk-foot">
        <button className="mk-btn" onClick={onClose}>Cancel</button>
        <button className="mk-pri" disabled={busy} onClick={save}>{busy ? "Saving…" : initial.id ? "Save" : "Add row"}</button>
      </div>
    </Modal>
  );
}

/** Searchable influencer list; a name that is not in it can be added in one click. */
function InfluencerPick({ sb, list, value, onChange, reloadMeta }: {
  sb: Client; list: Influencer[]; value: string; onChange: (id: string) => void; reloadMeta: () => void;
}) {
  const cur = list.find((i) => i.id === value);
  const [q, setQ] = useState(cur?.name ?? "");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (t ? list.filter((i) => i.name.toLowerCase().includes(t)) : list).slice(0, 50);
  }, [q, list]);
  const exact = list.some((i) => i.name.trim().toLowerCase() === q.trim().toLowerCase());

  async function add() {
    setBusy(true); setErr("");
    const r = await rpc<{ id: string; name: string }>(sb, "growth_influencer_add", { name: q.trim() });
    setBusy(false);
    if (r.error || !r.data) return setErr(r.error ?? "Could not add.");
    onChange(r.data.id); setQ(r.data.name); setOpen(false); reloadMeta();
  }

  return (
    <div className="mk-combo">
      <input className="mk-in" style={{ width: "100%" }} placeholder="Search influencers…" value={q} maxLength={120}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); if (value) onChange(""); }} aria-label="Influencer" />
      {open && (
        <div className="mk-combo-list">
          {shown.map((i) => (
            <button type="button" key={i.id} className={i.id === value ? "on" : ""} onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(i.id); setQ(i.name); setOpen(false); }}>{i.name}</button>
          ))}
          {shown.length === 0 && !q.trim() && <div className="mk-note" style={{ padding: 8 }}>No influencers yet. Type a name to add one.</div>}
          {q.trim() && !exact && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={add} disabled={busy}>
              {busy ? "Adding…" : `+ Add “${q.trim()}” as a new influencer`}
            </button>
          )}
        </div>
      )}
      {err && <span className="mk-fhint" style={{ color: "#ffb4c2" }}>{err}</span>}
    </div>
  );
}

// ───────────────────────────── columns ─────────────────────────────

export function ColumnsDialog({ sb, channel, columns, onClose, onChanged }: {
  sb: Client; channel: Channel; columns: CustomColumn[]; onClose: () => void; onChanged: () => void;
}) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState<ColType>("text");
  const [required, setRequired] = useState(false);
  const [opts, setOpts] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  async function add() {
    if (!label.trim()) return setErr("Column name is required.");
    const options = type === "select" ? opts.split(/[\n,]+/).map((o) => o.trim()).filter(Boolean) : undefined;
    if (type === "select" && !options?.length) return setErr("Add at least one option.");
    setBusy(true); setErr(""); setOk("");
    const r = await rpc<{ key: string }>(sb, "growth_column_add", { channel, label: label.trim(), type, required, ...(options ? { options } : {}) });
    setBusy(false);
    if (r.error) return setErr(r.error);
    setOk(`Column “${label.trim()}” added.${required ? " It is required for new rows and whenever a row is edited." : ""}`);
    setLabel(""); setOpts(""); setRequired(false); onChanged();
  }
  async function remove(c: CustomColumn) {
    if (!window.confirm(`Remove the column “${c.label}”? Its values stay saved but are no longer shown or required.`)) return;
    const r = await rpc(sb, "growth_column_remove", { channel, key: c.key });
    if (r.error) return setErr(r.error);
    onChanged();
  }

  return (
    <Modal title="Columns" sub="An added column is saved in the database with its type; every value is checked on save and on CSV upload." onClose={onClose}>
      {columns.length > 0 && (
        <table className="mk-table" style={{ marginBottom: 14 }}>
          <thead><tr><th>Column</th><th>Type</th><th>Required</th><th /></tr></thead>
          <tbody>
            {columns.map((c) => (
              <tr key={c.key}>
                <td className="mk-strong">{c.label}{c.options?.length ? <div className="mk-note">{c.options.join(" · ")}</div> : null}</td>
                <td>{c.type}</td><td>{c.required ? "Yes" : "No"}</td>
                <td className="r"><button className="mk-link" onClick={() => remove(c)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mk-form">
        <div className="mk-wide"><Field label="Column name" required><input className="mk-in" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} /></Field></div>
        <Field label="Type">
          <select className="mk-sel" value={type} onChange={(e) => setType(e.target.value as ColType)}>
            <option value="text">Text</option><option value="number">Number</option><option value="date">Date</option>
            <option value="url">Link (URL)</option><option value="select">Dropdown</option>
          </select>
        </Field>
        <Field label="Required for the team?">
          <label className="mk-bar" style={{ fontSize: 13, color: "var(--mut)" }}>
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Must be filled on every row
          </label>
        </Field>
        {type === "select" && (
          <div className="mk-wide"><Field label="Options" hint="One per line or comma-separated (max 30)."><textarea className="mk-in" rows={3} value={opts} onChange={(e) => setOpts(e.target.value)} /></Field></div>
        )}
      </div>
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <Err msg={err} onClose={() => setErr("")} />
        {ok && <div className="mk-ok" onClick={() => setOk("")}>{ok}</div>}
      </div>
      <div className="mk-foot">
        <button className="mk-btn" onClick={onClose}>Close</button>
        <button className="mk-pri" disabled={busy} onClick={add}>{busy ? "Adding…" : "Add column"}</button>
      </div>
    </Modal>
  );
}

// ───────────────────────────── CSV upload ─────────────────────────────

export function CsvDialog({ sb, channel, columns, onClose, onImported }: {
  sb: Client; channel: Channel; columns: CustomColumn[]; onClose: () => void; onImported: (n: number) => void;
}) {
  const [parsed, setParsed] = useState<CsvImport | null>(null);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const labelOf = (k: string) => columns.find((c) => c.key === k)?.label ?? k;
  const fields = channel === "ads" ? AD_FIELDS : INFL_FIELDS;

  async function pick(f: File | undefined) {
    setParsed(null); setErr(""); setLines([]);
    if (!f) return;
    setName(f.name);
    const issue = checkCsvFile(f);
    if (issue) return setErr(issue);
    const text = decodeCsvBytes(new Uint8Array(await f.arrayBuffer()));
    if (text === null) return setErr("This does not look like a CSV text file.");
    const r = csvToRows(text, channel, columns);
    if (!r.ok) return setErr(r.error);
    setParsed(r.data);
  }
  async function run() {
    if (!parsed) return;
    setBusy(true); setErr(""); setLines([]);
    const r = await rpc<{ inserted: number }>(sb, "growth_rows_import", { channel, rows: parsed.rows }, labelOf);
    setBusy(false);
    if (r.error) {
      setErr(r.error);
      if (r.code === "IMPORT_FAILED") setLines(importErrors(r.detail, labelOf));
      return;
    }
    onImported(r.data?.inserted ?? parsed.rows.length);
  }
  return (
    <Modal title="Upload CSV" sub={`The first row must be headings matching this table (e.g. ${fields.slice(0, 4).map((f) => f.label.replace(/ \(₹\)$/, "")).join(", ")}). Campaign${channel === "influencers" ? " and influencer" : ""} by name. All rows go in, or none (every error is listed).`} onClose={onClose}>
      <div className="mk-bar" style={{ marginBottom: 10 }}>
        <input type="file" accept=".csv,text/csv" onChange={(e) => pick(e.target.files?.[0])} aria-label="CSV file" style={{ fontSize: 12, color: "var(--mut)" }} />
      </div>
      {parsed && (
        <div className="mk-note" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span><b style={{ color: "var(--ink)" }}>{parsed.rows.length}</b> row{parsed.rows.length === 1 ? "" : "s"} in {name}.</span>
          <span>Columns used: {parsed.mapped.map((m) => m.header).join(", ")}</span>
          {parsed.ignored.length > 0 && <span>Ignored (calculated by the system): {parsed.ignored.join(", ")}</span>}
          {parsed.unknown.length > 0 && <span style={{ color: "#ffc58a" }}>Not a column of this table, skipped: {parsed.unknown.join(", ")}</span>}
          {channel === "influencers" && <span>Influencers that are not in the list yet are added.</span>}
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <Err msg={err + (lines.length ? `\n${lines.join("\n")}` : "")} />
      </div>
      <div className="mk-foot">
        <button className="mk-btn" onClick={onClose}>Close</button>
        <button className="mk-pri" disabled={!parsed || busy} onClick={run}>{busy ? "Importing…" : `Import ${parsed?.rows.length ?? ""} rows`}</button>
      </div>
    </Modal>
  );
}

// ───────────────────────────── campaigns ─────────────────────────────

type CampaignDraft = { id?: string; name: string; campaign_start: string; campaign_end: string; exam_date: string; budget: string; application_target: string };
const emptyDraft: CampaignDraft = { name: "", campaign_start: "", campaign_end: "", exam_date: "", budget: "", application_target: "" };

export function CampaignsDialog({ sb, campaigns, onClose, onChanged }: { sb: Client; campaigns: Campaign[]; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<CampaignDraft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function edit(c: Campaign) {
    setErr("");
    setD({ id: c.id, name: c.name, campaign_start: c.campaign_start ?? "", campaign_end: c.campaign_end ?? "", exam_date: c.exam_date ?? "",
      budget: c.budget == null ? "" : String(c.budget), application_target: c.application_target == null ? "" : String(c.application_target) });
  }
  async function save() {
    setBusy(true); setErr("");
    const p: Record<string, unknown> = { name: d.name, campaign_start: d.campaign_start, campaign_end: d.campaign_end, exam_date: d.exam_date,
      budget: d.budget, application_target: d.application_target };
    if (d.id) p.id = d.id;
    const r = await rpc(sb, "growth_campaign_save", p);
    setBusy(false);
    if (r.error) return setErr(r.error);
    setD(emptyDraft); onChanged();
  }
  async function del(c: Campaign) {
    if (!window.confirm(`Delete the campaign “${c.name}”?`)) return;
    const r = await rpc(sb, "growth_campaign_delete", { id: c.id });
    if (r.error) return setErr(r.error);
    onChanged();
  }

  return (
    <Modal title="Campaigns" sub="“Used in” on an ad or post points to one of these. In-window = leads that arrived between the start and end date (IST)." onClose={onClose} wide>
      <div className="mk-tablewrap" style={{ maxHeight: 280, marginBottom: 14 }}>
        <table className="mk-table">
          <thead><tr><th>Campaign</th><th>Window</th><th>Exam</th><th className="r">Budget</th><th className="r">Target</th><th className="r">Rows</th><th /></tr></thead>
          <tbody>
            {campaigns.length === 0 && <tr><td colSpan={7} className="mk-mid">No campaigns yet. Add the first one below.</td></tr>}
            {campaigns.map((c) => (
              <tr key={c.id} className={d.id === c.id ? "on" : ""}>
                <td className="mk-strong">{c.name}</td>
                <td>{fmtDate(c.campaign_start)} – {fmtDate(c.campaign_end)}</td>
                <td>{fmtDate(c.exam_date)}</td>
                <td className="r">{fmtInr(c.budget)}</td>
                <td className="r">{c.application_target ?? "—"}</td>
                <td className="r">{c.used}</td>
                <td className="r">
                  <button className="mk-link" onClick={() => edit(c)}>Edit</button>
                  {c.used === 0 && <button className="mk-link" onClick={() => del(c)}>Delete</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mk-form">
        <div className="mk-wide"><Field label={d.id ? "Edit campaign" : "New campaign"} required>
          <input className="mk-in" placeholder="e.g. VSAT-9" value={d.name} maxLength={60} onChange={(e) => setD({ ...d, name: e.target.value })} />
        </Field></div>
        <Field label="Campaign start" required><input className="mk-in mk-date" type="date" value={d.campaign_start} onChange={(e) => setD({ ...d, campaign_start: e.target.value })} /></Field>
        <Field label="Campaign end" required><input className="mk-in mk-date" type="date" value={d.campaign_end} onChange={(e) => setD({ ...d, campaign_end: e.target.value })} /></Field>
        <Field label="Exam date" required><input className="mk-in mk-date" type="date" value={d.exam_date} onChange={(e) => setD({ ...d, exam_date: e.target.value })} /></Field>
        <Field label="Budget (₹)"><input className="mk-in" inputMode="decimal" value={d.budget} onChange={(e) => setD({ ...d, budget: e.target.value })} /></Field>
        <Field label="Application target"><input className="mk-in" inputMode="numeric" value={d.application_target} onChange={(e) => setD({ ...d, application_target: e.target.value })} /></Field>
      </div>
      <div style={{ marginTop: 12 }}><Err msg={err} onClose={() => setErr("")} /></div>
      <div className="mk-foot">
        {d.id && <button className="mk-btn" onClick={() => setD(emptyDraft)}>New instead</button>}
        <button className="mk-btn" onClick={onClose}>Close</button>
        <button className="mk-pri" disabled={busy} onClick={save}>{busy ? "Saving…" : d.id ? "Save campaign" : "Add campaign"}</button>
      </div>
    </Modal>
  );
}
