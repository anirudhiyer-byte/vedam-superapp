import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CallerConsole } from "@/components/caller/caller-console";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Calling Console", robots: { index: false, follow: false } };

/**
 * Caller surface — a caller logs in and sees ONLY their own assigned leads +
 * their own stats. Nothing admin here. Access is for callers (and admins, who
 * may want to preview). Everyone else is bounced to "/". The data itself is
 * still gated server-side by the SECURITY DEFINER RPCs (calling_my_queue /
 * calling_log_update / calling_dashboard), so this page only decides who may
 * open the console — it never widens what the RPCs allow.
 */
export default async function Page() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const [{ data: isCaller }, { data: isAdmin }] = await Promise.all([
    sb.rpc("is_caller"),
    sb.rpc("is_admin"),
  ]);
  if (!isCaller && !isAdmin) redirect("/");
  return <CallerConsole />;
}
