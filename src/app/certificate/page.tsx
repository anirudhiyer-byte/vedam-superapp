import { Suspense } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { CertificateView } from "@/components/events/certificate-view";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}): Promise<Metadata> {
  const { c } = await searchParams;
  let title = "Certificate · Vedam", name = "", event = "";
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (url && anon && c) {
      const supa = createClient(url, anon);
      const { data } = await supa.rpc("verify_certificate", { p_id: c });
      const row = Array.isArray(data) ? data[0] : data;
      if (row?.valid) { name = row.full_name || ""; event = row.event_name || ""; title = `${name}'s Vedam Certificate`; }
    }
  } catch { /* defaults */ }

  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "";
  const proto = h.get("x-forwarded-proto") || "https";
  const ogImage = host && c ? `${proto}://${host}/api/certificate/og?c=${c}` : undefined;
  const description = name && event ? `${name} — ${event}, Vedam School of Technology.` : "A Vedam School of Technology certificate.";

  return {
    title,
    description,
    openGraph: { title, description, images: ogImage ? [{ url: ogImage, width: 1200, height: 630 }] : undefined },
    twitter: { card: "summary_large_image", title, description, images: ogImage ? [ogImage] : undefined },
  };
}

export default function Page() {
  return <Suspense fallback={null}><CertificateView /></Suspense>;
}
