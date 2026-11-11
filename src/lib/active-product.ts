/**
 * Which product a page belongs to, for the active-time heartbeat (components/active-heartbeat.tsx).
 * Seconds spent on these pages count toward that product in product_active_daily
 * (DAU/WAU/MAU = 5+ minutes a day; Bootcamp = 2+ minutes, migration 0078). Every visible second also counts toward "site".
 * The server only accepts the products listed here (track_active_ping, migration 0063).
 */
export type ActiveProduct = "codesprint" | "bootcamp" | "pyq" | "cp" | "vsat" | "peerpath";

export function productFor(path: string | null | undefined): ActiveProduct | null {
  if (!path) return null;
  if (path.startsWith("/codesprint")) return "codesprint";
  if (path.startsWith("/events") || path.startsWith("/e/")) return "bootcamp";
  if (path.startsWith("/pyq")) return "pyq";
  if (path.startsWith("/predict") || path.startsWith("/college-predictor")) return "cp";
  if (path.startsWith("/apply")) return "vsat"; // VSAT early registration
  if (path.startsWith("/peerpath")) return "peerpath"; // Talk to a Senior
  return null;
}
