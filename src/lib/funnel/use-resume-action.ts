"use client";
import { useEffect, useRef } from "react";
import { takeAction, type PendingAction } from "./pending-action";

/**
 * On mount, if there's a pending action stashed (from before login/signup/profile
 * completion), fire the handler. Runs once. Handler decides what to do per kind.
 */
export function useResumeAction(handler: (a: PendingAction) => void | Promise<void>, ready = true) {
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current) return;
    const a = takeAction();
    if (a) { done.current = true; void handler(a); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
}
