import type { Metadata } from "next";
import { VsatForm } from "@/components/vsat/vsat-form";
import { safeNext } from "@/lib/safe-next";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "VSAT Interest — Register now, Start Ahead" };

// ?next= = where to send the user back after registering (e.g. a PeerPath booking page).
// Only a page on this site is accepted (safeNext); anything else is ignored.
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.next) ? sp.next[0] : sp.next;
  return <VsatForm next={safeNext(raw, "") || null} />;
}
