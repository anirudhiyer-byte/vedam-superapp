"use client";
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);
  return (
    <html>
      <body style={{ background: "#0b0318", color: "#fff", fontFamily: "system-ui", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div style={{ textAlign: "center", padding: 24 }}>
          <h2 style={{ fontSize: 22, marginBottom: 8 }}>Something went wrong</h2>
          <p style={{ color: "#9a95b4", marginBottom: 20 }}>We&apos;ve been notified and are looking into it.</p>
          <button onClick={() => window.location.assign("/")} style={{ padding: "10px 22px", borderRadius: 10, background: "linear-gradient(120deg,#8A18FF,#c04bff)", color: "#fff", border: "none", fontWeight: 600, cursor: "pointer" }}>Back to home</button>
        </div>
      </body>
    </html>
  );
}
