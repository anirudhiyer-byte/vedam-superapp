import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VsatEarlyDashboard } from "@/components/admin/vsat-early-dashboard";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "VSAT Early Registration — analytics" };
export default async function Page() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  let isAdmin = false;
  if (user) { const email = (user.email ?? "").toLowerCase(); isAdmin = email.endsWith("@vedam.org") && !!user.email_confirmed_at; if (!isAdmin) { const { data } = await sb.rpc("is_admin"); isAdmin = !!data; } }
  if (!isAdmin) redirect("/");
  return <VsatEarlyDashboard />;
}
