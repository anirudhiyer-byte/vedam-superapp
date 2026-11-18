"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { buildCampaignPayload, fmtNum } from "@/lib/growth/campaigns";
import type { CampaignFull } from "@/lib/growth/marketing";
import { CSS, Field, Modal, rpc } from "./shared";

/**
 * Growth → Overview → Campaigns.
 * A copy of the Vedam CRM "Campaigns" page (layout, sizes, texts, icons, behaviour), in the staging look.
 * Reads with growth_campaigns_list, writes with growth_campaign_save / growth_campaign_delete (migration 0107);
 * the browser has no table access and the database checks the admin on every call.
 * One difference from the CRM: "Exam date" is an extra required field (the database column is NOT NULL).
 */

// lucide icon shapes (same as the CRM), drawn inline so no package is added
const ICONS: Record<string, ReactNode> = {
  calendar: <><path d="M8 2v4" /><path d="M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" /></>,
  clock: <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
  target: <><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></>,
  rupee: <><path d="M6 3h12" /><path d="M6 8h12" /><path d="m6 13 8.5 8" /><path d="M6 13h3" /><path d="M9 13c6.667 0 6.667-10 0-10" /></>,
  trend: <><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></>,
  wallet: <><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" /><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" /></>,
  edit: <><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" /></>,
  trash: <><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /><line x1="10" x2="10" y1="11" y2="17" /><line x1="14" x2="14" y1="11" y2="17" /></>,
  plus: <><path d="M5 12h14" /><path d="M12 5v14" /></>,
};

// CRM accent → nearest colour already used in the staging palette (violet, cyan, orange, pink, green, amber)
const ACCENT = { calendar: "#a78bfa", clock: "#22d3ee", target: "#fb923c", rupee: "#ff8fa3", trend: "#34e2b0", wallet: "#ffc58a" } as const;

function Icon({ name, color }: { name: keyof typeof ICONS; color?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color ?? "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      {ICONS[name]}
    </svg>
  );
}

type Toast = { kind: "ok" | "err"; text: string } | null;

export function CampaignsPanel() {
  const [sb] = useState(() => createClient());
  const [rows, setRows] = useState<CampaignFull[] | null>(null);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState<CampaignFull | null>(null);
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((kind: "ok" | "err", text: string) => {
    setToast({ kind, text });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 4000);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const load = useCallback(async () => {
    const r = await rpc<CampaignFull[]>(sb, "growth_campaigns_list");
    if (r.error) setErr(r.error); else { setErr(""); setRows(r.data ?? []); }
  }, [sb]);
  useEffect(() => { void load(); }, [load]);

  async function remove(c: CampaignFull) {
    if (!confirm(`Delete "${c.name}"?`)) return;
    const r = await rpc<{ ok: boolean }>(sb, "growth_campaign_delete", { id: c.id });
    if (r.error) say("err", r.error); else { say("ok", "Campaign deleted"); void load(); }
  }

  return (
    <div className="mk-wrap">
      <style>{CSS}</style>
      <style>{CP_CSS}</style>
      <div className="cp-page">
        <div className="cp-head cp-fade">
          <h1>Campaigns</h1>
          <p>Manage VSAT rounds and custom campaign windows</p>
        </div>

        {err && <div className="mk-err cp-error" role="alert">Error loading campaigns: {err}</div>}

        <div className="cp-fade" style={{ animationDelay: "80ms" }}>
          <div className="cp-addrow">
            <button className="mk-pri cp-add" onClick={() => setAdding(true)}><Icon name="plus" /> Add Campaign</button>
          </div>

          {rows === null ? (
            !err && <p className="mk-mid">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="cp-empty">
              <div className="cp-empty-t">No campaigns yet</div>
              <div className="cp-empty-s">Click <span>Add Campaign</span> to create your first one.</div>
            </div>
          ) : (
            <div className="cp-list">
              {rows.map((c) => (
                <div key={c.id} className="cp-card">
                  <div className="cp-main">
                    <div className="cp-name">{c.name}</div>
                    <div className="cp-meta">
                      <div><Icon name="calendar" color={ACCENT.calendar} /><span>{c.campaign_start} → {c.campaign_end}</span></div>
                      {c.last_date_to_apply && <div><Icon name="clock" color={ACCENT.clock} /><span>Apply by {c.last_date_to_apply}</span></div>}
                      <div><Icon name="target" color={ACCENT.target} /><span>Target: <b>{fmtNum(c.application_target)}</b></span></div>
                      {(c.budget ?? 0) > 0 && <div><Icon name="rupee" color={ACCENT.rupee} /><b>{fmtNum(c.budget)}</b></div>}
                      {c.planned_l2p != null && c.planned_l2p > 0 && <div><Icon name="trend" color={ACCENT.trend} /><span>Planned L2P: <b>{c.planned_l2p}%</b></span></div>}
                      {c.planned_cpp != null && c.planned_cpp > 0 && <div><Icon name="wallet" color={ACCENT.wallet} /><span>Planned CPP: <b>₹{fmtNum(c.planned_cpp)}</b></span></div>}
                    </div>
                    {c.metadata && Object.keys(c.metadata).length > 0 && (
                      <details className="cp-details">
                        <summary>Custom fields</summary>
                        <pre>{JSON.stringify(c.metadata, null, 2)}</pre>
                      </details>
                    )}
                  </div>
                  <div className="cp-acts">
                    <button className="cp-ib" onClick={() => setEditing(c)} aria-label={`Edit ${c.name}`} title="Edit"><Icon name="edit" /></button>
                    <button className="cp-ib cp-del" onClick={() => void remove(c)} aria-label={`Delete ${c.name}`} title="Delete"><Icon name="trash" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {adding && <CampaignDialog sb={sb} say={say} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void load(); }} />}
      {editing && <CampaignDialog sb={sb} say={say} campaign={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
      {toast && <div className={`cp-toast ${toast.kind === "ok" ? "mk-ok" : "mk-err"}`} role="status" onClick={() => setToast(null)}>{toast.text}</div>}
    </div>
  );
}

function CampaignDialog({ sb, say, campaign, onClose, onSaved }: {
  sb: ReturnType<typeof createClient>; say: (k: "ok" | "err", t: string) => void; campaign?: CampaignFull; onClose: () => void; onSaved: () => void;
}) {
  const isEdit = !!campaign;
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? "");
    const built = buildCampaignPayload({
      name: v("name"), campaign_start: v("campaign_start"), campaign_end: v("campaign_end"), exam_date: v("exam_date"),
      last_date_to_apply: v("last_date_to_apply"), application_target: v("application_target"), budget: v("budget"),
      planned_l2p: v("planned_l2p"), planned_cpp: v("planned_cpp"), metadata: v("metadata"),
    }, campaign?.id);
    if (!built.ok) { say("err", built.error); return; }
    setBusy(true);
    const r = await rpc<{ id: string }>(sb, "growth_campaign_save", built.payload);
    setBusy(false);
    if (r.error) { say("err", r.error); return; }
    say("ok", isEdit ? "Campaign updated" : "Campaign created");
    onSaved();
  }

  return (
    <div className="cp-dlg">
      <Modal title={isEdit ? "Edit Campaign" : "Add Campaign"} onClose={onClose}>
        <form onSubmit={(e) => void submit(e)} className="cp-form">
          <Field label="Name" required>
            <input className="mk-in" name="name" placeholder="e.g. VSAT-12" defaultValue={campaign?.name ?? ""} required maxLength={60} />
          </Field>
          <div className="cp-g2">
            <Field label="Start" required>
              <input className="mk-in" type="date" name="campaign_start" defaultValue={campaign?.campaign_start ?? ""} required />
            </Field>
            <Field label="End" required>
              <input className="mk-in" type="date" name="campaign_end" defaultValue={campaign?.campaign_end ?? ""} required />
            </Field>
          </div>
          <Field label="Last date to apply">
            <input className="mk-in" type="date" name="last_date_to_apply" defaultValue={campaign?.last_date_to_apply ?? ""} />
          </Field>
          <Field label="Exam date" required>
            <input className="mk-in" type="date" name="exam_date" defaultValue={campaign?.exam_date ?? ""} required />
          </Field>
          <div className="cp-g2">
            <Field label="Target apps">
              <input className="mk-in" type="number" name="application_target" min="0" step="1" defaultValue={campaign?.application_target || 0} />
            </Field>
            <Field label="Budget (₹)">
              <input className="mk-in" type="number" name="budget" min="0" step="0.01" defaultValue={campaign?.budget || 0} />
            </Field>
          </div>
          <div className="cp-g2">
            <Field label="Planned L2P (%)">
              <input className="mk-in" type="number" name="planned_l2p" min="0" max="100" step="0.01" placeholder="e.g. 12.5" defaultValue={campaign?.planned_l2p ?? ""} />
            </Field>
            <Field label="Planned CPP (₹)">
              <input className="mk-in" type="number" name="planned_cpp" min="0" step="0.01" placeholder="e.g. 8000" defaultValue={campaign?.planned_cpp ?? ""} />
            </Field>
          </div>
          <Field label="Custom fields / filters (JSON)" hint="Define filters that scope this campaign. Reports for this campaign apply these on top of the date range.">
            <textarea
              className="mk-in cp-json" name="metadata" rows={5}
              defaultValue={campaign?.metadata ? JSON.stringify(campaign.metadata, null, 2) : "{}"}
              placeholder='{"filters": {"campus_preference": "ADYPU Pune"}}'
            />
          </Field>
          <div className="cp-foot">
            <button type="button" className="mk-btn cp-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="mk-pri cp-sm" disabled={busy}>{isEdit ? "Update" : "Create"}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// Sizes, spacing, radius and motion follow the CRM page; colours and fonts come from the staging tokens.
const CP_CSS = `
@keyframes cpFadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
.cp-fade{animation:cpFadeUp .6s cubic-bezier(.16,1,.3,1) backwards}
.cp-page{padding:28px 32px 64px}
.cp-head{margin-bottom:32px}
.cp-head h1{font-family:var(--mk-head);font-size:48px;line-height:1;font-weight:700;letter-spacing:-.025em;margin:0 0 8px;background:linear-gradient(135deg,var(--ink),var(--mut));-webkit-background-clip:text;background-clip:text;color:transparent}
.cp-head p{margin:0;font-size:16px;line-height:24px;color:var(--mut2)}
.cp-error{margin-bottom:16px;cursor:default}
.cp-addrow{display:flex;justify-content:flex-end;margin-bottom:24px}
.cp-add{display:inline-flex;align-items:center;gap:8px;min-height:32px;padding:0 12px;font-size:14px;font-weight:500;border-radius:8px;box-shadow:0 10px 24px -8px rgba(52,226,176,.45);transition:transform .2s,box-shadow .2s}
.cp-add:hover{transform:translateY(-2px)}
.cp-list{display:grid;gap:16px}
.cp-list>*{opacity:0;animation:cpFadeUp .7s cubic-bezier(.16,1,.3,1) forwards}
.cp-list>*:nth-child(2){animation-delay:70ms}.cp-list>*:nth-child(3){animation-delay:140ms}.cp-list>*:nth-child(4){animation-delay:210ms}.cp-list>*:nth-child(5){animation-delay:280ms}.cp-list>*:nth-child(6){animation-delay:350ms}
.cp-card{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:24px;transition:border-color .3s,background .3s}
.cp-card:hover{border-color:rgba(130,150,255,.28);background:rgba(130,150,255,.07)}
.cp-main{flex:1;min-width:0}
.cp-name{font-family:var(--mk-head);font-weight:700;font-size:24px;line-height:32px;letter-spacing:-.025em;color:var(--ink);margin-bottom:12px;overflow-wrap:anywhere}
.cp-meta{display:flex;flex-wrap:wrap;gap:8px 24px;font-size:14px;line-height:20px;color:var(--mk-soft)}
.cp-meta>div{display:flex;align-items:center;gap:8px}
.cp-meta b{font-weight:500;color:var(--ink)}
.cp-details{margin-top:12px;font-size:12px;line-height:16px}
.cp-details summary{cursor:pointer;color:var(--mut2)}
.cp-details summary:hover{color:var(--ink)}
.cp-details pre{margin:8px 0 0;padding:12px;background:rgba(130,150,255,.06);border:1px solid var(--line);border-radius:8px;font-family:var(--mk-code);font-size:11px;line-height:1.5;overflow-x:auto;color:var(--mk-soft)}
.cp-acts{display:flex;gap:8px;flex-shrink:0;opacity:.6;transition:opacity .2s}
.cp-card:hover .cp-acts,.cp-acts:focus-within{opacity:1}
.cp-ib{display:grid;place-items:center;height:28px;padding:0 10px;border-radius:8px;border:1px solid rgba(130,150,255,.14);background:rgba(130,150,255,.06);color:var(--ink);cursor:pointer}
.cp-ib:hover{background:rgba(130,150,255,.12)}
.cp-del:hover{background:rgba(255,90,120,.2);border-color:rgba(255,90,120,.3)}
.cp-empty{padding:64px 20px;text-align:center;background:var(--panel);border:1px solid var(--line);border-radius:16px}
.cp-empty-t{font-size:18px;line-height:28px;margin-bottom:4px;color:var(--mk-soft)}
.cp-empty-s{font-size:14px;line-height:20px;color:var(--mut2)}
.cp-empty-s span{color:var(--ink);font-weight:500}
.cp-toast{position:fixed;right:20px;bottom:20px;z-index:80;max-width:min(420px,calc(100vw - 40px));box-shadow:0 10px 30px rgba(0,0,0,.4)}
.cp-dlg .mk-sheet{width:min(448px,100%)}
.cp-dlg .mk-sheet h3{font-family:var(--mk-head);font-size:24px;line-height:32px;font-weight:600;letter-spacing:-.025em;margin:0}
.cp-form{display:flex;flex-direction:column;gap:16px;margin-top:8px}
.cp-g2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.cp-dlg .mk-field{gap:6px;min-width:0}
.cp-dlg .mk-flabel{font-size:12px;line-height:16px;font-weight:400;text-transform:uppercase;letter-spacing:.12em;color:var(--mk-soft)}
.cp-dlg .mk-fhint{font-size:12px;line-height:16px}
.cp-dlg .mk-in{width:100%;box-sizing:border-box;min-width:0;min-height:32px;padding:4px 10px;font-size:14px;border-radius:8px}
.cp-dlg .cp-json{padding:8px 12px;border-radius:6px;font-family:var(--mk-code);font-size:14px;resize:vertical}
.cp-foot{display:flex;justify-content:flex-end;gap:8px;padding-top:8px}
.cp-sm{min-height:32px;padding:0 12px;font-size:14px;border-radius:8px}
@media (max-width:600px){.cp-page{padding:18px 16px 40px}.cp-head h1{font-size:34px}.cp-card{padding:18px;flex-direction:column}.cp-acts{opacity:1}.cp-g2{grid-template-columns:1fr}}
`;
