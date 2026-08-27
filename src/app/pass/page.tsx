import { Suspense } from "react";
import { PassView } from "@/components/events/pass-view";
export const dynamic = "force-dynamic";
export const metadata = { title: "Your pass" };
export default function Page() {
  return <Suspense fallback={null}><PassView /></Suspense>;
}
