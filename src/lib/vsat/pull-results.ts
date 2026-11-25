/**
 * Pull every student's real-exam Wheebox result for one VSAT (POST /api/vsat/exam/bulk-pull-result, admins only).
 * The route does up to ~40 students per call, so this runs passes until nothing new comes in. Shared by
 * Exam Center → Exam dates and the Exam Evaluation page (0172) so both behave and read the same.
 */

/** One pass of the route (the fields this loop reads). */
export type PullPass = { ok?: boolean; code?: string; total?: number; pulled?: number; remaining?: number };

export function pullErrorText(code: string | undefined): string {
  if (code === "WHEEBOX_NOT_CONFIGURED") return "Wheebox isn't connected (set the env keys in the Exam Center).";
  if (code === "FORBIDDEN") return "Admins only.";
  if (code === "DATE_UNAVAILABLE") return "This date has no Wheebox test ID.";
  return "Couldn't pull results.";
}

/**
 * Runs passes until done and returns the final message. `pass` makes one request; `onProgress` gets the running text.
 * Keeps going only while each pass stores new results: a pass that pulls nothing but still has "remaining" means those
 * students have no result to fetch yet (not submitted), so it stops there.
 */
export async function pullVsatResults(label: string, pass: () => Promise<PullPass>, onProgress?: (msg: string) => void,
                                      maxPasses = 200): Promise<string> {
  let pulled = 0;
  try {
    for (let guard = 0; guard < maxPasses; guard++) {
      const d = await pass();
      if (!d?.ok) return pullErrorText(d?.code);
      pulled += d.pulled || 0;
      if (d.total === 0) return `${label}: no applicants are assigned to this VSAT yet.`;
      if (d.remaining && (d.pulled ?? 0) > 0) { onProgress?.(`Pulling results for ${label}: ${pulled} done, ${d.remaining} to go…`); continue; }
      const left = d.remaining || 0;
      return `${label}: pulled ${pulled} result${pulled === 1 ? "" : "s"}${left ? `. ${left} still have no result (not submitted yet) — run again later.` : ". ✓"}`;
    }
    return `${label}: pulled ${pulled} result${pulled === 1 ? "" : "s"} — stopped after ${maxPasses} passes, run again to continue.`;
  } catch {
    return "Couldn’t reach the server while pulling results.";
  }
}

/** One real pass against the route (browser: same-origin cookie session). */
export async function pullPassFetch(examDateId: string): Promise<PullPass> {
  const res = await fetch("/api/vsat/exam/bulk-pull-result", {
    method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
    body: JSON.stringify({ exam_date_id: examDateId }),
  });
  return (await res.json().catch(() => ({}))) as PullPass;
}
