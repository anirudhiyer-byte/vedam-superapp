import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VsatExamCenter, type WheeboxStatus } from "@/components/admin/vsat-exam-center";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "VSAT Exam Center", robots: { index: false, follow: false } };

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

  // Presence of the Wheebox credentials — booleans only, computed server-side so
  // the secret values never reach the client. Mirrors wheeboxCreds() in
  // src/lib/wheebox/crypto.ts (all four required for the integration to work).
  const base = !!process.env.WHEEBOX_BASE_URL;
  const companyCode = !!process.env.WHEEBOX_COMPANY_CODE;
  const accessToken = !!process.env.WHEEBOX_ACCESS_TOKEN;
  const privateKey = !!process.env.WHEEBOX_PRIVATE_KEY;
  const wheebox: WheeboxStatus = { base, companyCode, accessToken, privateKey, ready: base && companyCode && accessToken && privateKey };

  return <VsatExamCenter wheebox={wheebox} />;
}
