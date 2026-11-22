"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cx, vx } from "@/components/admin/ui/vx";

const input = vx.input;
const label = vx.label;
const card = cx(vx.card, "p-5 sm:p-6");
const btn = cx(vx.btn, vx.primary);
const btnGhost = cx(vx.btn, vx.ghost, vx.sm);

type Step = {
  step_key: string; title: string; enabled: boolean; test_mode: boolean;
  email_enabled: boolean; email_subject: string; email_body: string;
  wa_enabled: boolean; wa_template_id: string | null;
};
type Settings = { master: boolean; test_email: string; test_phone: string };

/** Interview steps (0140) are sent by the interview jobs, by email only, with their own placeholders. */
const isInterviewStep = (key: string) => /^interview(er)?_/.test(key);
const STAGE_VARS = ["name", "amount", "apply_link", "dashboard_link", "receipt_link"];
const INTERVIEW_VARS = ["name", "student_name", "application_no", "date", "time", "old_date", "old_time", "join_link", "dashboard_link", "panel_link"];
const varList = (vars: string[]) => vars.map((v) => `{{${v}}}`).join(" ");

function Toggle({ on, onClick, text }: { on: boolean; onClick: () => void; text: string }) {
  return (
    <button type="button" onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ${on ? "bg-vx-green/20 text-vx-green" : "bg-white/10 text-vx-faint"}`}>
      <span className={`h-2 w-2 rounded-full ${on ? "bg-vx-green" : "bg-white/40"}`} />{text}: {on ? "ON" : "OFF"}
    </button>
  );
}

export function VsatCommsPanel() {
  const [supabase] = useState(() => createClient());
  const [steps, setSteps] = useState<Step[]>([]);
  const [settings, setSettings] = useState<Settings>({ master: false, test_email: "", test_phone: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({}); // steps collapsed by default

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("vsat_comm_steps_get");
    if (data?.ok) {
      setSteps((data.steps as Step[]) ?? []);
      const s = data.settings as Settings | null;
      if (s) setSettings({ master: !!s.master, test_email: s.test_email || "", test_phone: s.test_phone || "" });
    }
    setLoading(false);
  }, [supabase]);
  useEffect(() => { void load(); }, [load]);

  function patch(i: number, p: Partial<Step>) {
    setSteps((arr) => arr.map((s, n) => (n === i ? { ...s, ...p } : s)));
  }

  async function saveStep(s: Step) {
    setBusy(true); setMsg("");
    const { data } = await supabase.rpc("vsat_comm_step_update", { p: {
      step_key: s.step_key, enabled: s.enabled, test_mode: s.test_mode, email_enabled: s.email_enabled,
      email_subject: s.email_subject, email_body: s.email_body, wa_enabled: s.wa_enabled, wa_template_id: s.wa_template_id ?? "",
    } });
    setBusy(false);
    setMsg(data?.ok ? `Saved “${s.title}”.` : "Couldn't save — admin only.");
  }

  async function saveSettings() {
    setBusy(true); setMsg("");
    const { data } = await supabase.rpc("vsat_comm_step_update", { p: { master: settings.master, test_email: settings.test_email, test_phone: settings.test_phone } });
    setBusy(false);
    setMsg(data?.ok ? "Settings saved." : "Couldn't save settings.");
  }

  async function submitTemplates() {
    setBusy(true); setMsg("Submitting WhatsApp templates for approval…");
    const { data: { session } } = await supabase.auth.getSession();
    try {
      const res = await fetch("/api/admin/vsat-comm/submit-templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken: session?.access_token }) });
      const j = await res.json();
      setMsg(j.ok ? "Templates submitted to TrustSignal — they'll show here once approved. Then turn each step's WhatsApp ON." : `Submit issue: ${JSON.stringify(j.results ?? j.error).slice(0, 200)}`);
      await load();
    } catch { setMsg("Couldn't reach the submit endpoint."); }
    setBusy(false);
  }

  return (
    <section className={`${card} mt-5`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-sans text-[17px] font-semibold tracking-[-0.01em]">Stage communications (email + WhatsApp)</h2>
          <p className="mt-1 text-sm text-vx-mut">Automatic emails + WhatsApp at each VSAT stage. Edit the email copy; WhatsApp uses approved utility templates.</p>
        </div>
        <Toggle on={settings.master} onClick={() => setSettings((s) => ({ ...s, master: !s.master }))} text="Master" />
      </div>

      {loading ? <p className="mt-4 text-sm text-vx-faint">Loading…</p> : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div><label className={label}>Test email (used while a step is in test mode)</label>
              <input className={input} value={settings.test_email} onChange={(e) => setSettings((s) => ({ ...s, test_email: e.target.value }))} placeholder="you@vedam.org" /></div>
            <div><label className={label}>Test phone (digits, e.g. 9198…)</label>
              <input className={input} value={settings.test_phone} onChange={(e) => setSettings((s) => ({ ...s, test_phone: e.target.value }))} placeholder="9198XXXXXXXX" /></div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button onClick={saveSettings} disabled={busy} className={btn}>Save settings</button>
            <button onClick={submitTemplates} disabled={busy} className={btnGhost}>Submit WhatsApp templates for approval</button>
            <span className="text-xs text-vx-faint">Master OFF = nothing sends. A step in test mode sends only to the test email/phone above.</span>
          </div>

          <div className="mt-5 flex items-center justify-between">
            <p className="text-xs text-vx-faint">{steps.length} automated step{steps.length === 1 ? "" : "s"} — tap to expand &amp; edit.</p>
            <div className="flex gap-2 text-[11px]">
              <button type="button" onClick={() => setOpen(Object.fromEntries(steps.map((s) => [s.step_key, true])))} className="text-vx-faint hover:text-vx-ink">Expand all</button>
              <button type="button" onClick={() => setOpen({})} className="text-vx-faint hover:text-vx-ink">Collapse all</button>
            </div>
          </div>
          <div className="mt-2 space-y-2.5">
            {steps.map((s, i) => {
              const isOpen = !!open[s.step_key];
              const chips = [s.enabled ? "On" : "Off", s.email_enabled && "Email", s.wa_enabled && "WhatsApp", s.test_mode && "Test mode"].filter(Boolean).join(" · ");
              return (
                <div key={s.step_key} className="rounded-xl border border-vx-line bg-black/20">
                  {/* collapsed header — tap to expand */}
                  <button type="button" onClick={() => setOpen((o) => ({ ...o, [s.step_key]: !o[s.step_key] }))}
                    className="flex w-full items-center justify-between gap-3 p-4 text-left">
                    <div className="min-w-0">
                      <h3 className="font-display text-sm font-bold">{s.title}</h3>
                      <p className="mt-0.5 truncate text-[11px] text-vx-faint">{chips}</p>
                    </div>
                    <span aria-hidden className="shrink-0 text-vx-faint">{isOpen ? "▾" : "▸"}</span>
                  </button>

                  {isOpen && (
                    <div className="border-t border-vx-line p-4 pt-3">
                      <div className="flex flex-wrap gap-2">
                        <Toggle on={s.enabled} onClick={() => patch(i, { enabled: !s.enabled })} text="Step" />
                        <Toggle on={s.test_mode} onClick={() => patch(i, { test_mode: !s.test_mode })} text="Test mode" />
                      </div>

                      {/* ── Email channel (its own content) ── */}
                      <div className="mt-3 rounded-lg border border-vx-line bg-white/[0.02] p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-vx-mut">✉️ Email</span>
                          <Toggle on={s.email_enabled} onClick={() => patch(i, { email_enabled: !s.email_enabled })} text="Email" />
                        </div>
                        <input className={`${input} mt-2`} value={s.email_subject} onChange={(e) => patch(i, { email_subject: e.target.value })} placeholder="Email subject" />
                        <textarea className={`${input} mt-2 min-h-[120px] font-mono text-[12px]`} value={s.email_body} onChange={(e) => patch(i, { email_body: e.target.value })}
                          placeholder={`Email body (HTML). Placeholders: ${varList(isInterviewStep(s.step_key) ? INTERVIEW_VARS : STAGE_VARS)}`} />
                        {isInterviewStep(s.step_key) && (
                          <p className="mt-1.5 text-[11px] text-vx-faint">
                            Placeholders: {varList(INTERVIEW_VARS)}. {"{{name}}"} is the person getting the email; {"{{join_link}}"} is the meeting link
                            (or the dashboard / panel link until the Google Meet is ready); {"{{old_date}}"} and {"{{old_time}}"} are only in &ldquo;moved&rdquo; emails.
                          </p>
                        )}
                      </div>

                      {/* ── WhatsApp channel (separate — copy comes from the approved template). Interview steps: email only. ── */}
                      {isInterviewStep(s.step_key) ? (
                        <p className="mt-3 text-[11px] text-vx-faint">Interview messages go by email only (with the Google Calendar invite). There is no WhatsApp for this step.</p>
                      ) : (
                      <div className="mt-3 rounded-lg border border-vx-line bg-white/[0.02] p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-vx-mut">💬 WhatsApp</span>
                          <Toggle on={s.wa_enabled} onClick={() => patch(i, { wa_enabled: !s.wa_enabled })} text="WhatsApp" />
                        </div>
                        <input className={`${input} mt-2`} value={s.wa_template_id ?? ""} onChange={(e) => patch(i, { wa_template_id: e.target.value })} placeholder="WhatsApp template id (set after approval)" />
                        <p className="mt-1.5 text-[11px] text-vx-faint">WhatsApp copy is set by the approved template — kept separate from the email content above.</p>
                      </div>
                      )}

                      <div className="mt-3"><button onClick={() => saveStep(s)} disabled={busy} className={btn}>Save step</button></div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {msg && <p className="mt-4 text-sm text-vx-green">{msg}</p>}
          <p className="mt-3 text-[11px] text-vx-faint">Placeholders: <code>{"{{name}}"}</code>, <code>{"{{amount}}"}</code>, <code>{"{{apply_link}}"}</code>, <code>{"{{dashboard_link}}"}</code>, <code>{"{{receipt_link}}"}</code> (interview steps have their own, listed in each step). WhatsApp copy is fixed by the approved template; the email is fully editable.</p>
        </>
      )}
    </section>
  );
}
