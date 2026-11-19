"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AdsListing, InfluencerListing } from "./listing";
import { AdsPerformance, InfluencerPerformance } from "./performance";
import { CSS, Err, useMeta } from "./shared";

/**
 * Growth → Marketing Channels → Ads / Influencers.
 * Every read and write goes through the admin-checked RPCs of migration 0105; the browser has no table access.
 */
export type MarketingPage = "listing" | "perf";

export function MarketingPanel({ channel, page }: { channel: "ads" | "influencers"; page: MarketingPage }) {
  const [sb] = useState(() => createClient());
  const { meta, err, reload } = useMeta(sb);
  return (
    <div className="mk-wrap">
      <style>{CSS}</style>
      <Err msg={err} />
      {!meta ? (!err && <p className="mk-mid">Loading…</p>) : channel === "ads" ? (
        page === "perf" ? <AdsPerformance sb={sb} meta={meta} /> : <AdsListing sb={sb} meta={meta} reloadMeta={reload} />
      ) : (
        page === "perf" ? <InfluencerPerformance sb={sb} meta={meta} /> : <InfluencerListing sb={sb} meta={meta} reloadMeta={reload} />
      )}
    </div>
  );
}
