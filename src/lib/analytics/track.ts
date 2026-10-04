import posthog from "posthog-js";
/** Fire a named funnel event to PostHog. No-op if PostHog isn't initialized (no key). */
export function track(event: string, props?: Record<string, unknown>) {
  try { posthog.capture(event, props); } catch { /* */ }
}
