"use client";

import { useCallback, useEffect, useState } from "react";
import type { Option } from "../lib/types";

export type OptionsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; options: Record<string, Option[]> };

/** Filter dropdown options for any screen, with a real loading / error / retry state (v2). */
export function useOptions(fetcher: () => Promise<Record<string, Option[]>>) {
  const [state, setState] = useState<OptionsState>({ status: "loading" });
  const load = useCallback(() => {
    setState({ status: "loading" });
    fetcher()
      .then((options) => setState({ status: "ready", options }))
      .catch((e: unknown) => setState({ status: "error", message: e instanceof Error && e.message ? e.message : "Could not load the filter options." }));
  }, [fetcher]);
  useEffect(load, [load]);
  return { state, reload: load, options: state.status === "ready" ? state.options : ({} as Record<string, Option[]>) };
}
