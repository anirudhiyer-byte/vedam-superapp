/**
 * Elevate outbox — pure retry/outcome logic (no IO, unit-tested).
 *
 * Retry on 503 / other 5xx / timeout / network error, with backoff
 * (1m, 5m, 30m, 2h), re-signing each attempt but keeping the same body and
 * event_id. Never retry a 200 result. A `held` event_id isn't kept by Elevate,
 * so a corrected event may reuse it.
 */
export const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000] as const; // 1m,5m,30m,2h

/** Given attempts already made, decide the next retry. Past the schedule → dead. */
export function nextRetry(attemptsSoFar: number): { dead: boolean; delayMs: number } {
  if (attemptsSoFar >= BACKOFF_MS.length) return { dead: true, delayMs: 0 };
  return { dead: false, delayMs: BACKOFF_MS[attemptsSoFar] };
}

export type OutboxState = "pending" | "sent" | "held" | "rejected" | "dead";

/** Map a per-event outcome (from a 200 body) to the terminal outbox state. */
export function stateForOutcome(outcome: string): OutboxState {
  switch (outcome) {
    case "applied":
    case "quiet":
    case "duplicate":
    case "older":
    case "older_step":
    case "ignored":
    case "test":
      return "sent";
    case "held":
      return "held"; // Elevate's team links it; don't auto-retry
    case "rejected":
      return "rejected"; // needs a corrected event; don't auto-retry
    default:
      return "sent"; // unknown but 200 → treat as handled, don't loop
  }
}

/** Classify an HTTP status: ok (parse body), retry (temporary), or fatal (needs a fix). */
export function classifyHttp(status: number): "ok" | "retry" | "fatal" {
  if (status === 200) return "ok";
  if (status === 503 || (status >= 500 && status < 600)) return "retry";
  return "fatal"; // 400/401/404/413 — bad body, signature, brand, or too big
}
