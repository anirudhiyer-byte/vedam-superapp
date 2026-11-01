import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "VSAT Registration (internal)" };

/**
 * VSAT Registration (internal).
 *
 * Renders the designed /public/vedam-one/apply.html page UNCHANGED in an iframe.
 * We fetch the signed-in profile here and pass it in the iframe URL hash
 * (#vsatpf=<encoded json>); a small script in apply.html reads it on load and
 * prefills the form (name/email/phone + class 12 year/stream/state/city).
 * The hash is never sent to the server/CDN, so caching and privacy are fine.
 * Campus preference and "where did you hear" stay blank (not on the profile).
 *
 * Sits OUTSIDE the (shell) route group so the SiteHeader/Footer don't frame it.
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

  // prefill payload — own row is readable under RLS (profiles_select_own)
  let hash = "";
  if (user) {
    const { data: p } = await sb.from("profiles")
      .select("full_name,email,phone,grad_year,stream,state,city")
      .eq("id", user.id).maybeSingle();
    if (p) hash = "#vsatpf=" + encodeURIComponent(JSON.stringify(p));
  }

  return (
    <iframe
      title="Vedam One — Application"
      src={`/vedam-one/apply.html${hash}`}
      className="fixed inset-0 block h-screen w-screen border-0 bg-white"
    />
  );
}
