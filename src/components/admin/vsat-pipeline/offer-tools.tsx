"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cx, vx } from "@/components/admin/ui/vx";
import { errorText } from "@/lib/vsat/pipeline";
import {
  OFFER_DAYS_ERROR, OFFER_DAYS_MAX, OFFER_DAYS_MIN, RELEASE_MAX, deadlineText, parseOfferDays, releaseParams, nothingToReleaseText, offerState, parseRelease, pctText, previewText, releaseResultText,
  type OfferInfo, type OfferTone, type ReleaseResult,
} from "@/lib/vsat/offers";

/**
 * Offers (0144). Releasing = moving the student to Offer sent; the database fills the offer the payment
 * gate reads (deadline = campus "Days to pay", until 11:59 pm IST) and queues the offer email. These
 * controls only preview, confirm and show the result; the database checks everyone again.
 * 0180: an optional "Days to pay" box sets this release's validity (empty = the campus default).
 */

/** The optional "Days to pay" box (0180). It is hidden while the confirm shows, and the confirm sends the days it was previewed with. */
function DaysToPay({ value, onChange, disabled, small }: { value: string; onChange: (v: string) => void; disabled: boolean; small?: boolean }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-vx-faint">
      Days to pay
      <input type="text" inputMode="numeric" maxLength={3} value={value} disabled={disabled}
        onChange={(e) => onChange(e.target.value)} placeholder="Campus default" aria-label="Days to pay (empty = campus default)"
        title={`Whole number ${OFFER_DAYS_MIN}–${OFFER_DAYS_MAX}. Leave empty to use the campus "Days to pay" from VSAT settings.`}
        className={cx(vx.field, small ? "h-8 w-32 text-[13px]" : "w-32")} />
    </label>
  );
}

/** Send the queued offer emails now (the cron does it anyway within 10 minutes). Never throws. */
export async function sendOfferEmailsNow(ids: string[]): Promise<boolean> {
  if (!ids.length) return true;
  try {
    const res = await fetch("/api/vsat/offers/notify", {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ application_ids: ids.slice(0, RELEASE_MAX) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export type OfferMessage = { text: string; ok: boolean };

/** Counselling panel selection bar: Release offer → preview (who, deadline, who is left out) → Yes, release. */
export function OfferBar({ ids, onDone, onReleased }: { ids: string[]; onDone: () => void; onReleased: (m: OfferMessage) => void }) {
  const [supabase] = useState(() => createClient());
  const [preview, setPreview] = useState<ReleaseResult | null>(null);
  const [busy, setBusy] = useState<"" | "check" | "release">("");
  const [msg, setMsg] = useState("");
  const [daysText, setDaysText] = useState("");
  const [previewDays, setPreviewDays] = useState<number | null>(null);
  const tooMany = ids.length > RELEASE_MAX;
  const idsKey = ids.join("\n");
  useEffect(() => { setPreview(null); setMsg(""); }, [idsKey]);   // a different selection needs a fresh preview

  async function check() {
    const d = parseOfferDays(daysText);
    if (!d.ok) return setMsg(OFFER_DAYS_ERROR);
    setBusy("check"); setMsg("");
    const { data, error } = await supabase.rpc("vsat_offers_release", { p: releaseParams(ids, d.days, true) });
    setBusy("");
    if (error) return setMsg(errorText(error.message));
    const r = parseRelease(data);
    if (!r.released.length) return setMsg(nothingToReleaseText(r));
    setPreviewDays(d.days);
    setPreview(r);
  }

  async function release() {
    if (!preview) return;
    setBusy("release"); setMsg("");
    const toRelease = preview.released.map((x) => x.application_id);
    const { data, error } = await supabase.rpc("vsat_offers_release", { p: releaseParams(toRelease, previewDays, false) });
    setPreview(null);
    if (error) { setBusy(""); setMsg(errorText(error.message)); return; }
    const r = parseRelease(data);
    onReleased({ text: releaseResultText(r), ok: r.skipped.length === 0 && r.released.length > 0 });
    setDaysText("");
    onDone();
    await sendOfferEmailsNow(r.released.map((x) => x.application_id));
    setBusy("");
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-vx-violet/20 pb-2">
      {preview ? (
        <>
          <span className="text-sm text-vx-ink">{previewText(preview)}</span>
          <button className={cx(vx.btn, vx.primary)} disabled={busy !== ""} onClick={() => void release()}>{busy === "release" ? "Releasing…" : "Yes, release"}</button>
          <button className={cx(vx.btn, vx.secondary)} disabled={busy !== ""} onClick={() => setPreview(null)}>Back</button>
        </>
      ) : (
        <>
          <DaysToPay value={daysText} onChange={setDaysText} disabled={busy !== ""} />
          <button className={cx(vx.btn, vx.primary)} disabled={busy !== "" || tooMany} onClick={() => void check()}
            title={tooMany ? `At most ${RELEASE_MAX} at a time` : undefined}>
            {busy === "check" ? "Checking…" : "Release offer"}
          </button>
          <span className="text-xs text-vx-faint">For students at Counselled. Each gets an email with their scholarship and a deadline to pay.</span>
          {tooMany && <span className="text-xs text-vx-orange-t">At most {RELEASE_MAX} at a time.</span>}
        </>
      )}
      {msg && <p role="status" className="w-full text-sm text-vx-ink">{msg}</p>}
    </div>
  );
}

const TONE: Record<OfferTone, string> = {
  neutral: "text-vx-faint", green: "text-vx-green", orange: "text-vx-orange-t", red: "text-vx-red",
};

/** Drawer: the offer (scholarship, released, deadline, state) and, at Counselled, a Release button. */
export function OfferBox({ applicationId, stage, status, offer, canManage, onDone }:
  { applicationId: string; stage: string; status: string; offer: OfferInfo | null; canManage: boolean; onDone: () => void }) {
  const [supabase] = useState(() => createClient());
  const [confirm, setConfirm] = useState<ReleaseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [daysText, setDaysText] = useState("");
  const [confirmDays, setConfirmDays] = useState<number | null>(null);
  const st = offerState(stage, offer);
  const canRelease = canManage && stage === "counselled" && status === "active";

  async function check() {
    const d = parseOfferDays(daysText);
    if (!d.ok) return setMsg(OFFER_DAYS_ERROR);
    setBusy(true); setMsg("");
    const { data, error } = await supabase.rpc("vsat_offers_release", { p: releaseParams([applicationId], d.days, true) });
    setBusy(false);
    if (error) return setMsg(errorText(error.message));
    const r = parseRelease(data);
    if (!r.released.length) return setMsg(nothingToReleaseText(r));
    setConfirmDays(d.days);
    setConfirm(r);
  }
  async function release() {
    setBusy(true); setMsg("");
    const { data, error } = await supabase.rpc("vsat_offers_release", { p: releaseParams([applicationId], confirmDays, false) });
    setConfirm(null);
    if (error) { setBusy(false); return setMsg(errorText(error.message)); }
    const r = parseRelease(data);
    setMsg(releaseResultText(r));
    if (r.released.length) { await sendOfferEmailsNow([applicationId]); onDone(); }
    setBusy(false);
  }

  return (
    <div className="space-y-2 rounded-lg border border-vx-line p-3">
      <p className="text-xs font-semibold text-vx-faint">Offer</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-vx-faint">Scholarship</dt><dd>{offer?.scholarship_pct != null ? `${pctText(offer.scholarship_pct)}%` : "—"}</dd></div>
        <div><dt className="text-xs text-vx-faint">Released</dt><dd>{offer?.released_at ? deadlineText(offer.released_at) : "—"}</dd></div>
        <div><dt className="text-xs text-vx-faint">Pay by</dt><dd>{offer?.expires_at ? deadlineText(offer.expires_at) : "—"}</dd></div>
        <div><dt className="text-xs text-vx-faint">State</dt><dd className={TONE[st.tone]}>{st.label}</dd></div>
      </dl>
      {canRelease && !confirm && (
        <div className="flex flex-wrap items-center gap-2">
          <DaysToPay value={daysText} onChange={setDaysText} disabled={busy} small />
          <button className={cx(vx.btn, vx.primary, vx.sm)} disabled={busy} onClick={() => void check()}>{busy ? "Checking…" : "Release offer"}</button>
        </div>
      )}
      {offer?.released_at && (
        <a className={cx(vx.btn, vx.secondary, vx.sm, "inline-flex")} href={`/api/vsat/offer-letter?application_id=${encodeURIComponent(applicationId)}`}>
          Download Acceptance Letter (PDF)
        </a>
      )}
      {confirm && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">{previewText(confirm)}</span>
          <button className={cx(vx.btn, vx.primary, vx.sm)} disabled={busy} onClick={() => void release()}>{busy ? "Releasing…" : "Yes, release"}</button>
          <button className={cx(vx.btn, vx.secondary, vx.sm)} disabled={busy} onClick={() => setConfirm(null)}>Back</button>
        </div>
      )}
      {stage === "offer_lapsed" && canManage && (
        <p className="text-xs text-vx-faint">To give more time: Move stage → Offer sent with a reason. That issues the offer again with a new deadline and a new email.</p>
      )}
      {msg && <p role="status" className="text-sm text-vx-ink">{msg}</p>}
    </div>
  );
}
