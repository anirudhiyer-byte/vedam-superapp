import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Insights } from "@/components/admin/insights/insights";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Insights", robots: { index: false, follow: false } };

// Admin-gated like every other /admin page (the ins_* RPCs also enforce admin in the
// DB via ins__guard, so this only keeps the UI shell from rendering to non-admins).
export default async function Page() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  let isAdmin = false;
  if (user) {
    const email = (user.email ?? "").toLowerCase();
    isAdmin = email.endsWith("@vedam.org") && !!user.email_confirmed_at;
    if (!isAdmin) { const { data } = await sb.rpc("is_admin"); isAdmin = !!data; }
  }
  if (!isAdmin) redirect("/");
  return <Insights />;
}
