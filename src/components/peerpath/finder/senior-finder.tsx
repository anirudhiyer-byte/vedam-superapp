"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ADMISSIONS_URL, CAMPUS_INFO, CAMPUSES, TOPICS, ttsPath, type Campus } from "@/lib/peerpath/constants";
import type { SeniorWithSlots } from "@/lib/peerpath/types";
import { EmptyState } from "@/components/peerpath/ui";
import { IconCheck, IconClose, IconFilter } from "@/components/peerpath/icons";
import { FilterPanel } from "./filter-panel";
import { applyFilters, EMPTY_FILTERS, moreCount, type CampusChoice, type Filters } from "./filters";
import { SeniorCard } from "./senior-card";

function CampusCard({ campus, on, onClick }: { campus: Campus; on: boolean; onClick: () => void }) {
  const info = CAMPUS_INFO[campus];
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`group relative flex h-28 overflow-hidden rounded-2xl text-left ring-offset-2 transition sm:h-40 lg:h-44 ${
        on ? "ring-[3px] ring-pp-violet-500" : "ring-1 ring-pp-line hover:ring-pp-violet-200"
      }`}
    >
      <img src={info.image} alt="" className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
      <span className="absolute inset-0 bg-gradient-to-t from-[#0C0931]/85 via-[#0C0931]/30 to-transparent" />
      <span className="relative mt-auto flex w-full items-end justify-between gap-2 p-3 sm:p-4">
        <span className="flex flex-col">
          <span className="text-[16px] font-semibold text-white sm:text-[18px]">{campus}</span>
          <span className="hidden text-[12px] text-white/85 sm:block">{info.university}</span>
        </span>
        <span
          aria-hidden
          className={`grid h-7 w-7 flex-none place-items-center rounded-full border-2 ${on ? "border-white bg-pp-violet-500 text-white" : "border-white/80 bg-white/10"}`}
        >
          {on && <IconCheck className="h-4 w-4" />}
        </span>
      </span>
    </button>
  );
}

export function SeniorFinder({ seniors, connected }: { seniors: SeniorWithSlots[]; connected: boolean }) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [drawer, setDrawer] = useState(false);

  const results = useMemo(() => applyFilters(seniors, filters), [seniors, filters]);
  const languagesInUse = useMemo(() => [...new Set(seniors.flatMap((s) => s.languages))], [seniors]);
  const statesInUse = useMemo(() => [...new Set(seniors.map((s) => s.homeState).filter(Boolean) as string[])], [seniors]);
  const more = moreCount(filters);
  const anyFilter = more > 0 || filters.topics.length > 0 || filters.campus !== "Both";

  useEffect(() => {
    document.body.style.overflow = drawer ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawer]);

  const pickCampus = (c: CampusChoice) => setFilters((f) => ({ ...f, campus: f.campus === c ? "Both" : c }));
  const toggleTopic = (t: (typeof TOPICS)[number]) =>
    setFilters((f) => ({ ...f, topics: f.topics.includes(t) ? f.topics.filter((x) => x !== t) : [...f.topics, t] }));

  return (
    <>
      {/* Hero + campus choice */}
      <section className="border-b border-pp-line bg-pp-card">
        <div className="mx-auto grid max-w-[1240px] gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[1fr_1.15fr] lg:items-center lg:gap-12 lg:py-12">
          <div className="flex flex-col gap-4">
            <p className="inline-flex items-center gap-2 self-start rounded-full bg-pp-cream px-3 py-1.5 text-[13px] font-semibold text-pp-orange-700">
              <span aria-hidden className="h-2 w-2 rounded-full bg-pp-orange-500" />
              Free · 30-min video chat
            </p>
            <h1 className="text-[32px] font-bold leading-[1.1] tracking-[-0.02em] text-pp-heading sm:text-[44px]">
              Talk to a <span className="text-pp-violet-500">Vedam senior</span>
            </h1>
            <p className="max-w-[46ch] text-[16px] leading-relaxed text-pp-muted sm:text-[18px]">
              Ask a current student anything about VSAT, the interview, classes or campus life. Pick a senior, pick a time, and join on Google Meet.
            </p>
            <ol className="mt-1 grid gap-2 text-[14px] text-pp-ink sm:grid-cols-3 sm:gap-3">
              {["Choose a campus", "Pick a senior & time", "Join on Google Meet"].map((s, i) => (
                <li key={s} className="flex items-center gap-2.5">
                  <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-pp-violet-50 text-[13px] font-bold text-pp-violet-700">{i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-[14px] font-semibold text-pp-heading">Which campus are you curious about?</p>
            <div className="grid grid-cols-2 gap-3">
              {CAMPUSES.map((c) => (
                <CampusCard key={c} campus={c} on={filters.campus === c} onClick={() => pickCampus(c)} />
              ))}
            </div>
            <button
              type="button"
              aria-pressed={filters.campus === "Both"}
              onClick={() => setFilters((f) => ({ ...f, campus: "Both" }))}
              className={`pp-chip justify-center gap-2 ${filters.campus === "Both" ? "border-pp-violet-500 bg-pp-violet-50 font-semibold text-pp-violet-700" : ""}`}
            >
              {filters.campus === "Both" && <IconCheck className="h-4 w-4" />}
              Both campuses
            </button>
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-[1240px] grid-cols-[minmax(0,1fr)] gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[300px_minmax(0,1fr)] lg:py-10">
        {/* Desktop sidebar */}
        <aside className="hidden lg:block">
          <div className="pp-card sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[16px] font-semibold text-pp-heading">Filters</h2>
              {anyFilter && (
                <button type="button" className="text-[13px] font-semibold text-pp-violet-600 hover:text-pp-violet-700" onClick={() => setFilters(EMPTY_FILTERS)}>
                  Clear all
                </button>
              )}
            </div>
            <FilterPanel value={filters} onChange={setFilters} languagesInUse={languagesInUse} statesInUse={statesInUse} />
          </div>
        </aside>

        <main className="flex min-w-0 flex-col gap-5">
          {/* Mobile / tablet: topic chips + More filters */}
          <div className="flex flex-col gap-3 lg:hidden">
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6">
              {TOPICS.map((t) => (
                <button key={t} type="button" aria-pressed={filters.topics.includes(t)} onClick={() => toggleTopic(t)} className={`pp-chip flex-none ${filters.topics.includes(t) ? "pp-chip-on" : ""}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-[15px] text-pp-muted" aria-live="polite">
              <b className="font-semibold text-pp-heading">{results.length}</b> {results.length === 1 ? "senior" : "seniors"}
              {filters.campus !== "Both" ? ` at ${filters.campus}` : ""}
            </p>
            <button type="button" onClick={() => setDrawer(true)} className="pp-btn-secondary lg:hidden">
              <IconFilter /> More filters
              {more > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-pp-violet-500 px-1.5 text-[12px] text-white">{more}</span>}
            </button>
          </div>

          {seniors.length === 0 ? (
            <EmptyState
              title="Seniors are getting ready"
              body={
                connected
                  ? "No senior has opened their times yet. Please check again soon."
                  : "We could not load seniors just now. Please refresh the page."
              }
            >
              <a href={ADMISSIONS_URL} target="_blank" rel="noreferrer" className="pp-btn-secondary mt-2">
                Contact admissions instead
              </a>
            </EmptyState>
          ) : results.length === 0 ? (
            <EmptyState title="No senior matches these filters" body="Try removing a filter or choosing another day.">
              <button type="button" className="pp-btn-secondary mt-2" onClick={() => setFilters(EMPTY_FILTERS)}>
                Clear all filters
              </button>
            </EmptyState>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
              {results.map((r) => (
                <SeniorCard key={r.senior.id} senior={r.senior} slots={r.slots} />
              ))}
            </div>
          )}

          <p className="text-[14px] text-pp-muted">
            Fees, scholarships or your admission status?{" "}
            <a href={ADMISSIONS_URL} target="_blank" rel="noreferrer" className="font-semibold text-pp-violet-600 underline underline-offset-2">
              Ask the admissions team
            </a>
            <span className="mx-2 text-pp-line">|</span>
            Current Vedam student?{" "}
            <Link href={ttsPath.join} className="font-semibold text-pp-violet-600 underline underline-offset-2">
              Become a senior
            </Link>
          </p>
        </main>
      </div>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-labelledby="filters-title">
          <button type="button" aria-label="Close filters" className="absolute inset-0 bg-[#0C0931]/50" onClick={() => setDrawer(false)} />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[88vh] flex-col rounded-t-3xl bg-pp-card">
            <div className="flex items-center justify-between border-b border-pp-line px-5 py-4">
              <h2 id="filters-title" className="text-[17px] font-semibold text-pp-heading">
                More filters
              </h2>
              <button type="button" aria-label="Close" onClick={() => setDrawer(false)} className="grid h-11 w-11 place-items-center rounded-full hover:bg-pp-violet-50">
                <IconClose />
              </button>
            </div>
            <div className="overflow-y-auto px-5 py-5">
              <FilterPanel value={filters} onChange={setFilters} showTopics={false} languagesInUse={languagesInUse} statesInUse={statesInUse} />
            </div>
            <div className="flex gap-3 border-t border-pp-line px-5 py-4">
              <button type="button" className="pp-btn-secondary flex-1" onClick={() => setFilters({ ...EMPTY_FILTERS, campus: filters.campus, topics: filters.topics })}>
                Clear
              </button>
              <button type="button" className="pp-btn-primary flex-[2]" onClick={() => setDrawer(false)}>
                Show {results.length} {results.length === 1 ? "senior" : "seniors"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
