"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type Load<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

/**
 * Loads one thing with a real loading / error / retry state (v2).
 * Runs once when the component mounts (mount a fresh component to load again) and again on `reload`.
 * The fetcher is kept in a ref, so passing an inline arrow function does not cause a reload loop.
 */
export function useLoad<T>(fetcher: () => Promise<T>, fallback = "Could not load this. Try again.") {
  const [state, setState] = useState<Load<T>>({ status: "loading" });
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const live = useRef(0);
  const run = useCallback(() => {
    const ticket = ++live.current;
    setState({ status: "loading" });
    fetchRef.current()
      .then((data) => { if (ticket === live.current) setState({ status: "ready", data }); })
      .catch((e: unknown) => { if (ticket === live.current) setState({ status: "error", message: e instanceof Error && e.message ? e.message : fallback }); });
  }, [fallback]);
  // the cleanup must see the *latest* ticket value on purpose: it invalidates any request still in flight
  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { live.current++; };
  }, [run]);
  return { state, reload: run };
}
