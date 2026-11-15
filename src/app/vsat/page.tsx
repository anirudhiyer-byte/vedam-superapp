import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VsatForm } from "@/components/vsat/vsat-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "VSAT Early Registration (archived)", robots: { index: false, follow: false } };

/**
 * /vsat — the OLD early-registration form, now ADMIN-ONLY (archived).
 *
 * Students sign up at /apply. This URL keeps the original early-reg form reachable to
 * admins, and its vsat_registrations data stays intact. Non-admins are redirected to
 * /apply. (The student dashboard remains at /vsat/dashboard with its own gate.)
 */
export default async function Page() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  let isAdmin = false;
  if (user) {
    const email = (user.email ?? "").toLowerCase();
    isAdmin = email.endsWith("@vedam.org") && !!user.email_confirmed_at;
    if (!isAdmin) { const { data } = await sb.rpc("is_admin"); isAdmin = !!data; }
  }
  if (!isAdmin) redirect("/apply");
  return <VsatForm />;
}
