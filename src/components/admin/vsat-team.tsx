"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { errorText } from "@/lib/vsat/pipeline";

/**
 * VSAT Settings · Team (admin only, migration 0098).
 * Add a person by the email of their Vedam One account as admissions / interviewer / counsellor,
 * limit them to one campus, or switch a role off (never deleted, so history keeps their name).
 * Admins themselves are managed elsewhere (user roles), not here.
 */

type Role = "admissions" | "interviewer" | "counsellor";
type Member = { user_id: string; name: string | null; email: string; role: Role; campus: "pune" | "gurugram" | null; active: boolean; created_at: string; open: number };

const input = "rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-[#22d3ee] focus:outline-none";
const btn = "rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-40";
const ROLE_LABEL: Record<Role, string> = { admissions: "Admissions", interviewer: "Interviewer", counsellor: "Counsellor" };
const ROLE_HELP: Record<Role, string> = {
  admissions: "Sees and manages every student (of their campus, if one is set), assigns interviews and counselling, moves stages, exports and sends messages.",
  interviewer: "Sees only the students assigned to them for an interview, without contact details, and fills the interview form.",
  counsellor: "Sees only the students assigned to them for counselling, without contact details, and submits counselling.",
};

export function VsatTeam() {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<Member[] | null>(null);
  const [err, setErr] = useState("");
  const [reload, setReload] = useState(0);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("interviewer");
  const [campus, setCampus] = useState<"" | "pune" | "gurugram">("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showOff, setShowOff] = useState(false);

  useEffect(() => {
    let on = true;
    void supabase.rpc("vsat_team_admin_list").then(({ data, error }) => {
      if (!on) return;
      if (error) { setErr(error.message === "FORBIDDEN" ? "Only admins can manage the VSAT team." : errorText(error.message)); return; }
      setErr(""); setRows((data as Member[]) ?? []);
    });
    return () => { on = false; };
  }, [supabase, reload]);

  const shown = useMemo(() => (rows ?? []).filter((r) => showOff || r.active), [rows, showOff]);
  const counts = useMemo(() => {
    const c: Record<Role, number> = { admissions: 0, interviewer: 0, counsellor: 0 };
    (rows ?? []).forEach((r) => { if (r.active) c[r.role] += 1; });
    return c;
  }, [rows]);

  async function add() {
    const e = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return setMsg({ ok: false, text: "Please enter a valid email." });
    setBusy(true); setMsg(null);
    // campus only limits admissions; interviewers and counsellors only ever see the students assigned to them
    const { data, error } = await supabase.rpc("vsat_team_add", { p: { email: e, role, campus: role === "admissions" ? campus || null : null } });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: errorText(error.message) });
    const d = data as { reactivated: boolean };
    setMsg({ ok: true, text: d.reactivated ? `${e} is a ${ROLE_LABEL[role].toLowerCase()} again.` : `${e} added as ${ROLE_LABEL[role].toLowerCase()}.` });
    setEmail(""); setReload((x) => x + 1);
  }

  async function update(m: Member, patch: { active?: boolean; campus?: string | null }) {
    if (patch.active === false) {
      const warn = m.open > 0 ? `\n\n${m.open} student${m.open === 1 ? " is" : "s are"} still scheduled with them. Re-assign ${m.open === 1 ? "that student" : "those students"} from the student page.` : "";
      if (!window.confirm(`Switch off ${m.name ?? m.email} as ${ROLE_LABEL[m.role].toLowerCase()}? They lose access to these panels at once.${warn}`)) return;
    }
    const { error } = await supabase.rpc("vsat_team_set", { p: { user_id: m.user_id, role: m.role, ...patch } });
    if (error) return setMsg({ ok: false, text: errorText(error.message) });
    setMsg(null); setReload((x) => x + 1);
  }

  if (err) return <div className="p-5"><p className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">{err}</p></div>;

  return (
    <div className="space-y-5 p-5 text-white">
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
        <h2 className="text-base font-semibold">Add a person</h2>
        <p className="text-xs text-white/50">They must already have a Vedam One account (signed up with this email). Admins don&apos;t need to be added: they can do everything.</p>
        <div className="flex flex-wrap items-center gap-2">
          <input className={`${input} w-72`} type="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} aria-label="Email" />
          <select className={input} value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Role">
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          {role === "admissions" && (
            <select className={input} value={campus} onChange={(e) => setCampus(e.target.value as "" | "pune" | "gurugram")} aria-label="Campus">
              <option value="">Both campuses</option><option value="pune">Pune only</option><option value="gurugram">Gurugram only</option>
            </select>
          )}
          <button className={`${btn} bg-[#34e2b0] text-[#04101a]`} disabled={busy} onClick={add}>{busy ? "Adding…" : "Add"}</button>
        </div>
        <p className="text-xs text-white/45">{ROLE_HELP[role]}</p>
        {msg && <p className={`text-sm ${msg.ok ? "text-emerald-300" : "text-rose-300"}`}>{msg.text}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm text-white/60">
        <span>Active: <b className="text-white">{counts.admissions}</b> admissions · <b className="text-white">{counts.interviewer}</b> interviewers · <b className="text-white">{counts.counsellor}</b> counsellors</span>
        <label className="ml-auto flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-[#34e2b0]" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} /> Show switched-off roles</label>
      </div>

      <div className="overflow-auto rounded-xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/50"><tr>
            <th className="px-3 py-2">Person</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Campus</th><th className="px-3 py-2">Scheduled now</th><th className="px-3 py-2">Status</th><th className="px-3 py-2" />
          </tr></thead>
          <tbody>
            {!rows && <tr><td colSpan={6} className="px-3 py-6 text-center text-white/50">Loading…</td></tr>}
            {rows && shown.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-white/50">No one on the team yet.</td></tr>}
            {shown.map((m) => (
              <tr key={`${m.user_id}:${m.role}`} className={`border-t border-white/5 ${m.active ? "" : "opacity-50"}`}>
                <td className="px-3 py-2"><div className="font-medium">{m.name ?? "—"}</div><div className="text-xs text-white/45">{m.email}</div></td>
                <td className="px-3 py-2">{ROLE_LABEL[m.role]}</td>
                <td className="px-3 py-2">
                  {m.role === "admissions" ? (
                    <select className={`${input} py-1`} value={m.campus ?? ""} disabled={!m.active} onChange={(e) => update(m, { campus: e.target.value || null })} aria-label={`Campus for ${m.email}`}>
                      <option value="">Both</option><option value="pune">Pune</option><option value="gurugram">Gurugram</option>
                    </select>
                  ) : <span className="text-xs text-white/40">Assigned students only</span>}
                </td>
                <td className="px-3 py-2 tabular-nums">{m.role === "admissions" ? "—" : m.open}</td>
                <td className="px-3 py-2">{m.active ? <span className="text-emerald-300">Active</span> : <span className="text-white/50">Off</span>}</td>
                <td className="px-3 py-2 text-right">
                  {m.active
                    ? <button className="text-xs text-rose-300 hover:underline" onClick={() => update(m, { active: false })}>Switch off</button>
                    : <button className="text-xs text-[#22d3ee] hover:underline" onClick={() => update(m, { active: true })}>Switch on</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
