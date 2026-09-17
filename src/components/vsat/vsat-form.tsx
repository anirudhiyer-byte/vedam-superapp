"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const YEARS = ["2024", "2025", "2026", "2027", "2028"];
const CAMPUSES = ["Pune — Ajeenkya DY Patil University", "Gurugram — Sushant University"];
const GENDERS = ["Male", "Female", "Other", "Prefer not to say"];
const BENEFITS = [
  { icon: "🎟️", title: "Concession on VSAT Fee", desc: "Register early and get a reduced VSAT fee." },
  { icon: "🎓", title: "Higher Scholarship", desc: "Get assessed for higher scholarship brackets first." },
  { icon: "🪑", title: "Limited Early Intake Seats", desc: "Get early access before admissions open to everyone." },
];
const grad = "linear-gradient(172deg,#00cfe5 26%,#794ede 70%,#c200db 129%)";
const headGrad = { background: "linear-gradient(138deg,#00cfe5 5%,#c200db 97%)", WebkitBackgroundClip: "text" as const, backgroundClip: "text" as const, WebkitTextFillColor: "transparent" as const, color: "transparent" };
const field = "h-[41px] w-full appearance-none rounded-md border border-[#7629fc]/70 bg-[rgba(79,79,79,0.29)] px-4 text-[13px] text-white outline-none focus:border-[#00cfe5]";

export function VsatForm() {
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const [done, setDone] = useState(false);
  const [year, setYear] = useState(""); const [campus, setCampus] = useState(""); const [gender, setGender] = useState("");
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");

  type Session = Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"];
  async function doSubmit(y: string, c: string, g: string, session: Session) {
    setSaving(true); setErr("");
    const { error } = await supabase.rpc("record_vsat_interest", { p_year: y, p_campus: c, p_gender: g });
    if (error) { setErr(error.message); setSaving(false); return; }
    if (session?.user?.email) {
      const { data: p } = await supabase.from("profiles").select("full_name").eq("id", session.user.id).maybeSingle();
      void fetch("/api/vsat/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: session.user.email, name: (p as { full_name?: string })?.full_name, accessToken: session.access_token }) });
    }
    setSaving(false); setDone(true);
  }
  async function submit() {
    if (!year || !campus || !gender) { setErr("Please answer all fields."); return; }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) { try { localStorage.setItem("vsat_pending", JSON.stringify({ year, campus, gender })); } catch {} router.push("/register?next=/vsat"); return; }
    await doSubmit(year, campus, gender, session);
  }
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data } = await supabase.rpc("my_vsat_status");
        if ((data as { registered?: boolean } | null)?.registered) { setDone(true); return; }
        try { const raw = localStorage.getItem("vsat_pending"); if (raw) { const p = JSON.parse(raw); localStorage.removeItem("vsat_pending"); if (p.year && p.campus && p.gender) await doSubmit(p.year, p.campus, p.gender, session); } } catch {}
      }
    })(); // eslint-disable-next-line
  }, [supabase]);

  return (
    <div className="min-h-screen bg-black text-white">
     <div className="relative mx-auto min-h-screen max-w-[1920px] overflow-hidden">
      {/* MOBILE: image in normal flow → content flows BELOW it (consistent on every screen) */}
      <div className="relative z-0 w-full bg-[#0d041c] lg:hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/vsat-if-bg.webp" alt="Vedam campuses" className="block h-auto w-full" />
      </div>
      {/* DESKTOP: absolute band, heading overlaps on top */}
      <div aria-hidden className="absolute inset-x-0 top-0 z-0 hidden h-[46vh] max-h-[532px] min-h-[300px] overflow-hidden bg-[#0d041c] lg:block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/vsat-if-bg.webp" alt="Vedam campuses" className="absolute inset-0 h-full w-full object-cover object-top" />
      </div>

      {/* back arrow (replaces the header) */}
      <button onClick={() => router.back()} aria-label="Back" className="absolute left-6 top-6 z-30 grid h-11 w-11 place-items-center rounded-full border border-white/20 bg-black/40 text-xl text-white backdrop-blur transition hover:bg-white/10 sm:left-10 sm:top-8">←</button>

      {/* ===== CONTENT ===== */}
      <div className="relative z-10 mx-auto max-w-[1920px] px-6 pb-20 sm:px-10 lg:px-[112px]">
        <p className="pt-6 text-[18px] font-medium tracking-wide lg:pt-[84px] lg:text-[20px]">VSAT Interest Form · 2026–27</p>
        <h1 className="mt-2 max-w-[560px] font-[family-name:var(--font-inter)] font-semibold leading-[1.14] tracking-[-3px]" style={{ fontSize: "clamp(32px,4.2vw,60px)" }}>
          <span className="block pb-[0.12em]" style={headGrad}>Register now,</span>
          <span className="block font-[family-name:var(--font-playfair)] italic" style={{ ...headGrad, fontWeight: 400 }}>Start Ahead</span>
        </h1>

        <div className="mt-10 flex flex-col gap-10 lg:mt-8 lg:flex-row lg:items-start lg:justify-between">
          {/* FORM CARD (left, overlaps the band) */}
          <div className="relative w-full max-w-[560px] shrink-0 overflow-hidden rounded-[20px] border-[1.3px] border-[#7629fc] bg-[#121212] p-7 shadow-[1.3px_1.3px_13px_1.3px_rgba(255,255,255,0.4)] sm:p-9 lg:mt-2 lg:w-[560px] lg:px-12 lg:py-9">
            {done ? (
              <div className="py-10 text-center">
                <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full text-3xl text-white" style={{ background: grad }}>✓</div>
                <h2 className="text-2xl font-bold">Your VSAT Interest Form registration is successful.</h2>
                <p className="mx-auto mt-3 max-w-md text-white/70">Stay tuned for more updates.</p>
                <p className="mt-4 text-sm text-[#8fe9f5]">A confirmation mail has been sent to you.</p>
              </div>
            ) : (
              <>
                <h2 className="text-[22px] font-bold tracking-tight sm:text-[29px]">Enter your details</h2>
                <div className="mt-6 space-y-4">
                  <div><label className="mb-2 block text-[15px] font-semibold sm:text-[16px]">Year of passing class 10th*</label>
                    <select className={field} value={year} onChange={(e) => setYear(e.target.value)}><option value="">Select Year</option>{YEARS.map((y) => <option key={y} value={y}>{y}</option>)}</select></div>
                  <div><label className="mb-2 block text-[15px] font-semibold sm:text-[16px]">Campus Preference*</label>
                    <select className={field} value={campus} onChange={(e) => setCampus(e.target.value)}><option value="">Select campus</option>{CAMPUSES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
                  <div><label className="mb-2 block text-[15px] font-semibold sm:text-[16px]">Gender*</label>
                    <select className={field} value={gender} onChange={(e) => setGender(e.target.value)}><option value="">Select</option>{GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}</select></div>
                  {err && <p className="text-sm text-[#ff6a8e]">{err}</p>}
                  <button disabled={saving} onClick={submit} className="flex h-[44px] w-full items-center justify-center gap-2 rounded-md text-[15px] font-medium text-white disabled:opacity-60" style={{ background: grad }}>{saving ? "Submitting…" : "Submit →"}</button>
                </div>
              </>
            )}
          </div>

          {/* BENEFITS (bottom-right, below the band) */}
          <div className="flex w-full max-w-[760px] flex-col gap-4 lg:mt-[113px]">
            <p className="text-[22px] font-medium sm:text-[24px]" style={{ background: "linear-gradient(174deg,#00cfe5 10%,#c200db 51%)", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", color: "transparent" }}>Early registrants get:</p>
            <div className="grid gap-4 sm:grid-cols-3">
              {BENEFITS.map((b) => (
                <div key={b.title} className="rounded-xl border border-[#7629fc]/70 bg-[#121212] p-3 shadow-[0_4px_8px_rgba(84,26,184,0.16)]">
                  <div className="grid h-8 w-8 place-items-center rounded-[9px] border border-[#00cfe5]/50 bg-[#7629fc]/20 text-base">{b.icon}</div>
                  <p className="mt-2 text-[16px] font-semibold leading-tight">{b.title}</p>
                  <p className="mt-1 text-[13px] leading-snug text-[#929292]">{b.desc}</p>
                </div>
              ))}
            </div>
            <div className="h-px w-full" style={{ background: "linear-gradient(90deg,rgba(0,207,229,0.12),rgba(118,41,252,0.42) 55%,rgba(194,0,219,0.12))" }} />
            <div className="flex items-center gap-3 rounded-xl border border-[#7629fc]/60 bg-[rgba(18,18,18,0.92)] px-4 py-3">
              <span className="text-xl">🏆</span>
              <div><p className="text-[15px] font-semibold">No admission commitment required.</p>
                <p className="text-[14px] text-[#b8b8c2]">Submit your interest now and we&apos;ll notify you when the 2027 admission cycle opens.</p></div>
            </div>
          </div>
        </div>
      </div>
     </div>
    </div>
  );
}
