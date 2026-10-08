import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { GrowthEmbed } from "@/components/admin/growth-embed";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Growth · Code Sprint", robots: { index: false, follow: false } };

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
  return (
    <GrowthEmbed
      title="Code Sprint"
      file="codesprint.html"
      tabs={[
        { label: "Cost & CPL Listing", page: "cost-listing" },
        { label: "Cost & CPL Dashboard", page: "cost-dash" },
        { label: "UTM Listing", page: "utm-listing" },
        { label: "UTM Dashboard", page: "utm-dash" },
      ]}
    />
  );
}
