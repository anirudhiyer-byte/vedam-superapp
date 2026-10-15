import Link from "next/link";
import { notFound } from "next/navigation";
import { TtsNav } from "@/components/peerpath/tts-nav";
import type { Metadata } from "next";
import { SlotPicker } from "@/components/peerpath/slot-picker";
import { AdmissionsNote, Avatar, Rating, seniorFrom, seniorMeta } from "@/components/peerpath/ui";
import { IconBack } from "@/components/peerpath/icons";
import { CAMPUS_INFO, TTS } from "@/lib/peerpath/constants";
import { guardPeerPath } from "@/lib/peerpath/gate";
import { loadSenior } from "@/lib/peerpath/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Senior profile — Talk to a Senior · Vedam" };

function TagList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="pp-eyebrow">{title}</h3>
      <ul className="flex flex-wrap gap-2">
        {items.map((i) => (
          <li key={i} className="pp-tag">
            {i}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function SeniorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ r?: string }> }) {
  await guardPeerPath();
  const { id } = await params;
  const { r } = await searchParams;
  const senior = await loadSenior(id);
  if (!senior) notFound();
  const from = seniorFrom(senior);

  return (
    <>
      <TtsNav />
      <div className="mx-auto max-w-[1240px] px-4 py-6 sm:px-6 lg:py-10">
        <Link href={TTS} className="mb-5 inline-flex min-h-[44px] items-center gap-1.5 text-[15px] font-semibold text-pp-violet-600 hover:text-pp-violet-700">
          <IconBack /> All seniors
        </Link>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_440px] lg:items-start lg:gap-10">
          <section className="pp-card flex flex-col gap-6 p-5 sm:p-7">
            <div className="flex items-center gap-4">
              <Avatar senior={senior} size={72} />
              <div className="flex flex-col gap-1">
                <h1 className="text-[26px] font-bold leading-tight text-pp-heading">{senior.firstName}</h1>
                <p className="text-[15px] text-pp-muted">{seniorMeta(senior)}</p>
                {from && <p className="text-[14px] text-pp-muted">{from}</p>}
                <Rating senior={senior} />
              </div>
            </div>

            {senior.bio && <p className="whitespace-pre-line text-[16px] leading-relaxed text-pp-ink">{senior.bio}</p>}

            <TagList title="Ask me about" items={senior.askMeAbout} />
            <TagList title="Topics" items={senior.topics} />
            <TagList title="Clubs" items={senior.clubs} />
            <TagList title="Speaks" items={senior.languages} />

            <p className="text-[14px] text-pp-muted">
              Studies at the {senior.campus} campus ({CAMPUS_INFO[senior.campus].university}).
            </p>
          </section>

          <aside className="flex flex-col gap-4 lg:sticky lg:top-28">
            <section className="pp-card flex flex-col gap-5 p-5 sm:p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-[19px] font-semibold text-pp-heading">{r ? "Pick a new time" : "Pick a time"}</h2>
                <p className="text-[13px] text-pp-muted">Google Meet · times in IST</p>
              </div>
              <SlotPicker seniorId={senior.id} slots={senior.slots} sessionTypes={senior.sessionTypes} durations={senior.durations} reschedule={r ?? null} />
            </section>
            <AdmissionsNote />
          </aside>
        </div>
      </div>
    </>
  );
}
