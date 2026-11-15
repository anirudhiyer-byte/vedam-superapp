import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VsatForm } from "@/components/vsat/vsat-form";
import { readVsatGate } from "@/lib/vsat/public-gate";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "VSAT Early Registration", robots: { index: false, follow: false } };

/**
 * /vsat — the OLD early-registration form (inside the shell, with header/footer).
 *
 * Visible to everyone while app_flags.vsat_legacy_public = 'on' (the default), and
 * always to admins. When toggled off at go-live it becomes admin-only (archived) and
 * the public is sent to the new signup at /apply. The vsat_registrations data this
 * form writes is untouched by the toggle.
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
  const { applyPublic, legacyPublic } = await readVsatGate();
  if (!legacyPublic && !isAdmin) redirect(applyPublic ? "/apply" : "/");
  return <VsatForm />;
}
