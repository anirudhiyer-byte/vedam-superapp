import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { GrowthEmbed } from "@/components/admin/growth-embed";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Growth · Events", robots: { index: false, follow: false } };

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
      title="Events"
      file="events.html"
      tabs={[
        { label: "Events Listing", page: "listing" },
        { label: "Events Performance", page: "perf" },
      ]}
    />
  );
}
