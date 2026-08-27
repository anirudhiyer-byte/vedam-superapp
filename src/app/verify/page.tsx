import { Suspense } from "react";
import { VerifyView } from "@/components/events/verify-view";
export const dynamic = "force-dynamic";
export const metadata = { title: "Verify certificate" };
export default function Page() {
  return <Suspense fallback={null}><VerifyView /></Suspense>;
}
