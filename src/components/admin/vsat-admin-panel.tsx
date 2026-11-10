"use client";
import { useState } from "react";
import Image from "next/image";
import { VsatFormBuilder } from "@/components/admin/vsat-form-builder";
import { VsatExamCenter, type WheeboxStatus } from "@/components/admin/vsat-exam-center";
import { VsatExamDates } from "@/components/admin/vsat-exam-dates";
import { CommunicationManager, CM_GROUPS, type CmPage } from "@/components/admin/communication/cm-shell";
import { CallingPanel, type CallingPage } from "@/components/admin/calling/calling-panel";

/**
 * VSAT Admin Panel — wears the same "Neural" shell as the Growth panel
 * (public/growth/index.html): dark rail with grouped nav + soon/live pills, a
 * content area, and VSAT|Growth pills at the top of the rail.
 *
 * - VSAT tools (Form Builder, Exam Center + Dates) mount as React in the content
 *   area. Unbuilt items are "coming next" placeholders.
 * - Growth loads the existing Growth modules in a frame, unchanged.
 */

type Sub = { label: string; page: string };
type Item = { id: string; label: string; icon: string; live?: boolean; file?: string; sub?: Sub[]; cm?: boolean };
type Group = { g: string; items: Item[] };

const ICON: Record<string, string> = {
  leads: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',
  apps: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>',
  exam: '<path d="M22 3L2 11l6 2 2 6 4-5 5 4z"/>',
  intv: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  couns: '<path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z"/>',
  form: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  center: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13a7.9 7.9 0 0 0 0-2l2-1.5-2-3.4-2.3 1a8 8 0 0 0-1.7-1L15 3.5h-4l-.4 2.6a8 8 0 0 0-1.7 1l-2.3-1-2 3.4L6.6 11a7.9 7.9 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a8 8 0 0 0 1.7 1l.4 2.6h4l.4-2.6a8 8 0 0 0 1.7-1l2.3 1 2-3.4z"/>',
  comms: '<path d="M4 4h16v12H5.2L4 17.2z"/>',
  season: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>',
  cohort: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>',
  call: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7l.7 2.7a2 2 0 0 1-.5 2.1L8 9.6a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.1-.5l2.7.7A2 2 0 0 1 22 16.9z"/>',
  infl: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><path d="M16 5a3 3 0 0 1 0 6"/>',
  tele: '<path d="M22 3L2 11l6 2 2 6 4-5 5 4z"/>',
  cons: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  pred: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-2 5-4 1 2-5z"/>',
  sprint: '<path d="M9 8l-5 4 5 4M15 8l5 4-5 4"/>',
  event: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 3v3M16 3v3"/>',
};

const VSAT: Group[] = [
  { g: "Leads & Applications", items: [
    { id: "leads", label: "VSAT Leads", icon: ICON.leads },
    { id: "apps", label: "VSAT Applications", icon: ICON.apps },
  ] },
  { g: "VSAT Process", items: [
    { id: "exam", label: "VSAT Exam", icon: ICON.exam },
    { id: "intv", label: "Interview", icon: ICON.intv },
    { id: "couns", label: "Counselling", icon: ICON.couns },
  ] },
  { g: "VSAT Settings", items: [
    { id: "form", label: "Form Builder", icon: ICON.form, live: true },
    { id: "center", label: "Exam Center", icon: ICON.center, live: true },
  ] },
  { g: "VSAT Communications", items: [
    // Communication module (sample data). Names + page keys come from the module itself.
    ...CM_GROUPS.map((g) => ({
      id: `cm-${g.label.toLowerCase().replace(/\s+/g, "-")}`, label: g.label, icon: ICON.comms, live: true, cm: true,
      sub: g.items.map((i) => ({ label: i.label, page: i.key })),
    })),
  ] },
];

// Growth modules (served from /public/growth/<file>). Mirrors the Growth shell:
// only pred/sprint/event are navigable; the rest render as "soon".
const GROWTH: Group[] = [
  { g: "Overview", items: [
    { id: "season", label: "Season Dashboard", icon: ICON.season },
    { id: "cohort", label: "Payment Cohort", icon: ICON.cohort },
    { id: "vcamp", label: "VSAT Campaign Report", icon: ICON.exam },
  ] },
  { g: "Marketing Channels", items: [
    { id: "calling", label: "Calling", icon: ICON.call, live: true, sub: [
      { label: "Calling Data", page: "data" }, { label: "Dashboards", page: "dash" },
      { label: "UTM Listing", page: "utm" }, { label: "Callers", page: "callers" },
      { label: "Elevate", page: "elevate" },
    ] },
    { id: "infl", label: "Influencers", icon: ICON.infl },
    { id: "tele", label: "Telegram Channel", icon: ICON.tele },
    { id: "cons", label: "Consultants Channel", icon: ICON.cons },
    { id: "pred", label: "College Predictor", icon: ICON.pred, live: true, file: "predictor.html", sub: [
      { label: "Cost & CPL Listing", page: "cost-listing" }, { label: "Cost & CPL Dashboard", page: "cost-dash" },
      { label: "UTM Listing", page: "utm-listing" }, { label: "UTM Dashboard", page: "utm-dash" },
    ] },
    { id: "sprint", label: "Code Sprint", icon: ICON.sprint, live: true, file: "codesprint.html", sub: [
      { label: "Cost & CPL Listing", page: "cost-listing" }, { label: "Cost & CPL Dashboard", page: "cost-dash" },
      { label: "UTM Listing", page: "utm-listing" }, { label: "UTM Dashboard", page: "utm-dash" },
    ] },
    { id: "event", label: "Events", icon: ICON.event, live: true, file: "events.html", sub: [
      { label: "Events Listing", page: "listing" }, { label: "Events Performance", page: "perf" },
    ] },
  ] },
];

function Svg({ inner, cls }: { inner: string; cls?: string }) {
  return <svg viewBox="0 0 24 24" className={cls} dangerouslySetInnerHTML={{ __html: inner }} />;
}

export function VsatAdminPanel({ wheebox }: { wheebox: WheeboxStatus }) {
  const [panel, setPanel] = useState<"vsat" | "growth">("vsat");
  const [active, setActive] = useState<{ id: string; file?: string; page?: string; cm?: boolean; title: string }>({ id: "form", title: "Form Builder" });
  const [open, setOpen] = useState<string | null>(null); // open parent id

  const model = panel === "vsat" ? VSAT : GROWTH;

  function switchPanel(p: "vsat" | "growth") {
    setPanel(p); setOpen(null);
    if (p === "vsat") setActive({ id: "form", title: "Form Builder" });
    else setActive({ id: "pred", file: "predictor.html", page: "cost-listing", title: "College Predictor · Cost & CPL Listing" });
  }

  // a Communication page asking to open another one (e.g. Manage List → Upload Raw Data)
  function goCm(k: CmPage) {
    const g = CM_GROUPS.find((x) => x.items.some((i) => i.key === k));
    const i = g?.items.find((x) => x.key === k);
    if (!g || !i) return;
    const id = `cm-${g.label.toLowerCase().replace(/\s+/g, "-")}`;
    setOpen(id);
    setActive({ id, page: k, cm: true, title: `${g.label} · ${i.label}` });
  }

  function Content() {
    if (panel === "growth") {
      if (active.id === "calling") return <div className="vp-scroll"><CallingPanel page={(active.page ?? "data") as CallingPage} /></div>;
      if (active.file) return <iframe title={active.title} src={`/growth/${active.file}#page=${active.page ?? ""}`} className="vp-frame" />;
      return <Placeholder title={active.title} kind="growth" />;
    }
    if (active.cm && active.page) return <div className="vp-scroll"><CommunicationManager key={active.page} page={active.page as CmPage} onNavigate={goCm} /></div>;
    if (active.id === "form") return <div className="vp-scroll"><VsatFormBuilder /></div>;
    if (active.id === "center") return <div className="vp-scroll"><VsatExamCenter wheebox={wheebox} /><VsatExamDates /></div>;
    return <Placeholder title={active.title} kind="vsat" />;
  }

  return (
    <div className="vsat-shell">
      <style>{CSS}</style>
      <div className="vp-app">
        <aside className="vp-rail">
          <div className="vp-brand"><Image src="/vedam-logo-dark.png" alt="Vedam School of Technology" width={118} height={42} className="vp-logo" priority /></div>
          <div className="vp-pills">
            <button className={panel === "vsat" ? "on" : ""} onClick={() => switchPanel("vsat")}>VSAT</button>
            <button className={panel === "growth" ? "on" : ""} onClick={() => switchPanel("growth")}>Growth</button>
          </div>
          <nav className="vp-nav">
            {model.map((group) => (
              <div className="vp-grp" key={group.g}>
                <div className="vp-gl">{group.g}</div>
                {group.items.map((it) => {
                  if (it.sub && it.live) {
                    const isOpen = open === it.id;
                    return (
                      <div key={it.id}>
                        <div className={`vp-parent${isOpen ? " open" : ""}`} onClick={() => setOpen(isOpen ? null : it.id)}>
                          <Svg inner={it.icon} /><span className="vp-lbl">{it.label}</span>
                          <Svg inner='<path d="M6 9l6 6 6-6"/>' cls="vp-chev" />
                        </div>
                        {isOpen && (
                          <div className="vp-children">
                            {it.sub.map((s) => {
                              const on = active.id === it.id && active.page === s.page;
                              return (
                                <a key={s.page} className={on ? "on" : ""} onClick={() => setActive({ id: it.id, file: it.file, page: s.page, cm: it.cm, title: `${it.label} · ${s.label}` })}>
                                  <Svg inner='<circle cx="12" cy="12" r="2.5"/>' /><span className="vp-lbl">{s.label}</span>
                                </a>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  }
                  const on = active.id === it.id;
                  return (
                    <a key={it.id} className={`${it.live ? "" : "vp-soon"}${on ? " on" : ""}`}
                      onClick={() => it.live && setActive({ id: it.id, title: it.label })}>
                      <Svg inner={it.icon} /><span className="vp-lbl">{it.label}</span>
                      {it.live ? <span className="vp-plive"><i />Live</span> : <span className="vp-psoon">Soon</span>}
                    </a>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="vp-foot">
            <a className="vp-so" href="/admin"><Svg inner='<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>' /><span>Back to Admin</span></a>
          </div>
        </aside>
        <div className="vp-content">
          <div className="vp-ctop"><span className="vp-crumb">{panel === "vsat" ? "VSAT" : "GROWTH"}</span><span className="vp-title">{active.title}</span></div>
          <div className="vp-main"><Content /></div>
        </div>
      </div>
    </div>
  );
}

function Placeholder({ title, kind }: { title: string; kind: "vsat" | "growth" }) {
  return (
    <div className="vp-ph">
      <div className="vp-phcard">
        <h2>{title}</h2>
        <p>{kind === "growth"
          ? "This Growth module isn’t wired in yet — it opens here once it goes live."
          : "This section is next in the admin-level build-out — Leads & Applications (like Product Users) and the Process actions."}</p>
        <span className="vp-phtag">Coming next</span>
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
.vsat-shell{--bg:#070a16;--bg2:#0b1024;--panel:rgba(20,26,54,.55);--ink:#f2f5ff;--mut:#aeb8e0;--mut2:#7681b2;--green:#34e2b0;--cyan:#22d3ee;--violet:#8b5cf6;--line:rgba(130,150,255,.10);--rail:rgba(12,16,38,.72);--display:'Sora',system-ui,sans-serif;--font:'Inter',system-ui,sans-serif;--mono:'JetBrains Mono',monospace;color-scheme:dark}
.vsat-shell{color:var(--ink);font-family:var(--font)}
.vp-app{display:grid;grid-template-columns:248px 1fr;height:100vh;height:100dvh;background:radial-gradient(1100px 700px at 82% -8%,rgba(139,92,246,.16),transparent 60%),radial-gradient(900px 620px at -6% 108%,rgba(34,211,238,.13),transparent 58%),linear-gradient(180deg,var(--bg),var(--bg2))}
.vp-rail{background:var(--rail);backdrop-filter:blur(14px);border-right:1px solid var(--line);display:flex;flex-direction:column;padding:16px 12px;gap:2px;overflow:auto}
.vp-brand{display:flex;align-items:center;padding:4px 8px 12px;border-bottom:1px solid var(--line)}
.vp-logo{width:118px;max-width:100%;height:auto;display:block}
.vp-pills{display:grid;grid-template-columns:1fr 1fr;gap:6px;background:rgba(130,150,255,.06);border:1px solid var(--line);border-radius:12px;padding:5px;margin:12px 2px 4px}
.vp-pills button{border:0;background:transparent;color:var(--mut);font-family:var(--display);font-weight:600;font-size:12px;letter-spacing:.3px;text-transform:uppercase;padding:8px 0;border-radius:9px;cursor:pointer;transition:.16s}
.vp-pills button.on{color:#04101a;background:linear-gradient(90deg,var(--green),var(--cyan));box-shadow:0 6px 18px -8px rgba(52,226,176,.6)}
.vp-nav{display:flex;flex-direction:column}
.vp-grp{margin-top:12px}
.vp-gl{font-family:var(--mono);font-size:9.5px;letter-spacing:3px;color:var(--mut2);text-transform:uppercase;padding:4px 11px 7px}
.vp-nav a,.vp-parent{display:flex;align-items:center;gap:11px;padding:10px 11px;border-radius:11px;color:var(--mut);font-size:13.5px;font-weight:500;text-decoration:none;cursor:pointer;transition:.16s;border:1px solid transparent;user-select:none}
.vp-nav a:hover:not(.vp-soon),.vp-parent:hover{color:var(--ink);background:rgba(130,150,255,.07)}
.vp-nav a.on{color:var(--ink);background:linear-gradient(90deg,rgba(52,226,176,.22),rgba(34,211,238,.05));border-color:rgba(52,226,176,.3);box-shadow:inset 0 0 0 1px rgba(52,226,176,.15)}
.vp-nav svg{width:18px;height:18px;flex:none;stroke:currentColor;stroke-width:1.9;fill:none;stroke-linecap:round;stroke-linejoin:round}
.vp-lbl{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vp-chev{width:15px!important;height:15px!important;transition:.22s;opacity:.7}
.vp-parent.open .vp-chev{transform:rotate(180deg)}
.vp-children{display:flex;flex-direction:column;gap:2px;margin:2px 0 4px 14px;padding-left:10px;border-left:1px solid var(--line)}
.vp-children a{font-size:12.8px;padding:8px 11px}
.vp-children svg{width:15px!important;height:15px!important}
.vp-soon{opacity:.42;cursor:not-allowed}
.vp-soon:hover{background:transparent;color:var(--mut)}
.vp-psoon{font-family:var(--mono);font-size:8px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:var(--mut2);border:1px solid var(--line);border-radius:999px;padding:2px 6px;flex:none}
.vp-plive{font-family:var(--mono);font-size:8px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--green);border:1px solid rgba(52,226,176,.35);background:rgba(52,226,176,.1);border-radius:999px;padding:2px 6px;flex:none;display:inline-flex;align-items:center;gap:4px}
.vp-plive i{width:5px;height:5px;border-radius:50%;background:var(--green);display:inline-block}
.vp-foot{margin-top:auto;padding-top:12px;border-top:1px solid var(--line)}
.vp-so{display:flex;align-items:center;gap:11px;padding:10px 11px;border-radius:11px;color:var(--mut);cursor:pointer;font-size:13.5px;font-weight:500;text-decoration:none}
.vp-so svg{width:18px;height:18px;stroke:currentColor;stroke-width:1.9;fill:none;stroke-linecap:round;stroke-linejoin:round}
.vp-so:hover{color:var(--ink);background:rgba(130,150,255,.07)}
.vp-content{position:relative;min-width:0;display:flex;flex-direction:column;overflow:hidden}
.vp-ctop{display:flex;align-items:center;gap:10px;padding:13px 22px;border-bottom:1px solid var(--line);background:rgba(12,16,38,.4)}
.vp-crumb{font-family:var(--mono);font-size:11px;color:var(--mut2)}
.vp-title{font-family:var(--display);font-weight:600;font-size:15px}
.vp-main{flex:1;min-height:0;overflow:hidden;position:relative}
.vp-frame{border:0;width:100%;height:100%;background:var(--bg)}
.vp-scroll{height:100%;overflow:auto}
.vp-ph{height:100%;display:grid;place-items:center;padding:24px}
.vp-phcard{max-width:560px;border:1px dashed var(--line);border-radius:16px;background:var(--panel);padding:28px;text-align:center}
.vp-phcard h2{font-family:var(--display);margin:0 0 8px;font-size:19px}
.vp-phcard p{color:var(--mut);font-size:13.5px;margin:0}
.vp-phtag{display:inline-block;margin-top:16px;font-family:var(--mono);font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--mut2);border:1px solid var(--line);border-radius:999px;padding:5px 12px}
@media(max-width:860px){.vp-app{grid-template-columns:1fr}.vp-rail{display:none}}
`;
