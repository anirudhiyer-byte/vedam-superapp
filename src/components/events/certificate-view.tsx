"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import VedamCertificate from "@/components/events/vedam-certificate";
import { downloadNodePng } from "@/lib/download-node";
import { linkedInShareUrl, defaultShareText, type CertKind } from "@/lib/events";

export function CertificateView() {
  const params = useSearchParams();
  const certId = params.get("c") || "";
  const [supabase] = useState(() => createClient());
  const [data, setData] = useState<{ full_name: string; event_name: string; issued_on: string; kind: CertKind; position: string | null } | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [qr, setQr] = useState("");
  const [loading, setLoading] = useState(true);
  const [scale, setScale] = useState(0.6);
  const [shareText, setShareText] = useState("");
  const [copied, setCopied] = useState(false);
  const [sharePts, setSharePts] = useState(0);
  const [awarded, setAwarded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setScale(Math.min((window.innerWidth - 32) / 1123, 1));
    if (!certId) { setLoading(false); return; }
    let active = true;
    (async () => {
      const { data: rows } = await supabase.rpc("verify_certificate", { p_id: certId });
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (active && row?.valid) {
        const kind = (row.kind || "participation") as CertKind;
        setData({ full_name: row.full_name, event_name: row.event_name, issued_on: row.issued_on, kind, position: row.position ?? null });
        setShareText(defaultShareText(row.event_name, kind));
        try {
          const QRCode = (await import("qrcode")).default;
          setQr(await QRCode.toDataURL(`${window.location.origin}/verify?c=${certId}`, { margin: 0, width: 320 }));
        } catch { /* qr optional */ }
        // find the event to read its share points + link the award
        const { data: cert } = await supabase.from("certificates").select("event_id").eq("id", certId).maybeSingle();
        if (cert?.event_id && active) {
          setEventId(cert.event_id);
          const { data: ev } = await supabase.from("events").select("points_config").eq("id", cert.event_id).maybeSingle();
          const pc = ev?.points_config as Record<string, number> | null;
          if (active) setSharePts(Number(pc?.share_linkedin || 0));
        }
      }
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [certId, supabase]);

  async function copyText() {
    try { await navigator.clipboard.writeText(shareText); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  }

  async function share() {
    const certUrl = `${window.location.origin}/certificate?c=${certId}`;
    window.open(linkedInShareUrl(certUrl), "_blank", "noopener");
    if (eventId && !awarded) {
      try { await supabase.rpc("award_event_points", { p_event_id: eventId, p_action: "share_linkedin" }); setAwarded(true); } catch { /* best effort */ }
    }
  }

  if (loading) return <div className="flex min-h-screen items-center justify-center"><div className="h-48 w-80 animate-pulse rounded-xl border border-border bg-surface" /></div>;
  if (!data) return <div className="flex min-h-screen flex-col items-center justify-center gap-2 px-6 text-center"><h1 className="font-display text-2xl font-bold text-heading">Certificate not found</h1><p className="font-body text-sm text-muted">This certificate link is invalid.</p></div>;

  return (
    <div className="flex min-h-screen flex-col items-center gap-6 px-4 py-10">
      <div className="rounded-xl border border-border shadow-lg">
        <VedamCertificate ref={ref} fullName={data.full_name} bootcampName={data.event_name} issueDate={data.issued_on} certificateId={certId} qrDataUrl={qr} scale={scale} kind={data.kind} position={data.position} />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <button onClick={() => ref.current && downloadNodePng(ref.current, `vedam-certificate-${certId.slice(0, 8)}.png`)}
          className="rounded-xl border border-border px-6 py-3 text-sm font-semibold text-foreground hover:bg-surface-warm">Download PNG</button>
        <button onClick={share} className="rounded-xl bg-[#0A66C2] px-6 py-3 text-sm font-semibold text-white">
          Share on LinkedIn{sharePts > 0 ? ` · +${sharePts} pts` : ""}
        </button>
      </div>

      {/* editable share text (LinkedIn's dialog only takes the link, so we let them copy the caption) */}
      <div className="w-full max-w-xl rounded-2xl border border-border bg-surface p-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-body text-xs font-semibold text-foreground">Your post caption</span>
          <button onClick={copyText} className="font-body text-xs font-semibold text-accent">{copied ? "Copied ✓" : "Copy"}</button>
        </div>
        <textarea value={shareText} onChange={(e) => setShareText(e.target.value)} rows={4}
          className="w-full rounded-lg border border-border bg-background px-3 py-2.5 font-body text-sm text-foreground outline-none focus:border-[color:rgb(var(--accent))]" />
        <p className="mt-2 font-body text-xs text-muted">Copy this, hit Share, and paste it into your LinkedIn post. The certificate preview appears automatically.</p>
      </div>
    </div>
  );
}
