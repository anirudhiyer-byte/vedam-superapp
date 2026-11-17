/**
 * Instant skeleton for the applicant dashboard. Shown the moment the route is
 * navigated to (and prefetched for this dynamic route), so clicking "Go to dashboard"
 * paints immediately instead of waiting on the server render + data fetch.
 */
export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-[#f6f2fe]">
      <div className="mx-auto max-w-5xl px-5 py-6">
        <div className="h-9 w-40 animate-pulse rounded-lg bg-black/5" />
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <div className="order-2 space-y-4 lg:order-1 lg:col-span-1">
            <div className="h-40 animate-pulse rounded-2xl bg-black/5" />
            <div className="h-28 animate-pulse rounded-2xl bg-black/5" />
          </div>
          <div className="order-1 lg:order-2 lg:col-span-1">
            <div className="h-64 animate-pulse rounded-2xl bg-black/5" />
          </div>
          <div className="order-3 space-y-4 lg:col-span-1">
            <div className="h-28 animate-pulse rounded-2xl bg-black/5" />
            <div className="h-40 animate-pulse rounded-2xl bg-black/5" />
          </div>
        </div>
      </div>
      <span className="sr-only">Loading your dashboard…</span>
    </div>
  );
}
