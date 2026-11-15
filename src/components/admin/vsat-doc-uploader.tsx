"use client";
import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * One-click admin uploader for the VSAT landing documents → the public vsat-docs
 * bucket. Pick a PDF, hit Upload; the dashboard quick-links read these by their fixed
 * filenames. Admin-only (the API route re-checks).
 */
const DOCS: { path: string; label: string }[] = [
  { path: "adypu-pune-brochure.pdf", label: "ADYPU Pune brochure" },
  { path: "sushant-gurugram-brochure.pdf", label: "Sushant Gurugram brochure" },
  { path: "vsat-sample-paper.pdf", label: "Sample paper" },
  { path: "vsat-prep-kit.pdf", label: "Prep kit" },
];

const card = "rounded-2xl border border-white/10 bg-white/[0.03] p-5";

function Row({ path, label }: { path: string; label: string }) {
  const [supabase] = useState(() => createClient());
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function upload() {
    const file = ref.current?.files?.[0];
    if (!file) { setMsg({ ok: false, text: "Pick a PDF first." }); return; }
    setBusy(true); setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setBusy(false); return setMsg({ ok: false, text: "Sign in again." }); }
      const fd = new FormData();
      fd.append("accessToken", session.access_token);
      fd.append("path", path);
      fd.append("file", file);
      const res = await fetch("/api/admin/vsat-doc-upload", { method: "POST", body: fd });
      const j = await res.json();
      setBusy(false);
      if (!j.ok) return setMsg({ ok: false, text: j.error === "too_large" ? "File is over 60 MB." : "Upload failed." });
      setMsg({ ok: true, text: `Uploaded (${Math.round((j.bytes || file.size) / 1024 / 1024)} MB).` });
      if (ref.current) ref.current.value = "";
    } catch { setBusy(false); setMsg({ ok: false, text: "Upload failed." }); }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-white/10 py-3 first:border-t-0">
      <div className="min-w-[180px] flex-1">
        <div className="text-sm font-semibold text-white">{label}</div>
        <div className="text-[11px] text-white/35">{path}</div>
      </div>
      <input ref={ref} type="file" accept="application/pdf"
        className="max-w-[220px] text-xs text-white/70 file:mr-2 file:rounded-md file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-xs file:text-white" />
      <button onClick={upload} disabled={busy} className="rounded-lg bg-[#00cfe5] px-3 py-1.5 text-sm font-bold text-[#06252b] disabled:opacity-50">{busy ? "Uploading…" : "Upload"}</button>
      {msg && <span className={`text-xs font-semibold ${msg.ok ? "text-[#79e3b0]" : "text-[#ff8a8a]"}`}>{msg.text}</span>}
    </div>
  );
}

export function VsatDocUploader() {
  return (
    <section className={`${card} mt-6`}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-white">Landing documents</h2>
        <span className="text-xs text-white/40">Public bucket · students download these from the dashboard</span>
      </div>
      <div className="mt-3">
        {DOCS.map((d) => <Row key={d.path} {...d} />)}
      </div>
    </section>
  );
}
