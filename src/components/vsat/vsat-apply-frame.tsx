"use client";
import { useEffect, useRef } from "react";

export type VsatPrefill = {
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  grad_year?: number | null;
  stream?: string | null;
  state?: string | null;
  city?: string | null;
};

/**
 * Renders the designed /vedam-one/apply.html page UNCHANGED in an iframe, and
 * posts the signed-in profile into it so the form prefills. Same-origin, so the
 * iframe's small listener fills both the desktop (light DOM) and mobile (shadow
 * DOM) copies of the form. No design is rebuilt — this only passes data in.
 */
export function VsatApplyFrame({ profile }: { profile: VsatPrefill }) {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const send = () => {
      try { ref.current?.contentWindow?.postMessage({ type: "vsat-prefill", profile }, window.location.origin); } catch { /* ignore */ }
    };
    const onMsg = (ev: MessageEvent) => {
      if (ev.origin === window.location.origin && (ev.data as { type?: string })?.type === "vsat-frame-ready") send();
    };
    window.addEventListener("message", onMsg);
    const f = ref.current;
    f?.addEventListener("load", send); // fallback if the ready message is missed
    send(); // and once now in case the frame is already loaded
    return () => { window.removeEventListener("message", onMsg); f?.removeEventListener("load", send); };
  }, [profile]);

  return (
    <iframe
      ref={ref}
      title="Vedam One — Application"
      src="/vedam-one/apply.html"
      className="fixed inset-0 block h-screen w-screen border-0 bg-white"
    />
  );
}
