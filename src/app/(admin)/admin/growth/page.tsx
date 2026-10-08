import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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

/**
 * Growth — the combined Neural CRM shell (unified left sidebar + all modules).
 * Served as a self-contained app from /public/growth/index.html; every module is
 * listed in the sidebar but only Events + Code Sprint are live, the rest show "Soon".
 * Embedded full-bleed so the sidebar experience is preserved inside admin.
 */
export default async function Page() {
  await guardAdmin();
  // Full-screen overlay: covers the platform site-header so the Growth shell
  // (its own Neural Glass sidebar + topbar) owns the whole viewport.
  return (
    <iframe
      src="/growth/index.html"
      title="Vedam Neural CRM — Growth"
      className="fixed inset-0 z-50 h-full w-full border-0"
      style={{ background: "#070a16" }}
    />
  );
}
