import Link from "next/link";
import { TTS, ttsPath } from "@/lib/peerpath/constants";

/**
 * Shown when a booking page can't show the booking: it doesn't exist, or it
 * belongs to a different login. Both look exactly the same, so a link alone
 * reveals nothing about someone else's chat.
 */
export function BookingNotFound() {
  return (
    <div className="mx-auto flex max-w-[480px] flex-col gap-5 px-4 py-12 text-center sm:px-6">
      <h1 className="text-[24px] font-bold text-pp-heading">We couldn&apos;t find this chat</h1>
      <p className="text-[15px] text-pp-muted">
        The link may be old, or the chat was booked from a different account. Log in with the account you booked with, then open it from My bookings.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Link href={ttsPath.my} className="pp-btn-primary">
          My bookings
        </Link>
        <Link href={TTS} className="pp-btn-secondary">
          Find a senior
        </Link>
      </div>
    </div>
  );
}
