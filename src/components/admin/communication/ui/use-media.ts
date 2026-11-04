"use client";

import { useSyncExternalStore } from "react";

/** True while the viewport matches `query`. Server render and first paint assume a wide screen. */
export function useMedia(query: string, serverValue = true) {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

/** Phones: below Tailwind's `md` (768px). */
export const useIsPhone = () => !useMedia("(min-width: 768px)");
