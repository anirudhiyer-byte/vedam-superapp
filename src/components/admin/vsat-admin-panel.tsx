"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { VsatFormBuilder } from "@/components/admin/vsat-form-builder";
import { VsatExamCenter, type WheeboxStatus } from "@/components/admin/vsat-exam-center";
import { VsatExamDates } from "@/components/admin/vsat-exam-dates";
import { CommunicationManager, CM_GROUPS, type CmPage } from "@/components/admin/communication/cm-shell";
import { CallingPanel, type CallingPage } from "@/components/admin/calling/calling-panel";
import { MarketingPanel, type MarketingPage } from "@/components/admin/marketing/marketing-panel";
import { ConsultantsPanel } from "@/components/admin/marketing/consultants/consultants-panel";
import { TelegramPanel } from "@/components/admin/marketing/telegram/telegram-panel";
import { CampaignsPanel } from "@/components/admin/marketing/campaigns-panel";
import { SeasonPanel } from "@/components/admin/marketing/season-panel";
import { VcampPanel } from "@/components/admin/marketing/vcamp-panel";
import { CohortPanel } from "@/components/admin/marketing/cohort-panel";
import { PipelinePanel } from "@/components/admin/vsat-pipeline/pipeline-panel";
import { VsatLeadsPanel } from "@/components/admin/vsat-leads-panel";
import { VsatSettings } from "@/components/admin/vsat-settings";
import { VsatTeam } from "@/components/admin/vsat-team";
import { visiblePanels, type PanelKey, type VsatRoles } from "@/lib/vsat/pipeline";

/**
 * VSAT Admin Panel — wears the same "Neural" shell as the Growth panel
 * (public/growth/index.html): dark rail with grouped nav + "soon" pills, a
 * content area, and VSAT|Growth pills at the top of the rail.
 *
 * - VSAT tools (Form Builder, Exam Center + Dates) mount as React in the content
 *   area. Unbuilt items are "coming next" placeholders.
 * - VSAT pipeline panels (Applications, Exam, Interview, Counselling) show by VSAT role.
 *   People who are only on the VSAT team (not Vedam staff / admin) see just their panels —
 *   no settings, communications or Growth. The database checks every call again.
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
  campaign: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  season: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>',
  cohort: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>',
  call: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7l.7 2.7a2 2 0 0 1-.5 2.1L8 9.6a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.1-.5l2.7.7A2 2 0 0 1 22 16.9z"/>',
  ads: '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  infl: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><path d="M16 5a3 3 0 0 1 0 6"/>',
  tele: '<path d="M22 3L2 11l6 2 2 6 4-5 5 4z"/>',
  cons: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  pred: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-2 5-4 1 2-5z"/>',
  sprint: '<path d="M9 8l-5 4 5 4M15 8l5 4-5 4"/>',
  event: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 3v3M16 3v3"/>',
  scoring: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  team: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
};

const VSAT: Group[] = [
  { g: "Leads & applications", items: [
    { id: "leads", label: "VSAT Leads", icon: ICON.leads, live: true },
    { id: "apps", label: "VSAT Applications", icon: ICON.apps },
  ] },
  { g: "VSAT process", items: [
    { id: "exam", label: "VSAT Exam", icon: ICON.exam },
    { id: "intv", label: "Interview", icon: ICON.intv },
    { id: "couns", label: "Counselling", icon: ICON.couns },
  ] },
  { g: "VSAT settings", items: [
    { id: "form", label: "Form Builder", icon: ICON.form, live: true },
    { id: "center", label: "Exam Center", icon: ICON.center, live: true },
    { id: "scoring", label: "Scholarship & Scoring", icon: ICON.scoring, live: true },
    { id: "team", label: "Team", icon: ICON.team, live: true },
  ] },
  { g: "VSAT communications", items: [
    // Communication module (sample data). Names + page keys come from the module itself.
    ...CM_GROUPS.map((g) => ({
      id: `cm-${g.label.toLowerCase().replace(/\s+/g, "-")}`, label: g.label, icon: ICON.comms, live: true, cm: true,
      sub: g.items.map((i) => ({ label: i.label, page: i.key })),
    })),
  ] },
];

// Growth modules (served from /public/growth/<file>). Mirrors the Growth shell:
// only calling/ads/infl/pred/sprint/event are navigable; the rest render as "soon".
const GROWTH: Group[] = [
  { g: "Overview", items: [
    { id: "season", label: "Season Dashboard", icon: ICON.season, live: true },
    { id: "cohort", label: "Payment Cohort", icon: ICON.cohort, live: true },
    { id: "vcamp", label: "VSAT Campaign Report", icon: ICON.exam, live: true },
    { id: "campaigns", label: "Campaigns", icon: ICON.campaign, live: true },
  ] },
  { g: "Marketing channels", items: [
    { id: "calling", label: "Calling", icon: ICON.call, live: true, sub: [
      { label: "Calling Data", page: "data" }, { label: "Dashboards", page: "dash" },
      { label: "UTM Listing", page: "utm" }, { label: "Callers", page: "callers" },
      { label: "Elevate", page: "elevate" },
    ] },
    { id: "ads", label: "Ads", icon: ICON.ads, live: true, sub: [
      { label: "Ads Listing", page: "listing" }, { label: "Ad Performance", page: "perf" },
    ] },
    { id: "infl", label: "Influencers", icon: ICON.infl, live: true, sub: [
      { label: "Influencer Listing", page: "listing" }, { label: "Influencer Performance", page: "perf" },
    ] },
    { id: "tele", label: "Telegram Channel", icon: ICON.tele, live: true, sub: [{ label: "Telegram Listing", page: "listing" }] },
    { id: "cons", label: "Consultants Channel", icon: ICON.cons, live: true, sub: [
      { label: "Consultant Listing", page: "listing" }, { label: "Consultant Performance", page: "perf" },
    ] },
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

const PIPELINE: PanelKey[] = ["apps", "exam", "intv", "couns"];
const isPanelKey = (id: string): id is PanelKey => (PIPELINE as string[]).includes(id);

export function VsatAdminPanel({ wheebox, staff, vsatRoles }: { wheebox: WheeboxStatus; staff: boolean; vsatRoles: VsatRoles }) {
  const allowed = visiblePanels(vsatRoles);
  const first = allowed[0];
  const firstTitle = VSAT.flatMap((g) => g.items).find((i) => i.id === first)?.label ?? "";
  const [panel, setPanel] = useState<"vsat" | "growth">("vsat");
  const [active, setActive] = useState<{ id: string; file?: string; page?: string; cm?: boolean; title: string }>(
    staff ? { id: "form", title: "Form Builder" } : { id: first ?? "none", title: firstTitle });
  const [open, setOpen] = useState<string | null>(null); // open parent id
  // One tick per click on a page in the menu. The page area is keyed on it, so a page starts fresh when it is
  // picked (as before), but opening or closing a menu group no longer re-mounts the page and wipes what the
  // user chose on it (campaign, dates, filters, search, tab).
  const [nav, setNav] = useState(0);
  function go(a: typeof active) { setActive(a); setNav((n) => n + 1); }

  // Phones / tablets (≤860px): the menu is a slide-in drawer opened from the ☰ button in the top bar
  // (as in the reference design public/growth/index.html). Picking a page, the scrim or Esc closes it.
  const [drawer, setDrawer] = useState(false);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const railRef = useRef<HTMLElement>(null);
  function closeDrawer() { setDrawer(false); burgerRef.current?.focus(); }
  function pick(a: typeof active) { go(a); setDrawer(false); }
  useEffect(() => {
    if (!drawer) return;
    // Focus the menu itself, not its first button: the buttons inherit visibility through their own CSS transitions,
    // so for the first frame they are still hidden and cannot take focus. The rail turns visible at once.
    railRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setDrawer(false); burgerRef.current?.focus(); } };
    // back to a wide screen: the rail is a normal column again, so drop the drawer state
    const wide = window.matchMedia("(min-width: 861px)");
    const onWide = () => { if (wide.matches) setDrawer(false); };
    window.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);
    return () => { window.removeEventListener("keydown", onKey); wide.removeEventListener("change", onWide); };
  }, [drawer]);

  // pipeline items go live by role; non-staff team members see only their pipeline panels
  const vsatModel: Group[] = VSAT
    .map((g) => ({ ...g, items: g.items
      .filter((it) => staff || (isPanelKey(it.id) && allowed.includes(it.id)))
      .map((it) => (isPanelKey(it.id) ? { ...it, live: allowed.includes(it.id) } : it)) }))
    .filter((g) => g.items.length > 0);
  const model = panel === "vsat" ? vsatModel : GROWTH;

  function switchPanel(p: "vsat" | "growth") {
    setPanel(p); setOpen(null);
    if (p === "vsat") go({ id: "form", title: "Form Builder" });
    else go({ id: "pred", file: "predictor.html", page: "cost-listing", title: "College Predictor · Cost & CPL Listing" });
  }

  // a Communication page asking to open another one (e.g. Manage List → Upload Raw Data)
  function goCm(k: CmPage) {
    const g = CM_GROUPS.find((x) => x.items.some((i) => i.key === k));
    const i = g?.items.find((x) => x.key === k);
    if (!g || !i) return;
    const id = `cm-${g.label.toLowerCase().replace(/\s+/g, "-")}`;
    setOpen(id);
    go({ id, page: k, cm: true, title: `${g.label} · ${i.label}` });
  }

  // called as a plain function (not <Content />): a component defined in here is a new type on every render,
  // which re-mounted the whole page on any change of this shell
  function renderContent() {
    if (panel === "growth") {
      if (active.id === "season") return <div className="vp-scroll"><SeasonPanel /></div>;
      if (active.id === "vcamp") return <div className="vp-scroll"><VcampPanel /></div>;
      if (active.id === "cohort") return <div className="vp-scroll"><CohortPanel /></div>;
      if (active.id === "campaigns") return <div className="vp-scroll"><CampaignsPanel /></div>;
      if (active.id === "calling") return <div className="vp-scroll"><CallingPanel page={(active.page ?? "data") as CallingPage} /></div>;
      if (active.id === "ads" || active.id === "infl") {
        const ch = active.id === "ads" ? "ads" : "influencers";
        return <div className="vp-scroll"><MarketingPanel key={`${ch}-${active.page}`} channel={ch} page={(active.page ?? "listing") as MarketingPage} /></div>;
      }
      if (active.id === "tele") return <div className="vp-scroll"><TelegramPanel /></div>;
      if (active.id === "cons") return <div className="vp-scroll"><ConsultantsPanel key={active.page} page={active.page === "perf" ? "perf" : "listing"} /></div>;
      if (active.file) return <iframe title={active.title} src={`/growth/${active.file}#page=${active.page ?? ""}`} className="vp-frame" />;
      return <Placeholder title={active.title} kind="growth" />;
    }
    if (active.cm && active.page) return <div className="vp-scroll"><CommunicationManager key={active.page} page={active.page as CmPage} onNavigate={goCm} /></div>;
    if (active.id === "form") return <div className="vp-scroll"><VsatFormBuilder /></div>;
    if (active.id === "center") return <div className="vp-scroll"><VsatExamCenter wheebox={wheebox} /><VsatExamDates /></div>;
    // admin only: the database refuses everyone else and the screen says so
    if (active.id === "scoring") return <div className="vp-scroll"><VsatSettings /></div>;
    if (active.id === "team") return <div className="vp-scroll"><VsatTeam /></div>;
    // Leads & Applications read straight from lead_manager / application_manager (every
    // row, not the exam pipeline). Exam / Interview / Counselling stay on the pipeline.
    if (active.id === "leads") return <div className="vp-scroll"><VsatLeadsPanel /></div>;
    // "apps" renders the full pipeline Applications panel (stage moves, comments, bulk,
    // assignments) — same as Exam/Interview/Counselling. (Showing pre-booking applicants
    // here too is handled by enrolling them into the pipeline, built separately.)
    if (isPanelKey(active.id) && allowed.includes(active.id)) return <div className="vp-scroll"><PipelinePanel key={active.id} panel={active.id} roles={vsatRoles} /></div>;
    return <Placeholder title={active.title} kind="vsat" />;
  }

  return (
    <div className="vsat-shell">
      <style>{CSS}</style>
      <div className="vp-app">
        <aside className={`vp-rail${drawer ? " open" : ""}`} id="vp-rail" ref={railRef} tabIndex={-1} aria-label="VSAT admin menu">
          <div className="vp-brand"><Image src="/vedam-logo-dark.png" alt="Vedam School of Technology" width={118} height={42} className="vp-logo" priority /></div>
          {staff && (
            <div className="vp-pills">
              <button className={panel === "vsat" ? "on" : ""} onClick={() => switchPanel("vsat")}>VSAT</button>
              <button className={panel === "growth" ? "on" : ""} onClick={() => switchPanel("growth")}>Growth</button>
            </div>
          )}
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
                                <a key={s.page} className={on ? "on" : ""} aria-current={on ? "page" : undefined} onClick={() => pick({ id: it.id, file: it.file, page: s.page, cm: it.cm, title: `${it.label} · ${s.label}` })}>
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
                    <a key={it.id} className={`${it.live ? "" : "vp-soon"}${on ? " on" : ""}`} aria-current={on ? "page" : undefined}
                      onClick={() => it.live && pick({ id: it.id, title: it.label })}>
                      <Svg inner={it.icon} /><span className="vp-lbl">{it.label}</span>
                      {!it.live && <span className="vp-psoon">Soon</span>}
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
          <div className="vp-ctop">
            <button type="button" ref={burgerRef} className="vp-burger" aria-label="Open menu" aria-controls="vp-rail" aria-expanded={drawer}
              onClick={() => setDrawer(true)}>
              <Svg inner='<path d="M3 6h18M3 12h18M3 18h18"/>' />
            </button>
            <div className="vp-crumbs">
              <span>{panel === "vsat" ? "VSAT" : "Growth"}</span>
              {active.title.split(" · ").map((part, i, all) => (
                <Fragment key={i}><span className="vp-sep" aria-hidden="true">/</span><span className={i === all.length - 1 ? "vp-title" : undefined}>{part}</span></Fragment>
              ))}
            </div>
          </div>
          <div className="vp-main"><Fragment key={nav}>{renderContent()}</Fragment></div>
        </div>
      </div>
      <div className={`vp-scrim${drawer ? " on" : ""}`} onClick={closeDrawer} aria-hidden="true" />
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
/* Brand tokens (Vedam Visual Identity: Electric Violet #8A18FF, Vedam Orange #F97D03, Outfit). Fonts come from next/font
   (--font-outfit / --font-jetbrains on <body>), so nothing extra is downloaded. --green / --cyan / --line / --mut2 are
   also read by the Growth calling panel. */
.vsat-shell{--bg:#09071c;--bg2:#0b0823;--rail:#0c0a24;--panel:rgba(255,255,255,.035);--ink:#f5f3ff;--mut:#aca6d4;--mut2:#8a84b5;--violet:#8a18ff;--violet-t:#b98aff;--orange:#f97d03;--green:#2bd99f;--cyan:#00cfe5;--line:rgba(170,160,255,.11);--line2:rgba(170,160,255,.22);--display:var(--font-outfit),system-ui,sans-serif;--font:var(--font-outfit),system-ui,sans-serif;--mono:var(--font-jetbrains),ui-monospace,monospace;color-scheme:dark}
.vsat-shell{color:var(--ink);font-family:var(--font);-webkit-font-smoothing:antialiased}
.vsat-shell select,.vsat-shell input[type=date],.vsat-shell input[type=time],.vsat-shell input[type=datetime-local]{color-scheme:dark}
.vsat-shell select option,.vsat-shell select optgroup{background:#16123a;color:#f5f3ff}
.vsat-shell select option:checked{background:#8a18ff;color:#fff}
.vsat-shell select option:disabled{color:#8a84b5}
.vp-app{display:grid;grid-template-columns:256px 1fr;height:100vh;height:100dvh;background:radial-gradient(900px 520px at 88% -12%,rgba(138,24,255,.12),transparent 65%),linear-gradient(180deg,var(--bg),var(--bg2))}
.vp-rail{background:var(--rail);border-right:1px solid var(--line);display:flex;flex-direction:column;padding:20px 14px;gap:2px;overflow:auto}
.vp-brand{display:flex;align-items:center;padding:2px 10px 16px}
.vp-logo{width:124px;max-width:100%;height:auto;display:block}
.vp-pills{display:grid;grid-template-columns:1fr 1fr;gap:4px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:4px;margin:0 2px 4px}
.vp-pills button{border:0;background:transparent;color:var(--mut);font:500 13.5px var(--font);padding:8px 0;border-radius:9px;cursor:pointer;transition:background-color .16s,color .16s}
.vp-pills button:hover:not(.on){color:var(--ink)}
.vp-pills button.on{color:#fff;background:var(--violet);box-shadow:inset 0 1px 0 rgba(255,255,255,.18)}
.vp-nav{display:flex;flex-direction:column}
.vp-grp{margin-top:14px}
.vp-gl{font:500 12px var(--font);color:var(--mut2);padding:4px 12px 6px}
.vp-nav a,.vp-parent{position:relative;display:flex;align-items:center;gap:12px;padding:9px 12px;border-radius:10px;color:var(--mut);font-size:14.5px;font-weight:400;line-height:1.3;text-decoration:none;cursor:pointer;transition:background-color .16s,color .16s;user-select:none}
.vp-nav a:hover:not(.vp-soon),.vp-parent:hover{color:var(--ink);background:rgba(255,255,255,.04)}
.vp-nav a.on{color:var(--ink);background:rgba(138,24,255,.16);font-weight:500}
/* the brand rhomboid marks where you are */
.vp-nav a.on::before{content:"";position:absolute;left:-8px;top:50%;width:8px;height:14px;border-radius:2px;background:var(--orange);transform:translateY(-50%) skewX(-18deg)}
.vp-nav svg{width:18px;height:18px;flex:none;stroke:currentColor;stroke-width:1.8;fill:none;stroke-linecap:round;stroke-linejoin:round;opacity:.85}
.vp-nav a.on svg{opacity:1}
.vp-lbl{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vp-chev{width:15px!important;height:15px!important;transition:transform .22s;opacity:.6}
.vp-parent.open .vp-chev{transform:rotate(180deg)}
.vp-children{display:flex;flex-direction:column;gap:2px;margin:2px 0 4px 20px;padding-left:10px;border-left:1px solid var(--line)}
.vp-children a{font-size:13.5px;padding:8px 11px}
.vp-children a.on::before{left:-15px;width:6px;height:11px}
.vp-children svg{width:14px!important;height:14px!important}
.vp-soon{opacity:.5;cursor:not-allowed}
.vp-soon:hover{background:transparent;color:var(--mut)}
.vp-psoon{font:500 11px var(--font);color:var(--mut2);border:1px solid var(--line);border-radius:999px;padding:1px 8px;flex:none}
.vp-foot{margin-top:auto;padding-top:10px;border-top:1px solid var(--line)}
.vp-so{display:flex;align-items:center;gap:12px;padding:9px 12px;border-radius:10px;color:var(--mut);cursor:pointer;font-size:14.5px;text-decoration:none;transition:background-color .16s,color .16s}
.vp-so svg{width:18px;height:18px;stroke:currentColor;stroke-width:1.8;fill:none;stroke-linecap:round;stroke-linejoin:round;opacity:.85}
.vp-so:hover{color:var(--ink);background:rgba(255,255,255,.04)}
.vp-content{position:relative;min-width:0;display:flex;flex-direction:column;overflow:hidden}
.vp-ctop{display:flex;align-items:center;gap:12px;min-height:60px;padding:0 32px;border-bottom:1px solid var(--line);background:rgba(9,7,28,.55);backdrop-filter:blur(10px)}
.vp-crumbs{display:flex;align-items:center;gap:8px;min-width:0;font-size:13.5px;color:var(--mut2)}
.vp-crumbs span{white-space:nowrap}
.vp-crumbs .vp-sep{color:var(--line2)}
.vp-crumbs .vp-title{color:var(--ink);font-weight:500;overflow:hidden;text-overflow:ellipsis}
.vp-main{flex:1;min-height:0;overflow:hidden;position:relative}
.vp-frame{border:0;width:100%;height:100%;background:var(--bg)}
.vp-scroll{height:100%;overflow:auto}
.vp-ph{height:100%;display:grid;place-items:center;padding:24px}
.vp-phcard{max-width:560px;border:1px dashed var(--line2);border-radius:18px;background:var(--panel);padding:32px;text-align:center}
.vp-phcard h2{font:600 20px var(--display);letter-spacing:-.01em;margin:0 0 8px}
.vp-phcard p{color:var(--mut);font-size:14.5px;line-height:1.55;margin:0}
.vp-phtag{display:inline-block;margin-top:18px;font:500 12px var(--font);color:var(--mut);border:1px solid var(--line);border-radius:999px;padding:4px 12px}
.vp-burger{display:none;width:40px;height:40px;border-radius:11px;border:1px solid var(--line);background:var(--panel);color:var(--ink);align-items:center;justify-content:center;cursor:pointer;flex:none;padding:0}
.vp-burger svg{width:20px;height:20px;stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round}
.vp-burger:focus-visible,.vp-pills button:focus-visible,.vp-so:focus-visible{outline:2px solid var(--violet-t);outline-offset:2px}
.vp-rail:focus{outline:none}
.vp-scrim{display:none;position:fixed;inset:0;background:rgba(4,3,14,.6);backdrop-filter:blur(2px);z-index:35}
/* phones / tablets: the rail becomes a slide-in drawer opened from the ☰ button (reference: public/growth/index.html) */
@media(max-width:860px){
  .vp-app{grid-template-columns:1fr}
  .vp-ctop{padding:0 16px}
  .vp-burger{display:flex}
  .vp-rail{position:fixed;top:0;left:0;bottom:0;width:280px;max-width:85vw;z-index:40;background:var(--rail);transform:translateX(-102%);visibility:hidden;transition:transform .26s cubic-bezier(.2,.7,.2,1),visibility 0s linear .26s;box-shadow:24px 0 60px rgba(0,0,0,.5)}
  .vp-rail.open{transform:none;visibility:visible;transition:transform .26s cubic-bezier(.2,.7,.2,1)}
  .vp-scrim.on{display:block}
}
@media(max-width:860px) and (prefers-reduced-motion:reduce){.vp-rail,.vp-rail.open{transition:none}}
`;
