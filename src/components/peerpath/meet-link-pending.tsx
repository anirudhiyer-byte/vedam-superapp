"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { IconVideo } from "./icons";

const EVERY_MS = 3000;
const MAX_TRIES = 15; // ~45 s; after that the cron finishes it and the senior's own link still works

/**
 * Shown on the booked page while the Google Meet invite is still being created
 * (it now happens after the booking answer). Re-reads the page every few seconds;
 * the server swaps this for the real "Join Google Meet" button once it's ready.
 */
export function MeetLinkPending() {
  const router = useRouter();
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (tries >= MAX_TRIES) return;
    const t = setTimeout(() => {
      router.refresh();
      setTries((n) => n + 1);
    }, EVERY_MS);
    return () => clearTimeout(t);
  }, [router, tries]);

  return (
    <p role="status" aria-live="polite" className="flex flex-1 items-center gap-2 rounded-xl bg-pp-violet-50 px-4 py-3 text-[14px] text-pp-heading">
      <IconVideo className="h-5 w-5 text-pp-violet-600" />
      {tries < MAX_TRIES
        ? "Preparing your Meet link… This takes a few seconds."
        : "Your Meet link is taking longer than usual. Please refresh this page in a minute."}
    </p>
  );
}
