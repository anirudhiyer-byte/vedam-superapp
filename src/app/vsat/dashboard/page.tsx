import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VsatDashboard } from "@/components/vsat/vsat-dashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "VSAT — Applicant Dashboard" };

/**
 * VSAT applicant dashboard.
 *
 * Sits OUTSIDE the (shell) route group (like /vsat itself) so the SiteHeader/Footer
 * don't frame it — no sticky navbar. The component renders its own "← Back" button
 * that returns to /vsat.
 */
export default async function Page() {
  // admin-only during internal rollout; opens to all applicants when VSAT goes live
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  let isAdmin = false;
  if (user) {
    const email = (user.email ?? "").toLowerCase();
    isAdmin = email.endsWith("@vedam.org") && !!user.email_confirmed_at;
    if (!isAdmin) { const { data } = await sb.rpc("is_admin"); isAdmin = !!data; }
  }
  if (!isAdmin) redirect("/apply");
  return <VsatDashboard />;
}
