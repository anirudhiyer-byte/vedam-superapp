import type { Metadata } from "next";
import { TtsNav } from "@/components/peerpath/tts-nav";
import { JoinAsSenior } from "@/components/peerpath/senior/join";

export const metadata: Metadata = { title: "Become a senior — Talk to a Senior · Vedam" };

export default function BecomeASeniorPage() {
  return (
    <>
      <TtsNav label="Become a senior" />
      <div className="mx-auto max-w-[1040px] px-4 py-6 sm:px-6 lg:py-10">
        <JoinAsSenior />
      </div>
    </>
  );
}
