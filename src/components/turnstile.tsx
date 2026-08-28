"use client";

import { useEffect, useRef } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window { turnstile?: any }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js";

/**
 * Cloudflare Turnstile widget. Renders nothing unless
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY is set. Calls onToken with the token (or null
 * on expiry/error). Bump `resetKey` to force a fresh challenge (tokens are single-use).
 */
export function Turnstile({ onToken, resetKey = 0 }: { onToken: (t: string | null) => void; resetKey?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onToken);
  cb.current = onToken;
  const widgetId = useRef<string | null>(null);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;

    const render = () => {
      if (cancelled || !ref.current || !window.turnstile || widgetId.current) return;
      widgetId.current = window.turnstile.render(ref.current, {
        sitekey: siteKey,
        theme: "auto",
        callback: (t: string) => cb.current(t),
        "expired-callback": () => cb.current(null),
        "error-callback": () => cb.current(null),
      });
    };

    if (window.turnstile) {
      render();
    } else if (!document.querySelector(`script[src="${SCRIPT}"]`)) {
      const s = document.createElement("script");
      s.src = SCRIPT; s.async = true; s.defer = true; s.onload = render;
      document.head.appendChild(s);
    } else {
      const t = setInterval(() => { if (window.turnstile) { clearInterval(t); render(); } }, 150);
    }

    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) {
        try { window.turnstile.remove(widgetId.current); } catch { /* ignore */ }
        widgetId.current = null;
      }
    };
  }, [siteKey]);

  useEffect(() => {
    if (resetKey && widgetId.current && window.turnstile) {
      try { window.turnstile.reset(widgetId.current); } catch { /* ignore */ }
    }
  }, [resetKey]);

  if (!siteKey) return null;
  return <div ref={ref} className="mt-1" />;
}
