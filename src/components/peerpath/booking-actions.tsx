"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cancelBooking, rememberBooking } from "@/lib/peerpath/client";
import { ttsPath } from "@/lib/peerpath/constants";

export function CancelBooking({ bookingId, seniorId, canCancel }: { bookingId: string; seniorId: string; canCancel: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setError(null);
    const res = await cancelBooking(bookingId);
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    router.refresh();
  }

  if (!canCancel) {
    return <p className="text-center text-[14px] text-pp-muted">This chat starts in less than 3 hours, so it can no longer be cancelled here.</p>;
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {confirming ? (
        <div className="flex w-full flex-col gap-3 rounded-xl border border-pp-line p-4 text-center">
          <p className="text-[15px] text-pp-ink">Cancel this chat? The time will open up for another student.</p>
          <div className="flex gap-3">
            <button type="button" className="pp-btn-secondary flex-1" onClick={() => setConfirming(false)} disabled={busy}>
              Keep it
            </button>
            <button type="button" className="pp-btn-primary flex-1 bg-[#B42318] hover:bg-[#912018]" onClick={cancel} disabled={busy}>
              {busy ? "Cancelling…" : "Yes, cancel"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-6 text-[15px]">
          <Link href={ttsPath.senior(seniorId, bookingId)} className="font-semibold text-pp-violet-600 hover:text-pp-violet-700">
            Change time
          </Link>
          <button type="button" className="font-semibold text-[#FF7A6E] hover:underline" onClick={() => setConfirming(true)}>
            Cancel chat
          </button>
        </div>
      )}
      {error && <p role="alert" className="text-[14px] text-[#FF7A6E]">{error}</p>}
    </div>
  );
}

/** Keeps this booking in "My bookings" on this device. */
export function RememberBooking({ id }: { id: string }) {
  useEffect(() => {
    rememberBooking(id);
  }, [id]);
  return null;
}
