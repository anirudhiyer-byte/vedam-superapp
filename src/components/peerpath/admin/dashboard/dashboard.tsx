"use client";

import "./dashboard.css";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_FILTERS, flaggedFeedback, scopeChats, seniorInScope, type DashData, type DashFilters, type ImpactKey, type RangeDays } from "@/lib/peerpath/admin-dashboard";
import type { AdminTab } from "@/lib/peerpath/admin-insights";
import { ttsPath } from "@/lib/peerpath/constants";
import { Drawer, TipLayer, UiContext, type DrawerContent, type TipApi } from "./ui";
import { ImpactView, OverviewView, QualityView, SeniorPanel, SeniorsView, SessionsView } from "./views";

const VIEWS: [AdminTab, string, string, string][] = [
  ["overview", "Overview", "What needs you today", "M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"],
  ["sessions", "Sessions", "How chats are going", "M15 10l4.55-2.28A1 1 0 0121 8.62v6.76a1 1 0 01-1.45.9L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"],
  ["seniors", "Seniors", "Who is carrying PeerPath", "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"],
  ["quality", "Quality", "What applicants say", "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"],
  ["impact", "Impact", "Is PeerPath helping admissions?", "M3 17l6-6 4 4 8-8M14 7h7v7"],
];
const RANGE_LABELS: [RangeDays, string][] = [
  [7, "7 days"],
  [30, "30 days"],
  [90, "90 days"],
];
const CAMPUS_KEYS: ImpactKey[] = ["All", "Pune", "Gurugram"];

/** Keeps the view and the filters that are worth sharing in the address bar (without reloading). */
function syncUrl(view: AdminTab, f: DashFilters) {
  try {
    const u = new URL(window.location.href);
    const set = (k: string, v: string | null) => (v === null ? u.searchParams.delete(k) : u.searchParams.set(k, v));
    set("tab", view === "overview" ? null : view);
    set("days", f.range === 30 ? null : String(f.range));
    set("campus", f.campus === "All" ? null : f.campus);
    window.history.replaceState(window.history.state, "", u.pathname + u.search + u.hash);
  } catch {
    // address bar sync is a convenience only
  }
}

export function AdminDashboard({ data, initialView, initialFilters }: { data: DashData; initialView: AdminTab; initialFilters: Pick<DashFilters, "range" | "campus"> }) {
  const [view, setView] = useState<AdminTab>(initialView);
  const [filters, setFilters] = useState<DashFilters>({ ...DEFAULT_FILTERS, ...initialFilters });
  const [drawer, setDrawer] = useState<DrawerContent | null>(null);
  const [W, setW] = useState(640);
  const [picker, setPicker] = useState(false);
  const [pickerQ, setPickerQ] = useState("");
  const tipApi = useRef<TipApi>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fit = () => setW(window.innerWidth < 640 ? 380 : 640);
    fit();
    let t: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(fit, 150);
    };
    window.addEventListener("resize", onResize);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => syncUrl(view, filters), [view, filters]);

  useEffect(() => {
    if (!picker) return;
    const onDown = (e: MouseEvent) => !pickerRef.current?.contains(e.target as Node) && setPicker(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPicker(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [picker]);

  const seniorsById = useMemo(() => new Map(data.seniors.map((s) => [s.id, s])), [data.seniors]);
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const open = useCallback((c: DrawerContent) => setDrawer(c), []);
  const openSenior = useCallback(
    (id: string) => {
      const s = seniorsById.get(id);
      setDrawer({ title: s?.firstName ?? "Senior", sub: s ? `${s.campus} · ${s.topics.join(", ") || "no topics yet"}` : undefined, body: <SeniorPanel id={id} /> });
    },
    [seniorsById],
  );
  const ui = useMemo(() => ({ data, filters, now: data.now, range: filters.range, W, demo: data.demo, open, tipApi, seniorsById, openSenior }), [data, filters, W, open, seniorsById, openSenior]);

  // Overview badge: things someone has to do (campus and senior filters apply, any date)
  const todo = useMemo(() => {
    const scoped = scopeChats(data, { ...filters, type: "All" });
    const seniors = data.seniors.filter((s) => seniorInScope(s, filters));
    return (
      seniors.filter((s) => s.status === "pending").length +
      seniors.filter((s) => s.status === "active" && (s.hours === 0 || !s.hasMeet)).length +
      scoped.filter((c) => c.toMark).length +
      scoped.filter((c) => c.inviteFailed).length +
      scoped.filter(flaggedFeedback).length
    );
  }, [data, filters]);

  const go = (v: AdminTab) => {
    setView(v);
    setDrawer(null);
    window.scrollTo({ top: 0 });
  };
  const patch = (p: Partial<DashFilters>) => setFilters((f) => ({ ...f, ...p }));
  const setCampus = (campus: ImpactKey) => setFilters((f) => ({ ...f, campus, seniors: f.seniors.filter((id) => campus === "All" || seniorsById.get(id)?.campus === campus) }));
  const toggleSenior = (id: string) => setFilters((f) => ({ ...f, seniors: f.seniors.includes(id) ? f.seniors.filter((x) => x !== id) : [...f.seniors, id] }));
  const dirty = filters.range !== 30 || filters.campus !== "All" || filters.seniors.length > 0 || filters.type !== "All";
  const campusCount = (c: ImpactKey) => data.seniors.filter((s) => c === "All" || s.campus === c).length;
  const pickable = data.seniors.filter((s) => (filters.campus === "All" || s.campus === filters.campus) && s.firstName.toLowerCase().includes(pickerQ.trim().toLowerCase()));
  const [, title, sub] = VIEWS.find((v) => v[0] === view) ?? VIEWS[0];

  return (
    <UiContext.Provider value={ui}>
      <div className="ppd">
        <nav className="ppd-side" aria-label="Dashboard sections">
          <div className="ppd-brand">
            <div className="ppd-brand-mark">P</div>
            <div>
              <b>PeerPath</b>
              <small>Talk to a Senior · admin</small>
            </div>
          </div>
          {VIEWS.map(([id, label, , icon]) => (
            <button key={id} type="button" className="ppd-nav" aria-current={view === id ? "page" : undefined} onClick={() => go(id)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={icon} />
              </svg>
              {label}
              {id === "overview" && todo > 0 && (
                <span className="ppd-badge num" aria-label={`${todo} to do`}>
                  {todo}
                </span>
              )}
            </button>
          ))}
          <div className="ppd-side-foot">
            <Link href={ttsPath.home}>Applicant view</Link>
            <Link href={ttsPath.join} className="primary">
              Add a senior
            </Link>
          </div>
        </nav>

        <div className="ppd-main">
          <header className="ppd-top">
            <div className="ppd-title">
              <h1>{title}</h1>
              <p>{sub}</p>
              {data.demo ? <span className="ppd-tag">Sample data · not real</span> : data.capped ? <span className="ppd-tag">Based on the latest 2,000 chats</span> : null}
            </div>
            <div className="ppd-filters">
              <span className="ppd-flabel">Range</span>
              <div className="ppd-seg" role="group" aria-label="Date range">
                {RANGE_LABELS.map(([v, l]) => (
                  <button key={v} type="button" aria-pressed={filters.range === v} onClick={() => patch({ range: v })}>
                    {l}
                  </button>
                ))}
              </div>
              <span className="ppd-flabel">Campus</span>
              <div className="ppd-seg" role="group" aria-label="Campus">
                {CAMPUS_KEYS.map((c) => (
                  <button key={c} type="button" aria-pressed={filters.campus === c} onClick={() => setCampus(c)}>
                    {c}
                    <small>{campusCount(c)}</small>
                  </button>
                ))}
              </div>
              <div className="ppd-picker" ref={pickerRef}>
                <button type="button" aria-expanded={picker} aria-haspopup="true" onClick={() => setPicker((p) => !p)}>
                  {filters.seniors.length ? `${filters.seniors.length} senior${filters.seniors.length > 1 ? "s" : ""}` : "All seniors"} ▾
                </button>
                {picker && (
                  <div className="ppd-pop">
                    <input type="search" placeholder="Find a senior" value={pickerQ} onChange={(e) => setPickerQ(e.target.value)} aria-label="Find a senior" autoFocus />
                    <div style={{ maxHeight: 240, overflow: "auto", marginTop: 6 }}>
                      {pickable.map((s) => (
                        <label key={s.id}>
                          <input type="checkbox" checked={filters.seniors.includes(s.id)} onChange={() => toggleSenior(s.id)} />
                          {s.firstName}
                          <small>{s.campus}</small>
                        </label>
                      ))}
                      {pickable.length === 0 && (
                        <p className="ppd-hint" style={{ padding: 8 }}>
                          No match.
                        </p>
                      )}
                    </div>
                    {filters.seniors.length > 0 && (
                      <button type="button" className="ppd-link" onClick={() => patch({ seniors: [] })}>
                        Clear seniors
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="ppd-seg" role="group" aria-label="Session type">
                {(["All", "1:1", "Group"] as const).map((t) => (
                  <button key={t} type="button" aria-pressed={filters.type === t} onClick={() => patch({ type: t })}>
                    {t === "All" ? "All types" : t}
                  </button>
                ))}
              </div>
              {dirty && (
                <button type="button" className="ppd-link" onClick={() => setFilters(DEFAULT_FILTERS)}>
                  Reset filters
                </button>
              )}
            </div>
          </header>
          <div className="ppd-content" key={view}>
            {view === "overview" && <OverviewView go={go} />}
            {view === "sessions" && <SessionsView />}
            {view === "seniors" && <SeniorsView />}
            {view === "quality" && <QualityView />}
            {view === "impact" && <ImpactView />}
          </div>
        </div>

        <TipLayer ref={tipApi} />
        <Drawer content={drawer} onClose={closeDrawer} />
      </div>
    </UiContext.Provider>
  );
}
