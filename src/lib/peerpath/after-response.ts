/**
 * PeerPath · run work AFTER the response is sent (server only).
 *
 * In a request, Next.js `after()` keeps the function alive (Vercel waitUntil) until
 * the task finishes, so the user gets their answer without waiting for Google.
 * Outside a request scope (unit tests, scripts) `after()` throws; then the task just
 * starts right away. Errors never escape: the cron retries anything left over.
 */
import { after } from "next/server";

export function afterResponse(task: () => Promise<unknown>): void {
  const safe = () => task().catch(() => undefined);
  try {
    after(safe);
  } catch {
    void safe();
  }
}
