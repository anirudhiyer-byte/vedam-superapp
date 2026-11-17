import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSvc } from "@supabase/supabase-js";
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
  const emailAdmin = email.endsWith("@vedam.org") && !!user.email_confirmed_at;
  const svcUrl = process.env.NEXT_PUBLIC_SUPABASE_URL, svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const svc = svcUrl && svcKey ? createSvc(svcUrl, svcKey) : null;

  // Run the gate + admin check AND prefetch the dashboard's own data (app + lead) in
  // parallel, so the dashboard renders populated on first paint instead of doing a
  // client round-trip to /api/vsat/me after it mounts (that was the form→dashboard lag).
  const [gate, isAdminRpc, appRow, leadRow] = await Promise.all([
    readVsatGate(),
    emailAdmin ? Promise.resolve(true) : sb.rpc("is_admin").then((r) => !!r.data),
    svc ? svc.from("application_manager").select("*").eq("lead_id", user.id).maybeSingle().then((r) => r.data) : Promise.resolve(null),
    svc ? svc.from("lead_manager").select("lead_stage,registered_name,public_id,campus_preference").eq("lead_id", user.id).maybeSingle().then((r) => r.data) : Promise.resolve(null),
  ]);
  const isAdmin = emailAdmin || isAdminRpc;
  if (!isAdmin && !gate.applyPublic) redirect("/apply");
  return <VsatDashboard isAdmin={isAdmin} initialApp={appRow ?? null} initialLead={leadRow ?? null} />;
}
