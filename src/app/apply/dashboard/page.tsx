import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VsatDashboard } from "@/components/vsat/vsat-dashboard";
import { readVsatGate } from "@/lib/vsat/public-gate";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "VSAT — Applicant Dashboard" };

/**
 * VSAT applicant dashboard at /apply/dashboard. Outside the (shell) route group so the
 * SiteHeader/Footer don't frame it. Open to any signed-in applicant once the VSAT
 * signup is public (vsat_public = 'on'); admins always.
 */
export default async function Page() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/apply");
  const email = (user.email ?? "").toLowerCase();
  let isAdmin = email.endsWith("@vedam.org") && !!user.email_confirmed_at;
  if (!isAdmin) { const { data } = await sb.rpc("is_admin"); isAdmin = !!data; }
  const { applyPublic } = await readVsatGate();
  if (!isAdmin && !applyPublic) redirect("/apply");
  return <VsatDashboard isAdmin={isAdmin} />;
}
