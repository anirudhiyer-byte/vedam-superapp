import type { Metadata } from "next";
import { TtsNav } from "@/components/peerpath/tts-nav";
import { SeniorFinder } from "@/components/peerpath/finder/senior-finder";
import { guardPeerPath } from "@/lib/peerpath/gate";
import { loadSeniors } from "@/lib/peerpath/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Talk to a Senior — PeerPath · Vedam",
  description: "Book a free video chat with a current Vedam student. Pick a senior and a time that works for you.",
};

export default async function TalkToSeniorPage() {
  await guardPeerPath();
  const { seniors, ok } = await loadSeniors();
  return (
    <>
      <TtsNav />
      <SeniorFinder seniors={seniors} connected={ok} />
    </>
  );
}
