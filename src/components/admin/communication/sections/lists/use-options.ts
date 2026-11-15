"use client";

import { useCallback, useEffect, useState } from "react";
import { listsApi } from "../../lib/mock-api";
import type { Option } from "../../lib/types";

export type OptionsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; options: Record<string, Option[]> };

/** Filter + owner dropdown options for Manage List, with a real loading / error / retry state. */
export function useListOptions() {
  const [state, setState] = useState<OptionsState>({ status: "loading" });
  const load = useCallback(() => {
    setState({ status: "loading" });
    listsApi.options()
      .then((options) => setState({ status: "ready", options }))
      .catch((e: unknown) => setState({ status: "error", message: e instanceof Error ? e.message : "Could not load the filter options." }));
  }, []);
  useEffect(load, [load]);
  return { state, reload: load, options: state.status === "ready" ? state.options : ({} as Record<string, Option[]>) };
}
