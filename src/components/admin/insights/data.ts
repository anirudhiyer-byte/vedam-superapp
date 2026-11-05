"use client";

/* Types of the ins_* RPC results (migration 0062) and a tiny fetch hook. */

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type Overview = {
  visitors: number; attempted: number; registered: number; partial: number; full: number; mqr: number;
  used_product: number; vsat_early: number; vsat_early_mqr: number; vsat_early_in_period: number;
  vsat_paid_in_period: number | null;
};
export type ProductRow = {
  product: "codesprint" | "bootcamp" | "pyq" | "cp" | "vsat";
  visitors: number; users: number; new_users: number; full: number; mqr: number; vsat_early: number; multi: number;
  step1: number; step2: number; step3: number; spend_all_time: number;
};
export type SourceRow = { source: string; users: number; full: number; mqr: number; vsat_early: number; multi: number; spend_all_time: number | null };
export type StateRow = { state: string; users: number; mqr: number; vsat_early: number; multi: number };
export type Cross = {
  cohort: number; vsat: number;
  by_count: { n: number; users: number; vsat: number }[];
  pairs: { a: string; b: string; users: number; vsat: number }[];
  products: { product: string; users: number; multi: number; vsat: number }[];
  paths: { from: string; to: string; users: number }[];
  levels: { level: "low" | "medium" | "high"; users: number; vsat: number }[];
  before_vsat: { product: string; users: number }[];
};
export type ActiveRow = { product: string; dau: number; dau_prev: number; wau: number; wau_prev: number; mau: number; mau_prev: number; tracked_since: string | null };
export type Active = { today: string; products: ActiveRow[]; trend: { day: string; product: string; dau: number }[] };

/** Filter for the people drawer (arguments of ins_people) + a title for the drawer. */
export type PeopleFilter = {
  title: string; sub?: string;
  p_from: string | null; p_to: string | null;
  p_products?: string[] | null; p_min_products?: number | null; p_level?: string | null;
  p_source?: string | null; p_state?: string | null; p_vsat?: boolean | null;
};

let client: ReturnType<typeof createClient> | null = null;
export const sb = () => (client ??= createClient());

/** Call one RPC; re-runs when the arguments change (compared as JSON). */
export function useRpc<T>(fn: string, args: Record<string, unknown> | null) {
  const key = args ? JSON.stringify(args) : null;
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean; key: string | null }>({ data: null, error: null, loading: true, key: null });
  useEffect(() => {
    if (key == null) return;
    let active = true;
    (async () => {
      setState((s) => ({ ...s, loading: true, error: null }));
      const { data, error } = await sb().rpc(fn, JSON.parse(key));
      if (active) setState({ data: (data as T) ?? null, error: error ? error.message : null, loading: false, key });
    })();
    return () => { active = false; };
  }, [fn, key]);
  return state;
}
