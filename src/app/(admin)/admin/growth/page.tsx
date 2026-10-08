import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { GrowthHub } from "@/components/admin/growth-hub";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Growth", robots: { index: false, follow: false } };

async function guardAdmin() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  let isAdmin = false;
  if (user) {
    const email = (user.email ?? "").toLowerCase();
    isAdmin = email.endsWith("@vedam.org") && !!user.email_confirmed_at;
    if (!isAdmin) { const { data } = await sb.rpc("is_admin"); isAdmin = !!data; }
  }
  if (!isAdmin) redirect("/apply");
}

export default async function Page() {
  await guardAdmin();
  return <GrowthHub />;
}
