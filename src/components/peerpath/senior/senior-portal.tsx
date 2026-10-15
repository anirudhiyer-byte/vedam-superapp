"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { BookingStatus, PortalBooking, SeniorPortal as Portal } from "@/lib/peerpath/types";
import { markBooking } from "@/lib/peerpath/client";
import { ttsPath } from "@/lib/peerpath/constants";
import { fmtDay, fmtTime } from "@/lib/peerpath/slots";
import { EmptyState, yearLabel } from "@/components/peerpath/ui";
import { IconStar, IconVideo } from "@/components/peerpath/icons";
import { StatusPill } from "@/components/peerpath/admin/senior-status";
import { AvailabilityEditor } from "./availability-editor";
import { ProfileEditor } from "./profile-editor";

type Tab = "upcoming" | "past" | "times" | "profile";

const PAST_LABEL: Partial<Record<BookingStatus, string>> = {
  completed: "Done",
  no_show_applicant: "Didn't join",
  cancelled: "Cancelled",
  rescheduled: "Moved",
};

function MarkButtons({ token, b }: { token: string; b: PortalBooking }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = async (status: "completed" | "no_show_applicant" | "confirmed") => {
    setBusy(true);
    setErr(null);
    const res = await markBooking(token, b.id, status);
    setBusy(false);
    if (res.ok) router.refresh();
    else setErr(res.message);
  };
  if (b.status === "cancelled" || b.status === "rescheduled") return null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => set("completed")} className={`pp-chip ${b.status === "completed" ? "pp-chip-on" : ""}`}>
          Chat done
        </button>
        <button type="button" disabled={busy} onClick={() => set("no_show_applicant")} className={`pp-chip ${b.status === "no_show_applicant" ? "pp-chip-on" : ""}`}>
          Applicant didn&apos;t join
        </button>
      </div>
      {err && <p className="text-[13px] text-[#FF7A6E]">{err}</p>}
    </div>
  );
}

export function SeniorPortal({ token, portal }: { token: string; portal: Portal }) {
  const [tab, setTab] = useState<Tab>("upcoming");
  const s = portal.senior;
  const now = Date.now();
  const upcoming = portal.bookings.filter((b) => b.status === "confirmed" && new Date(b.start).getTime() > now);
  const past = portal.bookings.filter((b) => new Date(b.start).getTime() <= now && b.status !== "rescheduled").reverse();
  const toMark = past.filter((b) => b.status === "confirmed").length;
  const tabs: { id: Tab; label: string }[] = [
    { id: "upcoming", label: `Upcoming${upcoming.length ? ` (${upcoming.length})` : ""}` },
    { id: "past", label: `Past${toMark ? ` · ${toMark} to mark` : ""}` },
    { id: "times", label: "My times" },
    { id: "profile", label: "My profile" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[28px] font-bold text-pp-heading">Hi {s.firstName}</h1>
          <StatusPill status={s.status} />
        </div>
        <p className="text-[16px] text-pp-muted">
          {yearLabel(s.year)} · {s.campus} campus. Set your own times. Applicants can only book what you open.
        </p>
        {s.status === "pending" && (
          <p className="rounded-xl border border-pp-orange-500/30 bg-pp-orange-50 px-4 py-3 text-[14px] text-pp-orange-700">
            Your profile is waiting for the Vedam team to approve it. Add your times now; applicants will see you once you are approved.
          </p>
        )}
        {s.status === "paused" && (
          <p className="rounded-xl border border-pp-line bg-pp-soft px-4 py-3 text-[14px] text-pp-muted">The Vedam team has paused your profile, so applicants can&apos;t see you right now.</p>
        )}
        {!s.meetLink && (
          <p className="rounded-xl border border-pp-orange-500/30 bg-pp-orange-50 px-4 py-3 text-[14px] text-pp-orange-700">
            Add your Google Meet link in <button type="button" className="font-semibold underline underline-offset-2" onClick={() => setTab("profile")}>My profile</button> so applicants can join your chats.
          </p>
        )}
        <p className="text-[13px] text-pp-muted">Keep this page&apos;s link private. It is your key to this page.</p>
      </div>

      <div role="tablist" aria-label="Sections" className="flex gap-1 overflow-x-auto rounded-xl bg-pp-soft p-1 sm:self-start">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`min-h-[44px] flex-none rounded-lg px-4 text-[15px] font-semibold transition ${tab === t.id ? "bg-pp-violet-500 text-white" : "text-pp-muted hover:text-pp-heading"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "upcoming" &&
        (upcoming.length === 0 ? (
          <EmptyState title="No upcoming chats" body="When an applicant books one of your times, it shows here with their question." />
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {upcoming.map((b) => (
              <li key={b.id} className="pp-card flex flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[16px] font-semibold text-pp-heading">{b.name}</p>
                    <p className="text-[14px] text-pp-muted">
                      {fmtDay(b.start)}, {fmtTime(b.start)} · {b.type === "Group" ? "Group" : "1:1"} ·{" "}
                      {Math.round((new Date(b.end).getTime() - new Date(b.start).getTime()) / 60000)} min
                    </p>
                  </div>
                  {s.meetLink && (
                    <a href={s.meetLink} target="_blank" rel="noreferrer" className="pp-btn-secondary min-h-[40px] px-3">
                      <IconVideo className="h-4 w-4" /> Join
                    </a>
                  )}
                </div>
                {b.question && <p className="rounded-xl bg-pp-soft p-3 text-[14px] text-pp-ink">“{b.question}”</p>}
              </li>
            ))}
          </ul>
        ))}

      {tab === "past" &&
        (past.length === 0 ? (
          <EmptyState title="No past chats yet" body="After a chat, mark it done or tell us if the applicant didn't join." />
        ) : (
          <ul className="flex flex-col gap-3">
            {past.map((b) => (
              <li key={b.id} className="pp-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-pp-heading">
                    {b.name} <span className="font-normal text-pp-muted">· {b.type}</span>
                  </p>
                  <p className="text-[13px] text-pp-muted">
                    {fmtDay(b.start)}, {fmtTime(b.start)}
                    {b.status !== "confirmed" && PAST_LABEL[b.status] ? ` · ${PAST_LABEL[b.status]}` : ""}
                    {b.rating ? (
                      <span className="ml-2 inline-flex items-center gap-1 text-pp-ink">
                        <IconStar className="h-3.5 w-3.5 text-pp-orange-500" filled /> {b.rating}
                      </span>
                    ) : null}
                  </p>
                </div>
                <MarkButtons token={token} b={b} />
              </li>
            ))}
          </ul>
        ))}

      {tab === "times" && <AvailabilityEditor token={token} initialRules={portal.rules} initialBlocks={portal.blocks} initialSettings={portal.settings} />}

      {tab === "profile" && (
        <ProfileEditor
          token={token}
          initial={{
            firstName: s.firstName,
            campus: s.campus,
            year: s.year,
            homeCity: s.homeCity,
            homeState: s.homeState,
            residence: s.residence,
            languages: s.languages,
            topics: s.topics,
            askMeAbout: s.askMeAbout,
            clubs: s.clubs,
            bio: s.bio,
            sessionTypes: s.sessionTypes,
            durations: s.durations,
            meetLink: s.meetLink,
            contactEmail: s.contactEmail,
          }}
        />
      )}

      <p className="text-[14px] text-pp-muted">
        <Link href={ttsPath.guidelines} className="font-semibold text-pp-violet-600 underline underline-offset-2">Session guidelines</Link> apply to seniors too: share your own experience, never promise fees, scholarships or admission.
      </p>
    </div>
  );
}
