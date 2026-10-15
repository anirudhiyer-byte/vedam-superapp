"use client";

import { useState } from "react";
import Link from "next/link";
import { giveFeedback } from "@/lib/peerpath/client";
import { ttsPath } from "@/lib/peerpath/constants";
import { IconCheck, IconStar } from "./icons";

function YesNo({ name, value, onChange, legend }: { name: string; value: boolean | null; onChange: (v: boolean) => void; legend: string }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-3 text-[16px] font-semibold leading-snug text-pp-heading">{legend}</legend>
      <div className="grid grid-cols-2 gap-3">
        {[true, false].map((v) => (
          <button
            key={String(v)}
            type="button"
            name={name}
            aria-pressed={value === v}
            onClick={() => onChange(v)}
            className={`min-h-[48px] rounded-xl border text-[15px] font-semibold transition ${
              value === v ? "border-pp-violet-500 bg-pp-violet-50 text-pp-violet-700" : "border-pp-line bg-pp-card text-pp-ink hover:border-pp-violet-200"
            }`}
          >
            {v ? "Yes" : "No"}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function FeedbackForm({ bookingId, seniorFirstName }: { bookingId: string; seniorFirstName: string }) {
  const [rating, setRating] = useState(0);
  const [recommend, setRecommend] = useState<boolean | null>(null);
  const [promise, setPromise] = useState<boolean | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!rating || recommend === null || promise === null) {
      setError("Please answer the three questions.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await giveFeedback(bookingId, rating, recommend, promise, note.trim() || null);
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <div aria-hidden className="grid h-14 w-14 place-items-center rounded-full bg-[#0f2e1c] text-[#4ADE80]">
          <IconCheck className="h-7 w-7" />
        </div>
        <h2 className="text-[20px] font-semibold text-pp-heading">Thank you!</h2>
        <p className="text-[15px] text-pp-muted">Your answers help other students pick the right senior.</p>
        <Link href={ttsPath.home} className="pp-btn-secondary mt-2">Talk to another senior</Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-7">
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-[16px] font-semibold text-pp-heading">How was your chat with {seniorFirstName}?</legend>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              aria-label={`${n} star${n > 1 ? "s" : ""}`}
              aria-pressed={rating === n}
              onClick={() => setRating(n)}
              className={`grid h-12 w-12 place-items-center rounded-xl border transition sm:h-14 sm:w-14 ${n <= rating ? "border-pp-orange-500/50 bg-pp-orange-50 text-pp-orange-500" : "border-pp-line bg-pp-card text-[#6f6886] hover:border-pp-violet-200"}`}
            >
              <IconStar className="h-6 w-6" filled={n <= rating} />
            </button>
          ))}
        </div>
      </fieldset>

      <YesNo name="recommend" legend="Would you recommend this senior to a friend?" value={recommend} onChange={setRecommend} />
      <YesNo name="promise" legend="Did the senior promise anything about fees, scholarships or your admission?" value={promise} onChange={setPromise} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="note" className="pp-label">
          Anything else? <span className="font-normal text-pp-muted">(optional)</span>
        </label>
        <textarea id="note" rows={3} maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} className="pp-field py-3" placeholder="What helped, what didn't" />
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-[#7f2a24] bg-[#2a1212] px-4 py-3 text-[14px] text-[#FF7A6E]">
          {error}
        </p>
      )}

      <button type="submit" className="pp-btn-primary w-full sm:w-auto sm:self-start sm:px-10" disabled={busy}>
        {busy ? "Sending…" : "Submit feedback"}
      </button>
    </form>
  );
}
