import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TtsNav } from "@/components/peerpath/tts-nav";
import { MyBookings } from "@/components/peerpath/my-bookings";
import { guardPeerPath } from "@/lib/peerpath/gate";
import { getSessionUser, loadMyBookings } from "@/lib/peerpath/server";
import { PEERPATH_LINKS, ttsPath } from "@/lib/peerpath/constants";
import { withReturn } from "@/lib/peerpath/booking-codes";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My bookings — Talk to a Senior · Vedam", robots: { index: false } };

export default async function MyBookingsPage() {
  await guardPeerPath();
  if (!(await getSessionUser())) redirect(withReturn(PEERPATH_LINKS.login, ttsPath.my));
  const list = await loadMyBookings();
  return (
    <>
      <TtsNav />
      <div className="mx-auto max-w-[1240px] px-4 py-6 sm:px-6 lg:py-10">
        <MyBookings list={list} />
      </div>
    </>
  );
}
