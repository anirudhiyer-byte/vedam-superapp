import { elevateHeaders } from "./sign";

export type ElevateEvent = Record<string, unknown> & { event_id: string; status: string };
export type ElevateResult = { event_id: string; outcome: string; ref?: string; reason?: string };
export type ElevatePostResult = { httpStatus: number; results: ElevateResult[]; raw: unknown; error?: string };

/**
 * POST a batch to Elevate. Signs the EXACT bytes sent. httpStatus 0 = network/timeout
 * (treat as retry). The body is one event object when there's exactly one, else
 * `{ events: [...] }` (guide: 1–100 events, ≤1MB).
 */
export async function postElevate(
  events: ElevateEvent[],
  opts: { url: string; secret: string; timeoutMs?: number },
): Promise<ElevatePostResult> {
  const body = events.length === 1 ? JSON.stringify(events[0]) : JSON.stringify({ events });
  const headers = elevateHeaders(opts.secret, body);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
  try {
    const res = await fetch(opts.url, { method: "POST", headers, body, signal: ctrl.signal });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
    const results =
      json && typeof json === "object" && Array.isArray((json as { results?: unknown }).results)
        ? ((json as { results: ElevateResult[] }).results)
        : [];
    return { httpStatus: res.status, results, raw: json ?? text };
  } catch (e) {
    return { httpStatus: 0, results: [], raw: null, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}
