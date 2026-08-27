import { Suspense } from "react";
import { CertificateView } from "@/components/events/certificate-view";
export const dynamic = "force-dynamic";
export const metadata = { title: "Certificate" };
export default function Page() {
  return <Suspense fallback={null}><CertificateView /></Suspense>;
}
