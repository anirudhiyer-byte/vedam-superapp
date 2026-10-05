import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VsatDashboard } from "@/components/vsat/vsat-dashboard";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "VSAT — Applicant Dashboard" };

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
