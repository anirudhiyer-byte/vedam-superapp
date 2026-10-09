import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "VSAT Registration (internal)" };

/**
 * VSAT Registration (internal).
 *
 * Renders the Vedam One application page exactly as designed. The page is a
 * self-contained single-file prototype served from /public/vedam-one/apply.html
 * (same pattern as the Growth modules in /public/growth), embedded full-bleed so
 * it appears unchanged.
 *
 * This route deliberately sits OUTSIDE the (shell) route group: the shell layout
 * adds SiteHeader + Footer, which would frame the page and produce a second
 * scrollbar. The URL is unaffected — route groups do not appear in the path — so
 * this is still /vsat, and the header's own link to it keeps working.
 * /vsat/dashboard stays inside the shell, where the nav is useful.
 *
 * Its "Back" control uses href="/" with target="_top", so it leaves the iframe
 * and lands on this deployment's own home page — staging on staging, prod on prod.
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

  // h-screen + fixed: the iframe owns the only scrollbar on this route.
  return (
    <iframe
      title="Vedam One — Application"
      src="/vedam-one/apply.html"
      className="fixed inset-0 block h-screen w-screen border-0 bg-white"
    />
  );
}
