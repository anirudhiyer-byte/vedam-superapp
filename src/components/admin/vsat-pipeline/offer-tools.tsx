"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cx, vx } from "@/components/admin/ui/vx";
import { errorText } from "@/lib/vsat/pipeline";
import {
  EXTEND_DAYS_ERROR, EXTEND_DAYS_MAX, EXTEND_DAYS_MIN, EXTEND_REASON_ERROR, EXTEND_REASON_MAX,
  OFFER_DAYS_ERROR, OFFER_DAYS_MAX, OFFER_DAYS_MIN, RELEASE_MAX, deadlineText, extendParams, extendResultText, extendedDeadline,
  parseExtendDays, parseExtendReason, parseOfferDays, releaseParams, nothingToReleaseText, offerState, parseRelease, pctText, previewText, releaseResultText,
  type OfferInfo, type OfferTone, type ReleaseResult,
} from "@/lib/vsat/offers";

/**
 * Offers (0144). Releasing = moving the student to Offer sent; the database fills the offer the payment
 * gate reads (deadline = campus "Days to pay", until 11:59 pm IST) and queues the offer email. These
 * controls only preview, confirm and show the result; the database checks everyone again.
 * 0180: an optional "Days to pay" box sets this release's validity (empty = the campus default).
 * 0189 (sir): an offer can be released once counselling is Done (the database checks the Status and the saved form);
 * "Extend last date" (the sheet's "OL Date Increase") moves one live offer's last date on by N days, with a reason.
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

/** Drawer: the offer (scholarship, released, deadline, state), a Release button once counselling is Done, and Extend last date. */
export function OfferBox({ applicationId, stage, status, offer, canManage, onDone }:
  { applicationId: string; stage: string; status: string; offer: OfferInfo | null; canManage: boolean; onDone: () => void }) {
  const [supabase] = useState(() => createClient());
  const [confirm, setConfirm] = useState<ReleaseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [daysText, setDaysText] = useState("");
  const [confirmDays, setConfirmDays] = useState<number | null>(null);
  const st = offerState(stage, offer);
  // 0189: at Counselled, or at Counselling scheduled once the counselling is marked Done (the preview says if it isn't)
  const canRelease = canManage && (stage === "counselled" || stage === "counselling_scheduled") && status === "active";
  const live = stage === "offer_sent" && status === "active" && !!offer?.released_at && !!offer?.expires_at && Date.parse(offer.expires_at) > Date.now();
  const canExtend = canManage && live;

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
      {canExtend && <ExtendOffer applicationId={applicationId} expiresAt={offer?.expires_at ?? null} onDone={onDone} />}
      {stage === "offer_lapsed" && canManage && (
        <p className="text-xs text-vx-faint">To give more time: Move stage → Offer sent with a reason. That issues the offer again with a new deadline and a new email.</p>
      )}
      {msg && <p role="status" className="text-sm text-vx-ink">{msg}</p>}
    </div>
  );
}

/**
 * "Extend last date" (0189, the sheet's "OL Date Increase"): days to add (1–90) and a reason → a confirm line with the
 * new last date → vsat_offer_extend. No email goes to the student (sir: only the reminders are emailed); the dashboard,
 * the letter, the payment gate, the auto-lapse and the reminders follow the new date.
 */
function ExtendOffer({ applicationId, expiresAt, onDone }: { applicationId: string; expiresAt: string | null; onDone: () => void }) {
  const [supabase] = useState(() => createClient());
  const [open, setOpen] = useState(false);
  const [daysText, setDaysText] = useState("");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState<{ days: number; reason: string; to: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  function check() {
    const d = parseExtendDays(daysText);
    if (!d.ok) return setMsg(EXTEND_DAYS_ERROR);
    const r = parseExtendReason(reason);
    if (!r.ok) return setMsg(EXTEND_REASON_ERROR);
    setMsg("");
    setConfirm({ days: d.days, reason: r.reason, to: extendedDeadline(expiresAt, d.days) });
  }
  async function extend() {
    if (!confirm) return;
    setBusy(true); setMsg("");
    const { data, error } = await supabase.rpc("vsat_offer_extend", { p: extendParams(applicationId, confirm.days, confirm.reason) });
    setBusy(false);
    setConfirm(null);
    if (error) return setMsg(errorText(error.message));
    setMsg(extendResultText(data));
    setOpen(false); setDaysText(""); setReason("");
    onDone();
  }

  if (!open) {
    return (
      <div className="space-y-1">
        <button className={cx(vx.btn, vx.secondary, vx.sm)} onClick={() => { setOpen(true); setMsg(""); }}>Extend last date</button>
        {msg && <p role="status" className="text-sm text-vx-ink">{msg}</p>}
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-md border border-vx-line-soft p-2">
      {!confirm ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-vx-faint">
            Days to add
            <input type="text" inputMode="numeric" maxLength={2} value={daysText} disabled={busy} onChange={(e) => setDaysText(e.target.value)}
              aria-label="Days to add to the last date" title={`Whole number ${EXTEND_DAYS_MIN}–${EXTEND_DAYS_MAX}.`}
              className={cx(vx.field, "h-8 w-24 text-[13px]")} />
          </label>
          <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-xs text-vx-faint">
            Reason (kept in the offer history)
            <input type="text" maxLength={EXTEND_REASON_MAX} value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)}
              aria-label="Why the last date is extended" className={cx(vx.field, "h-8 text-[13px]")} />
          </label>
          <button className={cx(vx.btn, vx.primary, vx.sm)} disabled={busy} onClick={check}>Continue</button>
          <button className={cx(vx.btn, vx.ghost, vx.sm)} disabled={busy} onClick={() => { setOpen(false); setMsg(""); }}>Cancel</button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">
            Move the last date {confirm.days} day{confirm.days === 1 ? "" : "s"} on{confirm.to ? `, to ${deadlineText(confirm.to)}` : ""}? No email goes to the student.
          </span>
          <button className={cx(vx.btn, vx.primary, vx.sm)} disabled={busy} onClick={() => void extend()}>{busy ? "Extending…" : "Yes, extend"}</button>
          <button className={cx(vx.btn, vx.secondary, vx.sm)} disabled={busy} onClick={() => setConfirm(null)}>Back</button>
        </div>
      )}
      {msg && <p role="status" className="text-sm text-vx-ink">{msg}</p>}
    </div>
  );
}
