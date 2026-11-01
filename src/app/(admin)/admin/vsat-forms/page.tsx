import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VsatFormBuilder } from "@/components/admin/vsat-form-builder";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "VSAT Form builder", robots: { index: false, follow: false } };

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
  return <VsatFormBuilder />;
}
