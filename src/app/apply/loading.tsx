/**
 * Instant skeleton for the VSAT apply landing. Paints the moment the route is
 * navigated to (and is what Next prefetches for this dynamic route), so clicking
 * "← Back" from the dashboard feels immediate instead of a blank wait while the
 * server renders and the designed page loads.
 */
export default function ApplyLoading() {
  return (
    <div className="grid min-h-screen place-items-center bg-white">
      <div className="flex flex-col items-center gap-4">
        <span
          className="h-10 w-10 animate-spin rounded-full border-[3px] border-[#ece8f6] border-t-[#8a18ff]"
          aria-hidden
        />
        <p className="font-body text-sm text-[#6b647e]">Loading…</p>
      </div>
    </div>
  );
}
