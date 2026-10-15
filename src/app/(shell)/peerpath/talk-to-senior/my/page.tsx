import type { Metadata } from "next";
import { TtsNav } from "@/components/peerpath/tts-nav";
import { MyBookings } from "@/components/peerpath/my-bookings";
import { guardPeerPath } from "@/lib/peerpath/gate";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My bookings — Talk to a Senior · Vedam", robots: { index: false } };

export default async function MyBookingsPage() {
  await guardPeerPath();
  return (
    <>
      <TtsNav />
      <div className="mx-auto max-w-[1240px] px-4 py-6 sm:px-6 lg:py-10">
        <MyBookings />
      </div>
    </>
  );
}
