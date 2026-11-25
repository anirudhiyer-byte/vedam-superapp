"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type Ref } from "react";
import { chatStatus, dayNum, monShort, tIST, type DashChat, type DashData, type DashFilters, type DashSenior, type StatusTone } from "@/lib/peerpath/admin-dashboard";
import { ttsPath } from "@/lib/peerpath/constants";

/* ---------- tooltip ---------- */

export type TipApi = { show: (content: ReactNode, x: number, y: number, more: boolean) => void; move: (x: number, y: number) => void; hide: () => void };

/** One floating tooltip for the whole dashboard. Position is set on the element directly, so moving the mouse never re-renders. */
export function TipLayer({ ref }: { ref: Ref<TipApi> }) {
  const el = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState<{ body: ReactNode; more: boolean } | null>(null);
  const place = useCallback((x: number, y: number) => {
    const t = el.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    let nx = x + 14;
    let ny = y - r.height - 12;
    if (nx + r.width > window.innerWidth - 8) nx = x - r.width - 14;
    if (ny < 8) ny = y + 18;
    t.style.transform = `translate(${Math.max(8, nx)}px, ${ny}px)`;
  }, []);
  const pos = useRef<[number, number]>([0, 0]);
  useImperativeHandle(ref, () => ({
    show: (body, x, y, more) => {
      pos.current = [x, y];
      setContent({ body, more });
    },
    move: (x, y) => {
      pos.current = [x, y];
      place(x, y);
    },
    hide: () => setContent(null),
  }));
  useEffect(() => {
    if (content) place(...pos.current);
  }, [content, place]);
  return (
    <div ref={el} role="tooltip" className={`ppd-tip ${content ? "on" : ""}`}>
      {content?.body}
      {content?.more && <div className="go">Click to open →</div>}
    </div>
  );
}

/* ---------- drawer ---------- */

export type DrawerContent = { title: string; sub?: string; body: ReactNode };

export function Drawer({ content, onClose }: { content: DrawerContent | null; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  const last = useRef<Element | null>(null);
  const open = content !== null;
  // keep the last content while the drawer slides out
  const [shown, setShown] = useState<DrawerContent | null>(content);
  useEffect(() => {
    if (content) setShown(content);
  }, [content]);
  useEffect(() => {
    if (!open) return;
    last.current = document.activeElement;
    close.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      (last.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);
  return (
    <>
      <div className={`ppd-backdrop ${open ? "on" : ""}`} onClick={onClose} aria-hidden />
      <aside className={`ppd-drawer ${open ? "on" : ""}`} role="dialog" aria-modal="true" aria-labelledby="ppd-dtitle" aria-hidden={!open}>
        <div className="ppd-dhead">
          <div>
            <h3 id="ppd-dtitle">{shown?.title}</h3>
            {shown?.sub && <p>{shown.sub}</p>}
          </div>
          <button ref={close} type="button" className="ppd-dclose" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="ppd-dbody">{shown?.body}</div>
      </aside>
    </>
  );
}

/* ---------- context: tooltips, click-through, drawer ---------- */

type Ui = {
  data: DashData;
  filters: DashFilters;
  now: number;
  range: number;
  /** chart width in viewBox units: narrower on phones so labels stay readable */
  W: number;
  demo: boolean;
  open: (c: DrawerContent) => void;
  tipApi: React.RefObject<TipApi | null>;
  seniorsById: Map<string, DashSenior>;
  openSenior: (id: string) => void;
};
export const UiContext = createContext<Ui | null>(null);
export function useUi(): Ui {
  const ui = useContext(UiContext);
  if (!ui) throw new Error("useUi outside the dashboard");
  return ui;
}

type Hit = {
  onPointerEnter?: (e: PointerEvent) => void;
  onPointerMove?: (e: PointerEvent) => void;
  onPointerLeave?: () => void;
  onFocus?: (e: React.FocusEvent) => void;
  onBlur?: () => void;
  onClick?: () => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  role?: "button";
  tabIndex?: number;
  "data-drill"?: "";
};

/** Props for anything with a tooltip and/or a click-through. Keyboard: Tab to it, Enter or Space to open. */
export function useHit() {
  const { tipApi } = useUi();
  return useCallback(
    (tip: ReactNode | null, onClick?: () => void): Hit => {
      const p: Hit = {};
      if (tip !== null) {
        p.onPointerEnter = (e) => tipApi.current?.show(tip, e.clientX, e.clientY, !!onClick);
        p.onPointerMove = (e) => tipApi.current?.move(e.clientX, e.clientY);
        p.onPointerLeave = () => tipApi.current?.hide();
        p.onFocus = (e) => {
          const r = (e.currentTarget as Element).getBoundingClientRect();
          tipApi.current?.show(tip, r.left + r.width / 2, r.top, !!onClick);
        };
        p.onBlur = () => tipApi.current?.hide();
      }
      if (onClick) {
        p.role = "button";
        p.tabIndex = 0;
        p["data-drill"] = "";
        p.onClick = () => {
          tipApi.current?.hide();
          onClick();
        };
        p.onKeyDown = (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            tipApi.current?.hide();
            onClick();
          }
        };
      }
      return p;
    },
    [tipApi],
  );
}

/* ---------- small pieces ---------- */

export function Pill({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return <span className={`ppd-pill ${tone}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="ppd-empty">{children}</div>;
}

export function DStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="ppd-dstat">
      <small>{label}</small>
      <b className="num">{value}</b>
    </div>
  );
}

export function DateBadge({ t }: { t: number }) {
  return (
    <div className="ppd-date">
      <b>{dayNum(t)}</b>
      <small>{monShort(t)}</small>
    </div>
  );
}

/** One chat in a drawer list. Opens the chat's own page, which shows the applicant's details to admins. */
export function ChatItem({ c, showSenior = true }: { c: DashChat; showSenior?: boolean }) {
  const { now, seniorsById, demo } = useUi();
  const s = seniorsById.get(c.seniorId);
  const st = chatStatus(c, now);
  const body = (
    <>
      <DateBadge t={c.start} />
      <div className="m">
        <b>{showSenior ? `${s?.firstName ?? "Senior"} · ${s?.campus ?? ""}` : `Chat #${c.ref}`}</b>
        <small>
          {showSenior ? `#${c.ref} · ` : ""}
          {c.type}
          {c.minutes !== null ? ` · ${c.minutes} min together` : ""}
          {c.rating !== null ? ` · ${c.rating}★` : ""}
          {c.promise ? " · promise reported" : ""}
        </small>
      </div>
      <div className="when">
        {tIST(c.start)}
        <Pill tone={st.tone}>{st.label}</Pill>
      </div>
    </>
  );
  if (demo) return <div className="ppd-ditem">{body}</div>;
  return (
    <Link className="ppd-ditem" href={ttsPath.booked(c.id)} title="Open this chat (applicant details)">
      {body}
    </Link>
  );
}

export const LIST_MAX = 80;

/** Drawer body for a list of chats: three numbers, then the latest chats. */
export function ChatListBody({ list, showSenior = true }: { list: DashChat[]; showSenior?: boolean }) {
  const { now, demo } = useUi();
  const sorted = [...list].sort((a, b) => b.start - a.start);
  const done = sorted.filter((c) => c.status === "completed" || (c.status === "confirmed" && c.end < now)).length;
  const rated = sorted.filter((c) => c.rating !== null);
  const avg = rated.length ? (rated.reduce((a, c) => a + (c.rating ?? 0), 0) / rated.length).toFixed(1) : "–";
  return (
    <>
      <div className="ppd-dstats">
        <DStat label="Chats" value={sorted.length} />
        <DStat label="Done" value={done} />
        <DStat label="Avg rating" value={avg} />
      </div>
      {sorted.length ? (
        <div className="ppd-dlist">
          {sorted.slice(0, LIST_MAX).map((c) => (
            <ChatItem key={c.id} c={c} showSenior={showSenior} />
          ))}
        </div>
      ) : (
        <Empty>No chats here.</Empty>
      )}
      {sorted.length > LIST_MAX && <p className="ppd-hint">Showing the latest {LIST_MAX}.</p>}
      {!demo && sorted.length > 0 && <p className="ppd-hint">Click a chat to open it. Applicant details are only on the chat&apos;s own page.</p>}
    </>
  );
}

export function useChatDrawer() {
  const { open } = useUi();
  return useCallback((list: DashChat[], title: string, sub?: string) => open({ title, sub, body: <ChatListBody list={list} /> }), [open]);
}
