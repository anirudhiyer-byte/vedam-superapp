"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cx, vx } from "@/components/admin/ui/vx";
import { errorText, type VsatRoles } from "@/lib/vsat/pipeline";
import { defaultVsat } from "@/lib/vsat/exam-evaluation";
import { campusLabel } from "@/lib/vsat/leads-grid";
import {
  PROFILE_Q_MAX, fieldRows, hitText, lookupParams, matchText, type ProfileHit, type ProfileLookup, type ProfileStudent, type ProfileVsat,
} from "@/lib/vsat/profile-analysis";
import { StageBadge } from "./pipeline-panel";
import { ProfileBox } from "./student-drawer";

/**
 * Profile Analysis (Phase 7, 0191; sir's review 24 Nov 2026) — under Buckets. Pick the VSAT, search the student by
 * application ID (or name), and see every field of the sheet's "Profile Analyzer" filled in from the application, VSAT,
 * interview and counselling data, with the AI summary for the counsellor (neutral, logical, structured). The summary is
 * the existing analyser: made on the server and saved on the counselling record, so it needs a counselling record.
 * Admin / admissions see their campus; a counsellor sees only their own students (the database checks every call).
 */

const VSAT_KEY = "vsat-profile:vsat";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

export function ProfileAnalysis({ roles }: { roles: VsatRoles }) {
  void roles; // access is decided by the database on every call
  const [supabase] = useState(() => createClient());
  const [vsats, setVsats] = useState<ProfileVsat[] | null>(null);
  const [vsatId, setVsatId] = useState("");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ list: ProfileHit[]; total: number } | null>(null);
  const [searching, setSearching] = useState(false);
  const [openId, setOpenId] = useState("");
  const [student, setStudent] = useState<ProfileStudent | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [reload, setReload] = useState(0);

  // the VSAT list; open on the last one picked here, else the latest whose exam day has come
  useEffect(() => {
    let on = true;
    void supabase.rpc("vsat_profile_lookup", { p: {} }).then(({ data, error }) => {
      if (!on) return;
      if (error) { setErr(errorText(error.message)); setVsats([]); return; }
      const list = ((data as ProfileLookup).vsats ?? []).map((v) => ({ ...v, exam_date: v.exam_date ?? "" }));
      let saved = "";
      try { saved = localStorage.getItem(VSAT_KEY) ?? ""; } catch { /* storage can be off */ }
      setVsats(list);
      setVsatId(list.some((v) => v.id === saved) ? saved : defaultVsat(list, today()) ?? "");
    });
    return () => { on = false; };
  }, [supabase]);

  function pickVsat(id: string) {
    setVsatId(id); setOpenId(""); setStudent(null);
    try { localStorage.setItem(VSAT_KEY, id); } catch { /* storage can be off */ }
  }

  // the students of the VSAT matching the search (waits for typing to pause)
  useEffect(() => {
    if (!vsatId) { setHits(null); return; }
    let on = true;
    const t = setTimeout(() => {
      setSearching(true);
      void supabase.rpc("vsat_profile_lookup", { p: lookupParams(vsatId, q) }).then(({ data, error }) => {
        if (!on) return;
        setSearching(false);
        if (error) { setErr(errorText(error.message)); setHits(null); return; }
        setErr("");
        const d = data as ProfileLookup;
        setHits({ list: d.students ?? [], total: d.total ?? 0 });
      });
    }, 300);
    return () => { on = false; clearTimeout(t); };
  }, [supabase, vsatId, q, reload]);

  // one student's profile
  useEffect(() => {
    if (!openId) { setStudent(null); return; }
    let on = true;
    setLoading(true);
    void supabase.rpc("vsat_profile_get", { p: { application_id: openId, exam_date_id: vsatId || null } }).then(({ data, error }) => {
      if (!on) return;
      setLoading(false);
      if (error) { setErr(errorText(error.message)); setStudent(null); return; }
      setErr("");
      setStudent(data as ProfileStudent);
    });
    return () => { on = false; };
  }, [supabase, openId, vsatId, reload]);

  const rows = fieldRows(student?.fields);

  return (
    <div className={vx.page}>
      <div className={vx.head}>
        <div>
          <h1 className={vx.h1}>Profile Analysis</h1>
          <p className={vx.sub}>Pick the VSAT and search the student by application ID or name. Every field fills in from the application, VSAT, interview and counselling data, with the AI summary for the counsellor.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className={vx.label} htmlFor="pa-vsat">VSAT</label>
            <select id="pa-vsat" className={cx(vx.field, "min-w-[12rem]")} value={vsatId} onChange={(e) => pickVsat(e.target.value)} disabled={!vsats?.length}>
              {(vsats ?? []).map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </div>
          <div>
            <label className={vx.label} htmlFor="pa-q">Application ID or name</label>
            <input id="pa-q" className={cx(vx.field, "min-w-[16rem]")} value={q} maxLength={PROFILE_Q_MAX} placeholder="e.g. Vedam-54231"
              onChange={(e) => setQ(e.target.value)} disabled={!vsatId} autoComplete="off" />
          </div>
          <button className={cx(vx.btn, vx.ghost)} onClick={() => setReload((n) => n + 1)} disabled={!vsatId}>Refresh</button>
        </div>
      </div>

      {err && <p className={cx(vx.error, "mb-4")} role="alert">{err}</p>}
      {vsats && vsats.length === 0 && !err && <p className={vx.note}>No VSAT yet. Add one in Exam Center → Exam dates.</p>}

      <div className="grid gap-5 lg:grid-cols-[minmax(240px,300px)_1fr]">
        <section className={cx(vx.card, "p-3")} aria-labelledby="pa-list">
          <h2 id="pa-list" className={cx(vx.h3, "px-2 pb-2 pt-1")}>Students</h2>
          {searching && !hits && <p className={cx(vx.note, "px-2")}>Searching…</p>}
          {hits && (
            <>
              <p className={cx(vx.note, "px-2 pb-2")}>{matchText(hits.list.length, hits.total)}</p>
              <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
                {hits.list.map((h) => (
                  <li key={h.application_id}>
                    <button
                      className={cx("w-full rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-vx-violet",
                        openId === h.application_id && "bg-vx-violet/15 text-vx-ink")}
                      aria-current={openId === h.application_id ? "true" : undefined}
                      onClick={() => setOpenId(h.application_id)}>
                      <span className="block truncate text-vx-ink">{hitText(h)}</span>
                      <span className="mt-0.5 flex items-center gap-2 text-xs text-vx-faint">{campusLabel(h.campus)} <StageBadge stage={h.stage} status={h.status} /></span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <div className="min-w-0 space-y-5">
          {!openId && <section className={cx(vx.card, vx.pad)}><p className={vx.note}>Pick a student from the list to see their profile.</p></section>}
          {openId && loading && !student && <section className={cx(vx.card, vx.pad)}><p className={vx.note}>Loading…</p></section>}
          {student && (
            <>
              <section className={cx(vx.card, vx.pad)} aria-labelledby="pa-who">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 id="pa-who" className={vx.h2}>{student.name ?? student.application_id}</h2>
                    <p className={cx(vx.note, "mt-1")}>
                      {student.application_no ?? student.application_id} · {campusLabel(student.campus)}{student.vsat ? ` · ${student.vsat.label}` : ""}
                    </p>
                  </div>
                  <StageBadge stage={student.stage} status={student.status} />
                </div>
              </section>

              <section className={cx(vx.card, vx.pad)} aria-labelledby="pa-summary">
                <h2 id="pa-summary" className={cx(vx.h2, "mb-3")}>AI summary for the counsellor</h2>
                {student.has_counselling ? (
                  <ProfileBox key={`${student.application_id}:${student.analysis?.generated_at ?? ""}`} applicationId={student.application_id}
                    saved={student.analysis?.text ?? null} savedAt={student.analysis?.generated_at ?? null} canGenerate />
                ) : student.analysis ? (
                  <ProfileBox key={student.application_id} applicationId={student.application_id}
                    saved={student.analysis.text} savedAt={student.analysis.generated_at} canGenerate={false} />
                ) : (
                  <p className={vx.note}>The summary is made once the student has a counselling session booked (it is saved on the counselling record). The fields below are ready now.</p>
                )}
              </section>

              <section className={cx(vx.card, vx.pad)} aria-labelledby="pa-fields">
                <h2 id="pa-fields" className={cx(vx.h2, "mb-1")}>Student profile</h2>
                <p className={cx(vx.note, "mb-3")}>The fields of the sheet&apos;s Profile Analyzer. Empty fields are left out. These are exactly the fields the AI reads.</p>
                {rows.length === 0 ? <p className={vx.note}>No data yet for this student.</p> : (
                  <dl className="divide-y divide-vx-line overflow-hidden rounded-xl border border-vx-line">
                    {rows.map(([k, v], i) => (
                      <div key={`${i}-${k}`} className="grid gap-1 px-3.5 py-2.5 text-sm sm:grid-cols-[minmax(180px,38%)_1fr] sm:gap-4">
                        <dt className="text-vx-faint">{k}</dt>
                        <dd className="whitespace-pre-wrap break-words text-vx-ink">{v}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
