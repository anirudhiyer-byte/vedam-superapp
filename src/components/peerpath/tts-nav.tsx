"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TTS, ttsPath } from "@/lib/peerpath/constants";

const LINKS = [
  { href: TTS, label: "Find a senior", match: (p: string) => p === TTS || p.startsWith(`${TTS}/seniors`) || p.startsWith(`${TTS}/book`) },
  { href: ttsPath.my, label: "My bookings", match: (p: string) => p.startsWith(ttsPath.my) || p.startsWith(`${TTS}/booked`) || p.startsWith(`${TTS}/feedback`) },
  { href: ttsPath.guidelines, label: "Guidelines", match: (p: string) => p.startsWith(ttsPath.guidelines) },
];

/** Second-level bar shared by every Talk to a Senior screen. */
export function TtsNav({ label }: { label?: string }) {
  const path = usePathname() ?? "";
  return (
    <div className="border-b border-pp-line bg-black/60 backdrop-blur">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px] text-pp-muted">
          <Link href="/peerpath" className="hover:text-white">PeerPath</Link>
          <span aria-hidden>/</span>
          <Link href={TTS} className="font-semibold text-white hover:text-pp-violet-700">Talk to a Senior</Link>
          {label && (
            <>
              <span aria-hidden>/</span>
              <span className="truncate">{label}</span>
            </>
          )}
        </nav>
        {!label && (
          <nav aria-label="Talk to a Senior" className="-mx-1 flex gap-1 overflow-x-auto">
            {LINKS.map((l) => {
              const on = l.match(path);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={on ? "page" : undefined}
                  className={`flex-none rounded-full px-3 py-1.5 text-[13px] font-semibold transition ${on ? "bg-pp-violet-500 text-white" : "text-pp-ink hover:bg-white/10"}`}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>
        )}
      </div>
    </div>
  );
}
