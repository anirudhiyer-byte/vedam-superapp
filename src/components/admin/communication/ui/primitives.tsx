"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useDialog } from "./use-dialog";
import { clipBox, opensUp } from "./menu-placement";

/* ══════════════════════════════════════════════════════
   ICONS — inline SVG, no dependency (repo has no icon lib)
   ══════════════════════════════════════════════════════ */
export type IconName =
  | "search" | "filter" | "download" | "plus" | "gear" | "trash" | "refresh"
  | "chevronDown" | "chevronLeft" | "chevronRight" | "dots" | "close" | "check"
  | "mail" | "whatsapp" | "sms" | "amplify" | "tag" | "info" | "calendar"
  | "sortAsc" | "sortDesc" | "sort" | "users" | "upload" | "flow" | "pencil"
  | "userSwap" | "segment" | "chart" | "send" | "inbox" | "alert"
  | "grid" | "clock" | "trend" | "doc" | "phone" | "copy" | "folder" | "shield"
  | "dotsV" | "monitor" | "smartphone" | "code" | "link" | "eye" | "image";

const P: Record<IconName, string> = {
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  filter: "M22 3H2l8 9.5V19l4 2v-8.5z",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  plus: "M12 5v14M5 12h14",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  trash: "M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6",
  refresh: "M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15",
  chevronDown: "M6 9l6 6 6-6",
  chevronLeft: "M15 18l-6-6 6-6",
  chevronRight: "M9 18l6-6-6-6",
  dots: "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  close: "M18 6L6 18M6 6l12 12",
  check: "M20 6L9 17l-5-5",
  mail: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6",
  whatsapp: "M12 2a10 10 0 0 0-8.5 15.3L2 22l4.9-1.4A10 10 0 1 0 12 2zM8.5 7.5c.2 0 .5 0 .7.5l.7 1.6c.1.2 0 .4-.1.6l-.5.6c-.2.2-.2.4-.1.6a6 6 0 0 0 2.8 2.7c.2.1.5.1.6-.1l.6-.7c.2-.2.4-.2.6-.1l1.6.8c.3.1.4.3.4.5 0 .8-1.2 1.6-1.9 1.6a7 7 0 0 1-6.3-6.3c0-.7.8-1.9 1.6-1.9z",
  sms: "M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-4.2-1L3 20l1.2-4.6a8.4 8.4 0 0 1-1-4A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z",
  amplify: "M3 11v2a1 1 0 0 0 1 1h1l3 4V6L5 10H4a1 1 0 0 0-1 1zM8 6l11-4v20L8 18M18 9a3 3 0 0 1 0 6",
  tag: "M20.6 13.4L12 22l-9-9V3h10zM7.5 7.5h.01",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01",
  calendar: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
  sortAsc: "M12 19V5M5 12l7-7 7 7",
  sortDesc: "M12 5v14M19 12l-7 7-7-7",
  sort: "M8 9l4-4 4 4M16 15l-4 4-4-4",
  users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
  flow: "M4 4h6v6H4zM14 14h6v6h-6zM10 7h4a3 3 0 0 1 3 3v4",
  pencil: "M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z",
  userSwap: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 11l-3-3m3 3l-3 3m3-3h-6",
  segment: "M12 2v10l8.5 5A10 10 0 1 0 12 2z",
  chart: "M3 3v18h18M7 14l3-3 3 3 5-6",
  send: "M22 2 11 13M22 2l-7 20-4-9-9-4z",
  inbox: "M22 12h-6l-2 3h-4l-2-3H2M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z",
  alert: "M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
  trend: "M23 6l-9.5 9.5-5-5L1 18M17 6h6v6",
  doc: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h6",
  phone: "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.8a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.8 2.1z",
  copy: "M20 9H11a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
  folder: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  dotsV: "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM12 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM12 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  monitor: "M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 21h8M12 17v4",
  smartphone: "M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM12 18h.01",
  code: "M16 18l6-6-6-6M8 6l-6 6 6 6",
  link: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
  eye: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  image: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21",
};

export function Icon({ name, className = "h-4 w-4" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={P[name]} />
    </svg>
  );
}

/* ══════════════════════════════════════════════════════
   BUTTONS
   ══════════════════════════════════════════════════════ */
type BtnProps = {
  variant?: "solid" | "outline" | "ghost" | "danger";
  size?: "sm" | "md";
  icon?: IconName;
  iconRight?: IconName;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
  children?: ReactNode;
  /** v2: 44px tap target on phones + visible keyboard focus ring. Off by default, so existing screens are unchanged. */
  touch?: boolean;
  /** v2: submit buttons inside a <form>. */
  type?: "button" | "submit";
  className?: string;
  /** v2: for buttons that open a menu — adds aria-haspopup / aria-expanded. */
  popup?: boolean;
  expanded?: boolean;
};
/** v2: keyboard focus ring for opt-in (`touch`) controls. */
export const FOCUS_RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-soft";
const TOUCH_BTN = "min-h-[44px] justify-center sm:min-h-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-soft";
export function Button({ variant = "outline", size = "md", icon, iconRight, active, disabled, title, onClick, children, touch, type = "button", className = "", popup, expanded }: BtnProps) {
  const sizing = size === "sm" ? "px-2.5 py-1.5 text-[13px]" : "px-3 py-2 text-sm";
  const styles = {
    solid: "bg-brand-gradient text-white hover:opacity-90",
    outline: `border ${active ? "border-accent text-accent" : "border-border text-foreground"} hover:bg-surface-warm`,
    ghost: "text-muted hover:bg-surface-warm hover:text-foreground",
    danger: "border border-[#7f2323] text-[#f87171] hover:bg-[#3d1414]",
  }[variant];
  return (
    <button type={type} title={title} disabled={disabled} onClick={onClick}
      aria-haspopup={popup ? "menu" : undefined} aria-expanded={popup ? !!expanded : undefined}
      className={`inline-flex items-center gap-1.5 rounded-lg font-body font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${sizing} ${styles} ${touch ? TOUCH_BTN : ""} ${className}`}>
      {icon && <Icon name={icon} className="h-3.5 w-3.5 shrink-0" />}
      {children}
      {iconRight && <Icon name={iconRight} className="h-3.5 w-3.5 shrink-0" />}
    </button>
  );
}

/** Square icon-only button (the funnel / refresh / gear affordances). */
export function IconButton({ icon, label, active, onClick, touch, expanded, controls }: {
  icon: IconName; label: string; active?: boolean; onClick?: () => void; touch?: boolean;
  /** v2: for a button that shows or hides a panel — adds aria-expanded (+ aria-controls). */
  expanded?: boolean; controls?: string;
}) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} aria-expanded={expanded} aria-controls={controls}
      className={`grid shrink-0 place-items-center rounded-lg border transition-colors ${touch ? `h-11 w-11 sm:h-9 sm:w-9 ${FOCUS_RING}` : "h-9 w-9"} ${
        active ? "border-accent bg-surface-warm text-accent" : "border-border text-muted hover:bg-surface-warm hover:text-foreground"}`}>
      <Icon name={icon} className="h-4 w-4" />
    </button>
  );
}

/* ══════════════════════════════════════════════════════
   SEARCH BOX — debounced, with clear
   ══════════════════════════════════════════════════════ */
export function SearchBox({ placeholder = "Search by", value, onChange, delay = 300, touch }: {
  placeholder?: string; value: string; onChange: (v: string) => void; delay?: number;
  /** v2: full-width 44px field on phones, labelled input, clear button with a 44px hit area. */
  touch?: boolean;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  useEffect(() => {
    if (local === value) return;
    const t = setTimeout(() => onChange(local), delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);
  return (
    <div className={`flex items-center gap-2 rounded-lg border border-border bg-surface px-3 ${touch ? "h-11 w-full focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft/50 sm:h-9 sm:w-auto" : "h-9"}`}>
      <input value={local} onChange={(e) => setLocal(e.target.value)} placeholder={placeholder} aria-label={touch ? placeholder : undefined}
        className={`bg-transparent font-body text-sm text-foreground outline-none placeholder:text-muted ${touch ? "min-w-0 flex-1 sm:w-52 sm:flex-none" : "w-36 sm:w-52"}`} />
      {local ? (
        <button type="button" onClick={() => setLocal("")} aria-label="Clear search"
          className={`text-muted hover:text-foreground ${touch ? `-mr-2 grid h-11 w-11 place-items-center rounded-lg sm:h-6 sm:w-6 ${FOCUS_RING}` : ""}`}>
          <Icon name="close" className="h-3.5 w-3.5" />
        </button>
      ) : (
        <Icon name="search" className="h-4 w-4 shrink-0 text-muted" />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   DROPDOWN MENU — used by "Action" and the row gear
   ══════════════════════════════════════════════════════ */
export type MenuItem = {
  label: string;
  icon?: IconName;
  danger?: boolean;
  disabled?: boolean;
  /** v2: a small heading shown above this item whenever the group changes (touch menus only). */
  group?: string;
  /** v2: a second, muted line under the label (touch menus only). */
  hint?: string;
  onClick: () => void;
};

export function Menu({ items, align = "right", trigger, touch, flip }: {
  items: MenuItem[]; align?: "left" | "right"; trigger: (open: boolean, toggle: () => void) => ReactNode;
  /** v2: menu semantics + arrow keys, focus returns to the trigger, 44px items on phones. */
  touch?: boolean;
  /** opens upward when it would be cut off at the bottom of a scrolling table (Manage List rows) */
  flip?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!flip) return;   // every other menu: unchanged
    if (!open || !ref.current || !menuRef.current) { setUp(false); return; }
    const r = ref.current.getBoundingClientRect();
    setUp(opensUp({ top: r.top, bottom: r.bottom }, clipBox(ref.current), menuRef.current.offsetHeight));
  }, [open, flip]);
  const triggerEl = () => ref.current?.querySelector<HTMLElement>("button");
  const menuItems = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); if (touch) triggerEl()?.focus(); } };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    if (touch) menuItems()[0]?.focus();
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (!touch) return;
    const els = menuItems();
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); els[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); els[els.length - 1]?.focus(); }
    else if (e.key === "Tab") setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      {trigger(open, () => setOpen((v) => !v))}
      {open && (
        <div ref={menuRef} role={touch ? "menu" : undefined} onKeyDown={onMenuKey} data-menu-up={flip ? String(up) : undefined}
          className={`absolute z-40 ${up ? "bottom-full mb-1.5" : "mt-1.5"} min-w-[13rem] overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-2xl ${align === "right" ? "right-0" : "left-0"}`}>
          {items.map((it, i) => (
            <Fragment key={it.label}>
              {touch && it.group && it.group !== items[i - 1]?.group && (
                <div role="presentation" className={`px-4 pb-1 pt-2.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted ${i > 0 ? "mt-1 border-t border-border" : ""}`}>{it.group}</div>
              )}
              <button disabled={it.disabled} role={touch ? "menuitem" : undefined}
                onClick={() => { setOpen(false); if (touch) triggerEl()?.focus(); it.onClick(); }}
                className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left font-body text-sm transition-colors disabled:opacity-40 ${touch ? `min-h-[44px] sm:min-h-0 focus-visible:bg-surface-warm focus-visible:outline-none` : ""} ${
                  it.danger ? "text-[#f87171] hover:bg-[#3d1414]" : "text-foreground hover:bg-surface-warm"}`}>
                {it.icon && <Icon name={it.icon} className="h-3.5 w-3.5 shrink-0 opacity-70" />}
                {touch && it.hint ? (
                  <span className="min-w-0">
                    {it.label}
                    <span className="block text-xs font-normal text-muted">{it.hint}</span>
                  </span>
                ) : it.label}
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   DRAWER — right slide-over (Filter By)
   ══════════════════════════════════════════════════════ */
export function Drawer({ open, title, onClose, footer, children, accessible, size = "sm", closeLabel }: {
  open: boolean; title: string; onClose: () => void; footer?: ReactNode; children: ReactNode;
  /** v2: dialog semantics, focus moves in / stays in / returns, Escape closes, 44px close button, full-height on phones. */
  accessible?: boolean;
  /** v2: "lg" is a wider panel (480px) for forms with tabs. Always full-screen on phones. */
  size?: "sm" | "lg";
  closeLabel?: string;
}) {
  const panel = useDialog<HTMLDivElement>(open, onClose, !!accessible);
  useEffect(() => {
    if (accessible) return; // useDialog handles Escape
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open, onClose, accessible]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <button aria-label="Close" tabIndex={accessible ? -1 : undefined} onClick={onClose} className="absolute inset-0 bg-black/55 backdrop-blur-[1px]" />
      <div ref={panel} role={accessible ? "dialog" : undefined} aria-modal={accessible || undefined} aria-label={accessible ? title : undefined} tabIndex={accessible ? -1 : undefined}
        className={`absolute right-0 top-0 flex w-full flex-col bg-surface shadow-2xl outline-none ${accessible ? "h-[100dvh]" : "h-full"} ${size === "lg" ? "max-w-[480px]" : "max-w-[380px]"}`}>
        <div className="flex items-center justify-between border-b-2 border-accent px-5 py-4">
          {accessible
            ? <h2 className="font-display text-lg font-extrabold text-heading">{title}</h2>
            : <h3 className="font-display text-lg font-extrabold text-heading">{title}</h3>}
          <button type="button" onClick={onClose} aria-label={closeLabel ?? (accessible ? `Close ${title}` : "Close filter")}
            className={`grid place-items-center rounded-lg text-muted hover:bg-surface-warm hover:text-foreground ${accessible ? `h-11 w-11 sm:h-8 sm:w-8 ${FOCUS_RING}` : "h-8 w-8"}`}>
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-5">{children}</div>
        {footer && <div className={`flex items-center justify-between border-t border-border px-5 py-4 ${accessible ? "gap-2 pb-[max(1rem,env(safe-area-inset-bottom))]" : ""}`}>{footer}</div>}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   FORM FIELDS
   ══════════════════════════════════════════════════════ */
const fieldCls = "w-full rounded-lg border border-border bg-background px-3 py-2.5 font-body text-sm text-foreground outline-none transition-colors focus:border-accent";

/** v2 extras for form fields: ids for <label htmlFor>, aria wiring, error styling, 44px phone height + focus ring. */
export type FieldA11y = { id?: string; invalid?: boolean; describedBy?: string; touch?: boolean; ariaLabel?: string };
const fieldExtra = ({ invalid, touch }: FieldA11y) =>
  `${touch ? "min-h-[44px] sm:min-h-0 focus-visible:ring-2 focus-visible:ring-accent-soft/60 disabled:cursor-not-allowed disabled:opacity-60" : ""} ${invalid ? "!border-[#f87171]" : ""}`;

export function Select({ placeholder, options, value, onChange, disabled, ...a11y }: {
  placeholder: string; options: { value: string; label: string }[]; value: string; onChange: (v: string) => void; disabled?: boolean;
} & FieldA11y) {
  return (
    <div className="relative">
      <select id={a11y.id} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)}
        aria-label={a11y.ariaLabel} aria-invalid={a11y.invalid || undefined} aria-describedby={a11y.describedBy}
        className={`${fieldCls} appearance-none pr-9 ${value ? "" : "text-muted"} ${fieldExtra(a11y)}`}>
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <Icon name="chevronDown" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
    </div>
  );
}

export function DateRange({ placeholder, value, onChange }: { placeholder: string; value: string; onChange: (v: string) => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="relative">
      <input type={focused || value ? "date" : "text"} value={value} placeholder={placeholder}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value)} className={`${fieldCls} pr-9`} />
      <Icon name="calendar" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
    </div>
  );
}

export function TextField({ placeholder, value, onChange, disabled, maxLength, ...a11y }: {
  placeholder: string; value: string; onChange: (v: string) => void; disabled?: boolean; maxLength?: number;
} & FieldA11y) {
  return (
    <input id={a11y.id} value={value} placeholder={placeholder} disabled={disabled} maxLength={maxLength}
      onChange={(e) => onChange(e.target.value)}
      aria-label={a11y.ariaLabel} aria-invalid={a11y.invalid || undefined} aria-describedby={a11y.describedBy}
      className={`${fieldCls} disabled:opacity-60 ${fieldExtra(a11y)}`} />
  );
}

/** v2 · multi-line text, same look as TextField. */
export function TextArea({ placeholder, value, onChange, disabled, maxLength, rows = 3, ...a11y }: {
  placeholder: string; value: string; onChange: (v: string) => void; disabled?: boolean; maxLength?: number; rows?: number;
} & FieldA11y) {
  return (
    <textarea id={a11y.id} rows={rows} value={value} placeholder={placeholder} disabled={disabled} maxLength={maxLength}
      onChange={(e) => onChange(e.target.value)}
      aria-label={a11y.ariaLabel} aria-invalid={a11y.invalid || undefined} aria-describedby={a11y.describedBy}
      className={`${fieldCls} resize-y disabled:opacity-60 ${fieldExtra(a11y)}`} />
  );
}

/* ══════════════════════════════════════════════════════
   PILLS, CHIPS, LINKS
   ══════════════════════════════════════════════════════ */
const TONE: Record<string, string> = {
  green: "bg-[#0f3d29] text-[#4ade80]",
  amber: "bg-[#3d310f] text-[#fbbf24]",
  red: "bg-[#3d1414] text-[#f87171]",
  grey: "bg-surface-warm text-muted",
  violet: "bg-[#2b135c] text-[#c4a0ff]",
};
const STATUS_TONE: Record<string, keyof typeof TONE> = {
  active: "green", completed: "green", answered: "green", enabled: "green", delivered: "green",
  "in progress": "amber", pause: "amber", scheduled: "amber", "test mode": "amber", pending: "amber",
  draft: "grey", inactive: "grey", na: "grey", closed: "grey",
  failed: "red", missed: "red", stopped: "red", bounced: "red", undelivered: "red",
};
export function StatusPill({ status, info }: { status: string; info?: boolean }) {
  const tone = TONE[STATUS_TONE[status.toLowerCase()] ?? "grey"];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide ${tone}`}>
      {status}
      {info && <Icon name="info" className="h-3 w-3 opacity-80" />}
    </span>
  );
}

/** Applied-filter chip strip shown above a table. */
export function FilterChips({ chips, onRemove, onClear, touch }: {
  chips: { key: string; label: string }[]; onRemove: (key: string) => void; onClear: () => void;
  /** v2: 44px remove / clear targets on phones + focus ring. */
  touch?: boolean;
}) {
  if (!chips.length) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted">Filters</span>
      {chips.map((c) => (
        <span key={c.key} className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-surface font-body text-xs text-foreground ${touch ? "py-0 pl-3 pr-0.5 sm:py-1 sm:pl-2.5 sm:pr-2.5" : "px-2.5 py-1"}`}>
          {c.label}
          <button type="button" onClick={() => onRemove(c.key)} aria-label={`Remove filter ${c.label}`}
            className={`text-muted hover:text-foreground ${touch ? `grid h-11 w-9 place-items-center rounded-full sm:h-5 sm:w-5 ${FOCUS_RING}` : ""}`}>
            <Icon name="close" className="h-3 w-3" />
          </button>
        </span>
      ))}
      <button type="button" onClick={onClear} className={`font-body text-xs font-semibold text-accent hover:underline ${touch ? `min-h-[44px] rounded px-2 sm:min-h-0 sm:px-0 ${FOCUS_RING}` : ""}`}>Clear all</button>
    </div>
  );
}

export function LinkText({ children, onClick, touch }: { children: ReactNode; onClick?: () => void; touch?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`font-body font-semibold text-accent hover:underline ${touch ? `inline-flex min-h-[44px] items-center rounded sm:min-h-0 ${FOCUS_RING}` : ""}`}>
      {children}
    </button>
  );
}

export const Dash = () => <span className="text-muted">—</span>;

/* ══════════════════════════════════════════════════════
   PAGE HEADER + TOOLBAR
   ══════════════════════════════════════════════════════ */
export function PageHeader({ title, count, countLabel = "Records", actions, meta, titleExtra }: {
  title: string; count?: number | null; countLabel?: string; actions?: ReactNode; meta?: ReactNode;
  /** v2: small control placed right after the title (e.g. an info tip). */
  titleExtra?: ReactNode;
}) {
  const h1 = <h1 className="font-display text-xl font-extrabold tracking-tight text-heading">{title}</h1>;
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {titleExtra ? <div className="flex items-center gap-1">{h1}{titleExtra}</div> : h1}
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        {typeof count === "number" ? (
          <p className="font-body text-sm text-muted">Total <span className="font-bold text-foreground">{count.toLocaleString("en-IN")}</span> {countLabel}</p>
        ) : <span />}
        {meta}
      </div>
    </div>
  );
}

/** "Last Refreshed On : … ⟳" */
export function RefreshStamp({ at, onRefresh, busy, touch }: { at: string; onRefresh: () => void; busy?: boolean; touch?: boolean }) {
  return (
    <div className="flex items-center gap-2 font-body text-xs text-muted">
      <span>Last refreshed on: <span className="text-foreground">{at || "—"}</span></span>
      <button type="button" onClick={onRefresh} aria-label="Refresh" title="Refresh" aria-busy={busy || undefined}
        className={`text-accent hover:text-foreground ${touch ? `grid h-11 w-11 place-items-center rounded-lg sm:h-7 sm:w-7 ${FOCUS_RING}` : "transition-transform"} ${touch ? "" : busy ? "animate-spin" : ""}`}>
        <Icon name="refresh" className={`h-3.5 w-3.5 ${touch && busy ? "animate-spin" : ""}`} />
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   TOAST — confirms that a clicked action actually fired
   ══════════════════════════════════════════════════════ */
export function useToast(opts?: { safe?: boolean }) {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2600);
    return () => clearTimeout(t);
  }, [msg]);
  const node = msg ? (
    <div role="status" aria-live="polite" className={`fixed left-1/2 z-[60] ${opts?.safe ? "pointer-events-none top-4 w-max max-w-[calc(100vw-2rem)] sm:bottom-6 sm:top-auto" : "bottom-6"} -translate-x-1/2 rounded-xl border border-border bg-surface px-4 py-2.5 font-body text-sm text-foreground shadow-2xl`}>
      {msg}
    </div>
  ) : null;
  return { toast: setMsg, toastNode: node };
}

/* ══════════════════════════════════════════════════════
   CONFIRM DIALOG — for destructive row actions
   ══════════════════════════════════════════════════════ */
export function ConfirmDialog({ open, title, body, confirmLabel = "Delete", onConfirm, onCancel, accessible, pending, error }: {
  open: boolean; title: string; body: string; confirmLabel?: string; onConfirm: () => void; onCancel: () => void;
  /** v2: renders inside <Modal> (focus trap, Escape, bottom sheet on phones, 44px buttons). */
  accessible?: boolean;
  /** v2: disables both buttons while the action runs. */
  pending?: boolean;
  /** v2: shown under the text when the action failed. */
  error?: string | null;
}) {
  if (accessible) {
    return (
      <Modal open={open} title={title} onClose={onCancel} role="alertdialog"
        footer={
          <>
            <Button variant="ghost" touch disabled={pending} onClick={onCancel}>Cancel</Button>
            <Button variant="danger" touch disabled={pending} onClick={onConfirm}>{pending ? "Please wait…" : confirmLabel}</Button>
          </>
        }>
        <p className="font-body text-sm text-muted">{body}</p>
        {error && <p role="alert" className="mt-3 flex items-start gap-1.5 font-body text-xs font-semibold text-[#f87171]"><Icon name="alert" className="mt-px h-3.5 w-3.5 shrink-0" /><span>{error}</span></p>}
      </Modal>
    );
  }
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[55] grid place-items-center p-4">
      <button aria-label="Cancel" onClick={onCancel} className="absolute inset-0 bg-black/55" />
      <div className="relative w-full max-w-sm rounded-2xl border border-border bg-surface p-6">
        <h3 className="font-display text-lg font-bold text-heading">{title}</h3>
        <p className="mt-1.5 font-body text-sm text-muted">{body}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   MODAL (v2) — centred dialog on sm+, bottom sheet on phones.
   Same border / radius / title style as ConfirmDialog.
   ══════════════════════════════════════════════════════ */
export function Modal({ open, title, onClose, footer, children, role = "dialog" }: {
  open: boolean; title: string; onClose: () => void; footer?: ReactNode; children: ReactNode; role?: "dialog" | "alertdialog";
}) {
  const panel = useDialog<HTMLDivElement>(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[55] flex items-end justify-center sm:items-center sm:p-4">
      <button aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/55" />
      <div ref={panel} role={role} aria-modal="true" aria-label={title} tabIndex={-1}
        className="relative flex max-h-[90dvh] w-full max-w-md flex-col rounded-t-2xl border border-border bg-surface outline-none sm:rounded-2xl">
        <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-5 sm:px-6">
          <h2 className="font-display text-lg font-bold text-heading">{title}</h2>
          <button type="button" onClick={onClose} aria-label={`Close ${title}`}
            className={`-mr-2 grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-warm hover:text-foreground sm:h-8 sm:w-8 ${FOCUS_RING}`}>
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-2 sm:px-6">{children}</div>
        {footer && <div className="flex flex-col-reverse gap-2 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 sm:flex-row sm:justify-end sm:px-6 sm:pb-6">{footer}</div>}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   POPOVER — anchored panel (the dashboard Filter)
   ══════════════════════════════════════════════════════ */
export function Popover({ open, onClose, title, footer, width = 420, children }: {
  open: boolean; onClose: () => void; title: string; footer?: ReactNode; width?: number; children: ReactNode;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <button aria-label="Close" onClick={onClose} className="fixed inset-0 z-40 cursor-default bg-black/30" />
      <div style={{ width }}
        className="absolute right-0 z-50 mt-2 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center justify-between px-5 pb-3 pt-4">
          <h3 className="font-display text-base font-bold text-heading">{title}</h3>
          <button onClick={onClose} aria-label="Close filter" className="grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-surface-warm hover:text-foreground">
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <div className="flex items-center gap-2 border-t border-border px-5 py-4">{footer}</div>}
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════
   MULTI SELECT — "All Selected." / "n selected"
   ══════════════════════════════════════════════════════ */
export function MultiSelect({ label, options, value, onChange, allLabel = "All Selected." }: {
  label: string; options: { value: string; label: string }[]; value: string[];
  onChange: (v: string[]) => void; allLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const all = value.length === 0 || value.length === options.length;
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options;
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  return (
    <div ref={ref}>
      <label className="mb-1.5 block font-body text-sm font-semibold text-foreground">{label}</label>
      <div className="relative">
        <button type="button" onClick={() => setOpen((o) => !o)}
          className={`flex w-full items-center justify-between rounded-lg border bg-background px-3 py-2.5 text-left font-body text-sm transition-colors ${open ? "border-accent" : "border-border"}`}>
          <span className={all ? "text-muted" : "text-foreground"}>
            {all ? allLabel : `${value.length} selected`}
          </span>
          <Icon name="chevronDown" className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <div className="absolute left-0 right-0 z-10 mt-1 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
            <div className="border-b border-border p-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${label.toLowerCase()}`}
                className="w-full rounded-lg bg-background px-3 py-2 font-body text-sm text-foreground outline-none placeholder:text-muted" />
            </div>
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <button onClick={() => onChange(options.map((o) => o.value))} className="font-body text-xs font-semibold text-accent hover:underline">Select all</button>
              <button onClick={() => onChange([])} className="font-body text-xs font-semibold text-muted hover:text-foreground">Clear</button>
            </div>
            <div className="max-h-56 overflow-y-auto py-1">
              {shown.length === 0 && <p className="px-3 py-3 font-body text-sm text-muted">No match.</p>}
              {shown.map((o) => {
                const on = value.includes(o.value);
                return (
                  <button key={o.value} onClick={() => toggle(o.value)}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left font-body text-sm text-foreground hover:bg-surface-warm">
                    <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${on ? "border-accent bg-accent text-white" : "border-border"}`}>
                      {on && <Icon name="check" className="h-3 w-3" />}
                    </span>
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   SEGMENTED TAB BAR — the dashboard's view switcher
   ══════════════════════════════════════════════════════ */
export function SegmentedTabs<T extends string>({ tabs, active, onChange }: {
  tabs: { key: T; label: string; icon: IconName }[]; active: T; onChange: (k: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-surface p-1">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <button key={t.key} onClick={() => onChange(t.key)}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 font-body text-sm font-semibold transition-colors ${
              on ? "bg-surface-warm text-accent" : "text-muted hover:text-foreground"}`}>
            <Icon name={t.icon} className="h-4 w-4" />
            <span className="whitespace-nowrap">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   KPI CARD — coloured left rail + tinted icon chip
   ══════════════════════════════════════════════════════ */
export function KpiCard({ label, value, icon, accent, loading }: {
  label: string; value: number; icon: IconName; accent: string; loading?: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-surface p-4 pl-5">
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} />
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: `${accent}22`, color: accent }}>
          <Icon name={icon} className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-body text-xs font-semibold text-muted">{label}</p>
          <p className="font-display text-xl font-extrabold text-heading">
            {loading ? <span className="inline-block h-6 w-20 animate-pulse rounded bg-surface-warm" /> : value.toLocaleString("en-IN")}
          </p>
        </div>
      </div>
    </div>
  );
}
