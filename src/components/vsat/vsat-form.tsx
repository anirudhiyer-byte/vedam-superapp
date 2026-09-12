"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const YEARS = ["2024", "2025", "2026", "2027", "2028"];
const CAMPUSES = ["Pune — Ajeenkya DY Patil University", "Gurugram — Sushant University", "No preference"];
const GENDERS = ["Male", "Female", "Other", "Prefer not to say"];

const BENEFITS = [
  { icon: "🎟️", title: "Concession on VSAT Fee", desc: "Register early and get a reduced VSAT fee." },
  { icon: "🎓", title: "Higher Scholarship", desc: "Get assessed for higher scholarship brackets first." },
  { icon: "🪑", title: "Limited Early Intake Seats", desc: "Get early access before admissions open to everyone." },
];

const field = "w-full appearance-none rounded-lg border border-[#7629fc]/70 bg-[rgba(79,79,79,0.29)] px-4 py-3 text-[15px] text-white outline-none focus:border-[#00cfe5]";
const grad = "linear-gradient(135deg,#00cfe5 5%,#c200db 96%)";

export function VsatForm() {
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const [done, setDone] = useState(false);
  const [year, setYear] = useState("");
  const [campus, setCampus] = useState("");
  const [gender, setGender] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data } = await supabase.rpc("my_vsat_status");
        if ((data as { registered?: boolean } | null)?.registered) { setDone(true); return; }
        // came back from login/signup with answers filled while logged out → auto-submit
        try {
          const raw = localStorage.getItem("vsat_pending");
          if (raw) {
            const p = JSON.parse(raw) as { year: string; campus: string; gender: string };
            localStorage.removeItem("vsat_pending");
            if (p.year && p.campus && p.gender) { await doSubmit(p.year, p.campus, p.gender, session); return; }
          }
        } catch { /* ignore */ }
      }
    })();
    // eslint-disable-next-line
  }, [supabase]);

  type Session = Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"];
  async function doSubmit(y: string, c: string, g: string, session: Session) {
    setSaving(true); setErr("");
    const { error } = await supabase.rpc("record_vsat_interest", { p_year: y, p_campus: c, p_gender: g });
    if (error) { setErr(error.message); setSaving(false); return; }
    if (session?.user?.email) {
      const { data: p } = await supabase.from("profiles").select("full_name").eq("id", session.user.id).maybeSingle();
      void fetch("/api/vsat/confirm", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: session.user.email, name: (p as { full_name?: string })?.full_name, accessToken: session.access_token }) });
    }
    setSaving(false); setDone(true);
  }

  async function submit() {
    if (!year || !campus || !gender) { setErr("Please answer all fields."); return; }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      // logged out → stash answers, send to signup; we auto-submit on return
      try { localStorage.setItem("vsat_pending", JSON.stringify({ year, campus, gender })); } catch { /* ignore */ }
      router.push("/register?next=/vsat");
      return;
    }
    await doSubmit(year, campus, gender, session);
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      {/* campus images, top-right, angled (Figma) */}
      <div aria-hidden className="pointer-events-none absolute right-0 top-0 z-0 hidden h-[520px] w-[62%] overflow-hidden lg:block" style={{ background: "#0d041c" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/su-vsat.webp" alt="" className="absolute right-0 top-[-50px] h-[560px] w-auto object-cover" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/adypu-vsat.webp" alt="" className="absolute left-0 top-0 h-[520px] w-[62%] object-cover" style={{ clipPath: "polygon(0 0, 78% 0, 55% 100%, 0 100%)" }} />
        <div className="absolute inset-0" style={{ background: "linear-gradient(105deg,#0d041c 30%,rgba(13,4,28,0.2) 60%,transparent)" }} />
      </div>

      <div className="relative z-10 mx-auto max-w-[1600px] px-6 pb-24 pt-12 sm:px-10 lg:px-16">
        <p className="font-[family-name:var(--font-inter)] text-[20px] font-medium tracking-wide">VSAT Interest Form · 2026–27</p>
        <h1 className="mt-3 font-[family-name:var(--font-inter)] font-semibold leading-[1.05] tracking-[-2px]" style={{ fontSize: "clamp(44px,7vw,80px)" }}>
          <span style={{ background: "linear-gradient(138deg,#00cfe5 5%,#c200db 97%)", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", color: "transparent" }}>Register now, </span>
          <span className="font-[family-name:var(--font-playfair)] italic" style={{ background: "linear-gradient(138deg,#00cfe5 5%,#c200db 97%)", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", color: "transparent", fontWeight: 400 }}>Start Ahead</span>
        </h1>

        <div className="mt-8 grid gap-8 lg:grid-cols-[823px_1fr]">
          {/* FORM CARD */}
          <div className="relative overflow-hidden rounded-[20px] border border-[#7629fc] bg-[#121212] p-8 shadow-[1px_1px_13px_1px_rgba(255,255,255,0.4)]">
            {done ? (
              <div className="py-10 text-center">
                <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full text-3xl" style={{ background: grad }}>✓</div>
                <h2 className="font-[family-name:var(--font-inter)] text-2xl font-bold">You have successfully registered for VSAT.</h2>
                <p className="mx-auto mt-3 max-w-md text-white/70">Once we go live with the admissions, you&apos;ll receive updates for the same.</p>
                <p className="mt-4 text-sm text-[#8fe9f5]">For now, a confirmation mail has been sent to you.</p>
              </div>
            ) : (
              <>
                <h2 className="font-[family-name:var(--font-inter)] text-[32px] font-bold tracking-tight">Enter your details</h2>
                <div className="mt-6 space-y-5">
                  <div><label className="mb-2 block text-[18px] font-semibold">Year of passing class 10th*</label>
                    <select className={field} value={year} onChange={(e) => setYear(e.target.value)}><option value="">Select Year</option>{YEARS.map((y) => <option key={y} value={y}>{y}</option>)}</select></div>
                  <div><label className="mb-2 block text-[18px] font-semibold">Campus Preference*</label>
                    <select className={field} value={campus} onChange={(e) => setCampus(e.target.value)}><option value="">Select campus</option>{CAMPUSES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
                  <div><label className="mb-2 block text-[18px] font-semibold">Gender*</label>
                    <select className={field} value={gender} onChange={(e) => setGender(e.target.value)}><option value="">Select</option>{GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}</select></div>
                  {err && <p className="text-sm text-[#ff6a8e]">{err}</p>}
                  <button disabled={saving} onClick={submit} className="flex w-full items-center justify-center gap-2 rounded-lg py-3 text-[18px] font-medium text-white disabled:opacity-60" style={{ background: grad }}>{saving ? "Submitting…" : "Submit →"}</button>
                </div>
              </>
            )}
          </div>

          {/* BENEFITS */}
          <div className="flex flex-col gap-4">
            <p className="text-[24px] font-medium" style={{ background: "linear-gradient(174deg,#00cfe5 10%,#c200db 51%)", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", color: "transparent" }}>Early registrants get:</p>
            <div className="grid gap-4 sm:grid-cols-3">
              {BENEFITS.map((b) => (
                <div key={b.title} className="rounded-xl border border-[#7629fc]/70 bg-[#121212] p-3 shadow-[0_4px_8px_rgba(84,26,184,0.16)]">
                  <div className="grid h-8 w-8 place-items-center rounded-[9px] border border-[#00cfe5]/50 bg-[#7629fc]/20 text-lg">{b.icon}</div>
                  <p className="mt-2 text-[16px] font-semibold">{b.title}</p>
                  <p className="mt-1 text-[13px] text-[#929292]">{b.desc}</p>
                </div>
              ))}
            </div>
            <div className="h-px w-full" style={{ background: "linear-gradient(90deg,rgba(0,207,229,0.12),rgba(118,41,252,0.42) 55%,rgba(194,0,219,0.12))" }} />
            <div className="flex items-center gap-3 rounded-xl border border-[#7629fc]/60 bg-[rgba(18,18,18,0.92)] px-4 py-3">
              <span className="text-xl">🏆</span>
              <div><p className="text-[15.5px] font-semibold">No admission commitment required.</p>
                <p className="text-[14.5px] text-[#b8b8c2]">Submit your interest now and we&apos;ll notify you when the 2027 admission cycle opens.</p></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
