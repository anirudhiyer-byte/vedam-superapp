/* eslint-disable @next/next/no-img-element */
import { ADMISSIONS_URL } from "@/lib/peerpath/constants";
import type { Senior } from "@/lib/peerpath/types";
import { IconInfo, IconStar } from "./icons";

export function Avatar({ senior, size = 48 }: { senior: Pick<Senior, "firstName" | "photoUrl">; size?: number }) {
  if (senior.photoUrl) {
    return (
      <img
        src={senior.photoUrl}
        alt=""
        width={size}
        height={size}
        className="flex-none rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      aria-hidden
      className="grid flex-none place-items-center rounded-full bg-pp-violet-100 font-bold text-pp-violet-700"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {senior.firstName.slice(0, 1).toUpperCase()}
    </div>
  );
}

const ORD = ["", "1st", "2nd", "3rd", "4th"];
export const yearLabel = (y: number) => `${ORD[y] ?? y + "th"} year`;

export function seniorMeta(s: Senior): string {
  return `${yearLabel(s.year)} · ${s.campus} campus`;
}

export function seniorFrom(s: Senior): string | null {
  const place = [s.homeCity, s.homeState].filter(Boolean).join(", ");
  const parts = [place ? `From ${place}` : null, s.residence].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** Shown only once a senior has at least 3 ratings, so one review can't define them. */
export function Rating({ senior }: { senior: Pick<Senior, "rating" | "ratingCount" | "sessionsDone"> }) {
  if (senior.rating === null || senior.ratingCount < 3) {
    return senior.sessionsDone > 0 ? <span className="text-[13px] text-pp-muted">{senior.sessionsDone} {senior.sessionsDone === 1 ? "chat" : "chats"} done</span> : null;
  }
  return (
    <span className="inline-flex items-center gap-1 text-[13px] text-pp-ink">
      <IconStar className="h-4 w-4 text-pp-orange-500" />
      <b className="font-semibold">{senior.rating.toFixed(1)}</b>
      <span className="text-pp-muted">({senior.ratingCount}) · {senior.sessionsDone} {senior.sessionsDone === 1 ? "chat" : "chats"}</span>
    </span>
  );
}

export function AdmissionsNote({ className = "" }: { className?: string }) {
  return (
    <div className={`flex gap-3 rounded-2xl border border-pp-orange-500/30 bg-pp-orange-50 p-4 text-[14px] leading-relaxed text-pp-orange-700 ${className}`}>
      <IconInfo className="mt-0.5 h-5 w-5 flex-none text-pp-orange-700" />
      <p>
        Seniors share their own experience. For fees, scholarships or your admission status, please{" "}
        <a href={ADMISSIONS_URL} target="_blank" rel="noreferrer" className="font-semibold text-pp-orange-700 underline underline-offset-2">
          contact the admissions team
        </a>
        .
      </p>
    </div>
  );
}

export function EmptyState({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="pp-card flex flex-col items-center gap-3 px-6 py-14 text-center">
      <div aria-hidden className="grid h-14 w-14 place-items-center rounded-2xl bg-pp-violet-50 text-pp-violet-500">
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
          <circle cx="9" cy="8" r="3.5" />
          <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.8a3.5 3.5 0 010 6.4M18 14.8c1.8.8 3 2.6 3.5 5.2" />
        </svg>
      </div>
      <h2 className="text-[18px] font-semibold text-pp-heading">{title}</h2>
      <p className="max-w-md text-[15px] leading-relaxed text-pp-muted">{body}</p>
      {children}
    </div>
  );
}
