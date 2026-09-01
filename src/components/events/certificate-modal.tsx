"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import VedamCertificate from "@/components/events/vedam-certificate";
import { downloadNodePng } from "@/lib/download-node";
import { linkedInShareUrl, defaultShareText, type CertKind } from "@/lib/events";

type Cert = { full_name: string; event_name: string; issued_on: string; kind: CertKind; position: string | null; source: string; module_id: string | null };

export function CertificateModal({ certId, onClose }: { certId: string; onClose: () => void }) {
  const [supabase] = useState(() => createClient());
  const ref = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<Cert | null>(null);
  const [qr, setQr] = useState("");
  const [scale, setScale] = useState(0.5);
  const [loading, setLoading] = useState(true);
  const [caption, setCaption] = useState("");
  const [copied, setCopied] = useState(false);
  // share-link flow
  const [regId, setRegId] = useState<string | null>(null);
  const [sharePts, setSharePts] = useState(0);
  const [url, setUrl] = useState("");
  const [submitted, setSubmitted] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const w = ref.current?.parentElement?.clientWidth || (window.innerWidth < 760 ? window.innerWidth - 80 : 560);
    setScale(Math.min(w / 1123, 0.62));
  }, [loading]);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: rows } = await supabase.rpc("verify_certificate", { p_id: certId });
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (!active || !row?.valid) { setLoading(false); return; }
      const kind = (row.kind || "participation") as CertKind;
      setData({ full_name: row.full_name, event_name: row.event_name, issued_on: row.issued_on, kind, position: row.position ?? null, source: row.source ?? "event", module_id: row.module_id ?? null });
      setCaption(defaultShareText(row.event_name, kind));
      try { const QR = (await import("qrcode")).default; setQr(await QR.toDataURL(`${window.location.origin}/verify?c=${certId}`, { margin: 0, width: 320 })); } catch { /* optional */ }

      if (row.source !== "codesprint") {
        const { data: cert } = await supabase.from("certificates").select("registration_id, event_id").eq("id", certId).maybeSingle();
        if (cert?.registration_id && active) {
          setRegId(cert.registration_id);
          const { data: reg } = await supabase.from("event_registrations").select("linkedin_post_url").eq("id", cert.registration_id).maybeSingle();
          if (reg?.linkedin_post_url) setSubmitted(-1); // already submitted (points already counted)
          if (cert.event_id) {
            const { data: ev } = await supabase.from("events").select("share_points_podium, share_points_participation").eq("id", cert.event_id).maybeSingle();
            setSharePts(kind === "winner" ? Number(ev?.share_points_podium || 0) : Number(ev?.share_points_participation || 0));
          }
        }
      } else if (row.module_id) {
        const { data: mod } = await supabase.from("cs_modules").select("points_share").eq("id", row.module_id).maybeSingle();
        setSharePts(Number((mod as { points_share?: number } | null)?.points_share || 0));
        const { data: cert } = await supabase.from("certificates").select("linkedin_post_url").eq("id", certId).maybeSingle();
        if (cert?.linkedin_post_url) setSubmitted(-1);
      }
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [certId, supabase]);

  useEffect(() => { function esc(e: KeyboardEvent) { if (e.key === "Escape") onClose(); } document.addEventListener("keydown", esc); return () => document.removeEventListener("keydown", esc); }, [onClose]);

  async function submitLink() {
    if (!url.trim() || busy) return;
    setBusy(true); setErr(null);
    try {
      if (data?.source === "codesprint") {
        const { data: res } = await supabase.rpc("cs_submit_linkedin", { p_cert_id: certId, p_url: url.trim() });
        const r = res as { ok?: boolean; already?: boolean; error?: string; points?: number };
        if (r?.error) { setErr(r.error); setBusy(false); return; }
        setSubmitted(r?.already ? -1 : Number(r?.points) || 0);
      } else if (regId) {
        const { data: res } = await supabase.rpc("submit_linkedin_post", { p_registration_id: regId, p_url: url.trim() });
        const r = res as { ok?: boolean; already?: boolean; error?: string; points?: number };
        if (r?.error) { setErr(r.error); setBusy(false); return; }
        setSubmitted(r?.already ? -1 : Number(r?.points) || 0);
      }
    } catch { setErr("Something went wrong — try again."); }
    setBusy(false);
  }

  const winner = data?.kind === "winner";
  const posWord = data?.position === "1st" ? "First" : data?.position === "2nd" ? "Second" : data?.position === "3rd" ? "Third" : "";

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 grid place-items-center bg-[rgba(20,10,45,.55)] p-4 backdrop-blur-sm">
      <div onClick={(e) => e.stopPropagation()} className="relative max-h-[92vh] w-full max-w-[1000px] overflow-auto rounded-3xl bg-surface shadow-[0_40px_90px_-30px_rgba(43,19,92,.6)]">
        <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full border border-border bg-surface text-muted hover:text-foreground">✕</button>
        {loading ? (
          <div className="grid h-80 place-items-center font-body text-sm text-muted">Loading certificate…</div>
        ) : !data ? (
          <div className="grid h-80 place-items-center font-body text-sm text-muted">Certificate not found.</div>
        ) : (
          <div className="grid md:grid-cols-[1.15fr_.85fr]">
            {/* cert preview (float 3D) */}
            <div className="grid place-items-center border-b border-border bg-surface-warm/40 p-5 md:border-b-0 md:border-r">
              <div style={{ perspective: 1400 }}>
                <div style={{ transform: "rotateX(6deg) rotateY(-7deg)", boxShadow: "-18px 26px 50px -22px rgba(43,19,92,.5)", borderRadius: 12, transition: "transform .3s" }}
                  onMouseEnter={(e) => (e.currentTarget.style.transform = "rotateX(3deg) rotateY(-3deg) translateY(-4px)")}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = "rotateX(6deg) rotateY(-7deg)")}>
                  <VedamCertificate ref={ref} fullName={data.full_name} bootcampName={data.source === "codesprint" ? `${data.event_name} in CodeSprint` : data.event_name} issueDate={data.issued_on} certificateId={certId} qrDataUrl={qr} scale={scale} kind={data.kind} position={data.position} />
                </div>
              </div>
            </div>

            {/* actions */}
            <div className="flex flex-col p-7 sm:p-8">
              <div className="text-3xl">{winner ? "🏆" : data.source === "codesprint" ? "🎓" : "🎉"}</div>
              <h2 className="mt-2 font-display text-2xl font-extrabold text-heading">{winner ? "Congratulations on your win!" : data.source === "codesprint" ? "Module complete!" : "Thanks for taking part!"}</h2>
              <p className="mt-2 font-body text-sm text-muted">{winner && posWord ? <>You placed <b>{posWord}</b> in {data.event_name}. </> : <>{data.source === "codesprint" ? `You completed ${data.event_name}. ` : `You took part in ${data.event_name}. `}</>}Download your certificate and share the moment.</p>

              <div className="mt-5 flex flex-col gap-2.5">
                <button onClick={() => ref.current && downloadNodePng(ref.current, `vedam-certificate-${certId.slice(0, 8)}.png`)} className="rounded-xl bg-heading px-4 py-3 text-center text-sm font-bold text-white" style={{ background: "rgb(var(--heading))" }}>⬇ Download certificate</button>
                <a href={linkedInShareUrl(`${typeof window !== "undefined" ? window.location.origin : ""}/certificate?c=${certId}`)} target="_blank" rel="noreferrer" className="rounded-xl bg-[#0A66C2] px-4 py-3 text-center text-sm font-bold text-white">in&nbsp; Share on LinkedIn</a>
              </div>

              {/* copyable caption */}
              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between"><span className="font-body text-xs font-semibold text-foreground">Post caption</span><button onClick={async () => { await navigator.clipboard.writeText(caption); setCopied(true); setTimeout(() => setCopied(false), 1400); }} className="font-body text-xs font-semibold text-accent">{copied ? "Copied ✓" : "Copy"}</button></div>
                <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3} className="w-full rounded-lg border border-border bg-background px-3 py-2 font-body text-sm text-foreground outline-none" />
              </div>

              {/* #5 post-link CTA */}
              {sharePts > 0 && (
                submitted !== null ? (
                  <div className="mt-4 flex items-center gap-3 rounded-2xl border border-[#b7e4c7] bg-[#eafaf0] p-4 text-[#1a7f4b]">
                    <span>✓</span><div className="font-body text-sm font-bold">{submitted === -1 ? "Link already submitted — points counted." : `Link submitted — +${submitted} points earned!`}<div className="font-body text-xs font-normal text-[#3a8f66]">This can&apos;t be submitted again.</div></div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-dashed border-border-strong bg-surface-warm/40 p-4">
                    <h4 className="font-display text-sm font-extrabold text-heading">Earn +{sharePts} points</h4>
                    <p className="mt-0.5 font-body text-xs text-muted">Shared it? Paste your LinkedIn <b>post link</b> to claim the points. One submission per event.</p>
                    <div className="mt-2.5 flex gap-2">
                      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.linkedin.com/posts/…" className="flex-1 rounded-lg border border-border-strong bg-background px-3 py-2 font-mono text-xs text-foreground outline-none" />
                      <button onClick={submitLink} disabled={busy || !url.trim()} className="rounded-lg bg-brand-gradient px-4 text-sm font-bold text-white disabled:opacity-60">{busy ? "…" : "Submit"}</button>
                    </div>
                    {err && <p className="mt-1.5 font-body text-xs text-red-500">{err}</p>}
                  </div>
                )
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
