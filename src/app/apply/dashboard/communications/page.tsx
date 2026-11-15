import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VsatCommunicationsList } from "@/components/vsat/vsat-communications-list";
import { readVsatGate } from "@/lib/vsat/public-gate";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "VSAT — My communications" };

/** Every email + WhatsApp we've sent the student. Same gate as the dashboard. */
export default async function Page() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/apply");
  const email = (user.email ?? "").toLowerCase();
  let isAdmin = email.endsWith("@vedam.org") && !!user.email_confirmed_at;
  if (!isAdmin) { const { data } = await sb.rpc("is_admin"); isAdmin = !!data; }
  const { applyPublic } = await readVsatGate();
  if (!isAdmin && !applyPublic) redirect("/apply");
  return <VsatCommunicationsList />;
}
