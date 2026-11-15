"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Open dialogs, oldest first. Only the top one reacts to Escape / Tab, so a modal opened from a drawer closes alone. */
const stack: object[] = [];

/**
 * Keyboard behaviour shared by every modal and drawer (v2):
 *  - focus moves into the panel when it opens (`[data-autofocus]`, else the first form field, else the first control)
 *  - Tab / Shift+Tab stay inside the panel
 *  - Escape closes it
 *  - the page behind does not scroll
 *  - focus goes back to whatever opened it
 * Attach the returned ref to the panel element (not the backdrop).
 */
export function useDialog<T extends HTMLElement>(open: boolean, onClose: () => void, enabled = true) {
  const ref = useRef<T>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open || !enabled) return;
    const node = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    const controls = () =>
      node ? Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0) : [];

    const firstField = controls().find((el) => /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName));
    (node?.querySelector<HTMLElement>("[data-autofocus]") ?? firstField ?? controls()[0] ?? node)?.focus();

    const me = {};
    stack.push(me);
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== me) return;
      if (e.key === "Escape") { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== "Tab" || !node) return;
      const items = controls();
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      const inside = node.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === first)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (!inside || document.activeElement === last)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const at = stack.indexOf(me); if (at >= 0) stack.splice(at, 1);
      document.body.style.overflow = overflow;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open, enabled]);

  return ref;
}
