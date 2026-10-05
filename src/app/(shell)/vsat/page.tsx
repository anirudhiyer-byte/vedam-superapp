import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VsatApplyForm } from "@/components/vsat/vsat-apply-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "VSAT Registration (internal)" };

const BENEFITS = [
  { icon: "🎟️", title: "Concession on VSAT fee", desc: "Register early, pay a reduced fee." },
  { icon: "🎓", title: "Higher scholarship brackets", desc: "Early applicants are assessed for top scholarships first." },
  { icon: "🪑", title: "Limited early-intake seats", desc: "Get ahead before admissions open to everyone." },
  { icon: "⚡", title: "Fast-track to interview", desc: "Clear VSAT and move straight to the interview round." },
];

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
    <div className="min-h-screen bg-[#0b0618] text-white lg:grid lg:grid-cols-2">
      <div className="px-6 py-10 sm:px-10 lg:py-16">
        <span className="inline-block rounded-full border border-[#c200db]/30 bg-[#c200db]/10 px-3 py-1 text-xs text-white/70">Internal preview • VSAT full registration</span>
        <h1 className="mt-5 font-display text-4xl font-black leading-[1.05] sm:text-5xl">
          Your seat at an<br /><span style={{ background: "linear-gradient(120deg,#00cfe5,#c200db)", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent" }}>AI-first B.Tech</span><br />starts with VSAT.
        </h1>
        <p className="mt-5 max-w-md text-white/60">Register for VSAT, give the test, clear the interview, and secure your admission — all in one place.</p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {BENEFITS.map((b) => (
            <div key={b.title} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
              <div className="text-2xl">{b.icon}</div><h3 className="mt-3 font-semibold">{b.title}</h3><p className="mt-1 text-sm text-white/55">{b.desc}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 rounded-2xl border border-white/10 bg-white/[0.04] p-6">
          <h3 className="font-semibold">How it works</h3>
          <ol className="mt-3 space-y-2 text-sm text-white/60">
            <li>1 · Register & verify your number (you're in)</li>
            <li>2 · Pay the VSAT fee & pick your exam slot</li>
            <li>3 · Give the test → clear → interview → counselling</li>
            <li>4 · Get your offer & scholarship → enroll</li>
          </ol>
        </div>
      </div>
      <div className="flex items-center justify-center px-6 py-10 sm:px-10 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-l lg:border-white/10 lg:bg-white/[0.02]">
        <VsatApplyForm />
      </div>
    </div>
  );
}
