/**
 * Third-party resilience: timeout + retry (exp backoff) + a simple circuit breaker.
 * Wrap any external call so a vendor blip (Zoom/MSG91/email) can't hang or break the flow.
 */
type Opts = { timeoutMs?: number; retries?: number; backoffMs?: number; breakerKey?: string };

const breakers = new Map<string, { failures: number; openUntil: number }>();
const BREAKER_THRESHOLD = 5;      // consecutive failures before opening
const BREAKER_COOLDOWN = 30_000;  // 30s open before a trial request

export async function withResilience<T>(fn: (signal: AbortSignal) => Promise<T>, opts: Opts = {}): Promise<T> {
  const { timeoutMs = 8000, retries = 2, backoffMs = 400, breakerKey } = opts;

  if (breakerKey) {
    const b = breakers.get(breakerKey);
    if (b && b.openUntil > Date.now()) throw new Error(`circuit_open:${breakerKey}`);
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const out = await fn(ctrl.signal);
      clearTimeout(t);
      if (breakerKey) breakers.delete(breakerKey);   // success resets the breaker
      return out;
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (attempt < retries) await new Promise((r) => setTimeout(r, backoffMs * Math.pow(2, attempt)));
    }
  }
  if (breakerKey) {
    const b = breakers.get(breakerKey) ?? { failures: 0, openUntil: 0 };
    b.failures += 1;
    if (b.failures >= BREAKER_THRESHOLD) { b.openUntil = Date.now() + BREAKER_COOLDOWN; b.failures = 0; }
    breakers.set(breakerKey, b);
  }
  throw lastErr;
}

/** fetch() wrapped with resilience. Non-2xx is treated as a failure (so it retries/breaks). */
export async function fetchResilient(url: string, init: RequestInit = {}, opts: Opts = {}): Promise<Response> {
  return withResilience(async (signal) => {
    const res = await fetch(url, { ...init, signal });
    if (!res.ok && res.status >= 500) throw new Error(`http_${res.status}`);  // retry 5xx; pass 4xx through
    return res;
  }, { breakerKey: opts.breakerKey ?? new URL(url).host, ...opts });
}
