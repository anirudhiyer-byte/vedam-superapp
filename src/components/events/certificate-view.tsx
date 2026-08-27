"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import VedamCertificate from "@/components/events/vedam-certificate";
import { downloadNodePng } from "@/lib/download-node";

export function CertificateView() {
  const params = useSearchParams();
  const certId = params.get("c") || "";
  const [supabase] = useState(() => createClient());
  const [data, setData] = useState<{ full_name: string; event_name: string; issued_on: string } | null>(null);
  const [qr, setQr] = useState("");
  const [loading, setLoading] = useState(true);
  const [scale, setScale] = useState(0.6);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const w = Math.min(window.innerWidth - 32, 1123);
    setScale(w / 1123);
    if (!certId) { setLoading(false); return; }
    let active = true;
    (async () => {
      const { data: rows } = await supabase.rpc("verify_certificate", { p_id: certId });
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (active && row?.valid) {
        setData({ full_name: row.full_name, event_name: row.event_name, issued_on: row.issued_on });
        try {
          const QRCode = (await import("qrcode")).default;
          const url = await QRCode.toDataURL(`${window.location.origin}/verify?c=${certId}`, { margin: 0, width: 320 });
          if (active) setQr(url);
        } catch { /* qr optional */ }
      }
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [certId, supabase]);

  if (loading) return <div className="flex min-h-screen items-center justify-center"><div className="h-48 w-80 animate-pulse rounded-xl border border-border bg-surface" /></div>;
  if (!data) return <div className="flex min-h-screen flex-col items-center justify-center gap-2 px-6 text-center"><h1 className="font-display text-2xl font-bold text-heading">Certificate not found</h1><p className="font-body text-sm text-muted">This certificate link is invalid.</p></div>;

  return (
    <div className="flex min-h-screen flex-col items-center gap-6 px-4 py-10">
      <div className="rounded-xl border border-border shadow-lg">
        <VedamCertificate ref={ref} fullName={data.full_name} bootcampName={data.event_name} issueDate={data.issued_on} certificateId={certId} qrDataUrl={qr} scale={scale} />
      </div>
      <button onClick={() => ref.current && downloadNodePng(ref.current, `vedam-certificate-${certId.slice(0, 8)}.png`)}
        className="rounded-xl bg-brand-gradient px-6 py-3 text-sm font-semibold text-white">Download PNG</button>
    </div>
  );
}
