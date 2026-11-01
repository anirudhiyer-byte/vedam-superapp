import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VsatApplyForm } from "@/components/vsat/vsat-apply-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "VSAT Registration (internal)" };

/**
 * VSAT Registration (internal) — the functional two-step applicant form.
 *
 * Renders the VsatApplyForm client component: it prefills from the signed-in
 * profile (name/email/phone + class 12 year / stream / state / city), creates a
 * VSAT lead on phone-OTP verify, and creates the application ("Start application")
 * before handing off to /vsat/dashboard. The polished apply.html design is a
 * separate styling pass on this same component — the logic lives here, once.
 *
 * Sits OUTSIDE the (shell) route group so the SiteHeader/Footer don't frame it;
 * the URL is still /vsat (route groups don't appear in the path).
 */
export default async function Page() {
  // ADMIN-ONLY for now. Everyone else -> the live early-registration page at /apply.
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  let isAdmin = false;
  if (user) {
    const email = (user.email ?? "").toLowerCase();
    isAdmin = email.endsWith("@vedam.org") && !!user.email_confirmed_at;
    if (!isAdmin) { const { data } = await sb.rpc("is_admin"); isAdmin = !!data; }
  }
  if (!isAdmin) redirect("/apply");

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0618] px-4 py-10">
      <VsatApplyForm />
    </div>
  );
}
