import type { Metadata } from "next";
import Link from "next/link";
import { TTS } from "@/lib/peerpath/constants";
import { guardPeerPath } from "@/lib/peerpath/gate";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "PeerPath — Vedam",
  description: "Learn from Vedam students who were in your seat a year ago. Book a free video chat with a senior.",
};

const STEPS = [
  { t: "Choose a campus", d: "Pune, Gurugram, or both." },
  { t: "Pick a senior and a time", d: "Filter by topic, language, day and more. Every senior sets their own free times." },
  { t: "Join on Google Meet", d: "A free 15 or 30 minute chat. Then tell us how it went." },
];

const ASK = ["VSAT prep", "The interview", "Classes & curriculum", "Hostel & mess", "Clubs & hackathons", "Moving to a new city"];

export default async function PeerPathPage() {
  await guardPeerPath();
  return (
    <div className="relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(90% 70% at 75% 0%, rgba(118,41,252,0.35), transparent 60%), radial-gradient(60% 50% at 0% 100%, rgba(249,125,3,0.12), transparent 60%)" }} />
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.14]" style={{ backgroundImage: "radial-gradient(rgba(205,165,255,0.6) 1.3px, transparent 1.6px)", backgroundSize: "24px 24px" }} />

      <section className="relative mx-auto flex max-w-[1240px] flex-col gap-6 px-4 pb-12 pt-10 sm:px-6 lg:pb-16 lg:pt-16">
        <span className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-pp-violet-700">PeerPath</span>
        <h1 className="max-w-[18ch] text-[38px] font-bold leading-[1.05] tracking-[-0.02em] text-white sm:text-[56px]">
          Learn from the students who walked this path <span className="text-pp-violet-700">a year ago</span>
        </h1>
        <p className="max-w-[52ch] text-[16px] leading-relaxed text-pp-muted sm:text-[19px]">
          PeerPath connects you with current Vedam students. Ask them anything about VSAT, the interview, classes or campus life, in a free one-to-one video chat.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link href={TTS} className="pp-btn-primary px-8 text-[16px]">
            Talk to a Senior <span aria-hidden>→</span>
          </Link>
          <p className="text-[14px] text-pp-muted">Free · No account needed · Google Meet</p>
        </div>
        <ul className="flex flex-wrap gap-2 pt-2">
          {ASK.map((a) => (
            <li key={a} className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[13px] text-pp-ink">
              {a}
            </li>
          ))}
        </ul>
      </section>

      <section className="relative mx-auto max-w-[1240px] px-4 pb-16 sm:px-6 lg:pb-24">
        <h2 className="mb-5 text-[20px] font-semibold text-white">How it works</h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.t} className="pp-card flex gap-4 p-5">
              <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-pp-violet-500 text-[15px] font-bold text-white">{i + 1}</span>
              <div>
                <h3 className="text-[17px] font-semibold text-white">{s.t}</h3>
                <p className="mt-1 text-[14px] leading-relaxed text-pp-muted">{s.d}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-8 flex flex-col items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[15px] text-pp-ink">Ready? Pick a senior and a time that works for you.</p>
          <Link href={TTS} className="pp-btn-primary">Talk to a Senior →</Link>
        </div>
      </section>
    </div>
  );
}
