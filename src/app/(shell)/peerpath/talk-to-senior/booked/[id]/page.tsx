import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TtsNav } from "@/components/peerpath/tts-nav";
import { CancelBooking, RememberBooking } from "@/components/peerpath/booking-actions";
import { AdmissionsNote, Avatar, yearLabel } from "@/components/peerpath/ui";
import { IconCalendar, IconCheck, IconVideo } from "@/components/peerpath/icons";
import { BOOKING_RULES, ttsPath } from "@/lib/peerpath/constants";
import { guardPeerPath } from "@/lib/peerpath/gate";
import { loadBooking } from "@/lib/peerpath/server";
import { fmtDay, fmtTime } from "@/lib/peerpath/slots";
import type { Booking } from "@/lib/peerpath/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your chat — Talk to a Senior · Vedam", robots: { index: false } };

function googleCalendarLink(b: Booking) {
  const f = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: `Vedam: Talk to a Senior (${b.senior.firstName})`,
    dates: `${f(b.start)}/${f(b.end)}`,
    details: b.meetUrl ? `Join on Google Meet: ${b.meetUrl}` : "Open your booking page on Vedam to find the Google Meet link.",
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

export default async function BookedPage({ params }: { params: Promise<{ id: string }> }) {
  await guardPeerPath();
  const { id } = await params;
  const b = await loadBooking(id);
  if (!b) notFound();

  const minutes = Math.round((new Date(b.end).getTime() - new Date(b.start).getTime()) / 60000);
  const startsIn = new Date(b.start).getTime() - Date.now();
  const started = startsIn <= 0;
  const live = b.status === "confirmed" && !started;
  const canGiveFeedback = (b.status === "completed" || (b.status === "confirmed" && started)) && !b.feedbackGiven;

  const head =
    b.status === "cancelled"
      ? { t: "Chat cancelled", d: "This chat was cancelled. You can book another time anytime.", ok: false }
      : b.status === "rescheduled"
        ? { t: "This chat was moved", d: "You picked a new time for this chat.", ok: false }
        : b.status === "no_show_applicant"
          ? { t: "We missed you", d: "The senior marked that you couldn't join. You can book another time.", ok: false }
          : live
            ? { t: "You're booked!", d: `Save the Meet link below and add the chat to your calendar. ${b.senior.firstName} will see your question before the chat.`, ok: true }
            : b.feedbackGiven
              ? { t: "Thanks for the feedback", d: "Your answers help other students pick the right senior.", ok: true }
              : { t: "Hope it went well!", d: "Tell us how the chat went. It takes 20 seconds.", ok: true };

  return (
    <>
      <TtsNav />
      <RememberBooking id={b.id} />
      <div className="mx-auto flex max-w-[640px] flex-col gap-6 px-4 py-8 sm:px-6 lg:py-12">
        <div className="flex flex-col items-center gap-3 text-center">
          <div aria-hidden className={`grid h-16 w-16 place-items-center rounded-full ${head.ok ? "bg-[#0f2e1c] text-[#4ADE80]" : "bg-pp-soft text-pp-muted"}`}>
            <IconCheck className="h-8 w-8" />
          </div>
          <h1 className="text-[28px] font-bold text-pp-heading">{head.t}</h1>
          <p className="max-w-md text-[16px] text-pp-muted">{head.d}</p>
        </div>

        <section className="pp-card flex flex-col gap-5 p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <Avatar senior={{ firstName: b.senior.firstName, photoUrl: null }} size={52} />
            <div>
              <p className="text-[17px] font-semibold text-pp-heading">{b.senior.firstName}</p>
              <p className="text-[14px] text-pp-muted">
                {yearLabel(b.senior.year)} · {b.senior.campus} campus · {b.type === "Group" ? "Group chat" : "1:1 chat"}
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-pp-soft p-4">
              <p className="text-[13px] text-pp-muted">Date</p>
              <p className="text-[16px] font-semibold text-pp-heading">{fmtDay(b.start)}</p>
            </div>
            <div className="rounded-xl bg-pp-soft p-4">
              <p className="text-[13px] text-pp-muted">Time (IST)</p>
              <p className="text-[16px] font-semibold text-pp-heading">
                {fmtTime(b.start)} · {minutes} min
              </p>
            </div>
          </div>

          {b.question && <p className="rounded-xl border border-pp-line p-3 text-[14px] text-pp-ink">Your question: “{b.question}”</p>}

          {b.status === "confirmed" && (
            <div className="flex flex-col gap-3 sm:flex-row">
              {b.meetUrl ? (
                <a href={b.meetUrl} target="_blank" rel="noreferrer" className="pp-btn-primary flex-1">
                  <IconVideo /> Join Google Meet
                </a>
              ) : (
                <p className="flex flex-1 items-center gap-2 rounded-xl bg-pp-violet-50 px-4 py-3 text-[14px] text-pp-heading">
                  <IconVideo className="h-5 w-5 text-pp-violet-600" /> The Meet link shows here once {b.senior.firstName} adds it. Please check back before the chat.
                </p>
              )}
              {live && (
                <a href={googleCalendarLink(b)} target="_blank" rel="noreferrer" className="pp-btn-secondary flex-1">
                  <IconCalendar /> Add to calendar
                </a>
              )}
            </div>
          )}

          {canGiveFeedback && (
            <Link href={ttsPath.feedback(b.id)} className="pp-btn-primary">
              Give feedback
            </Link>
          )}

          {b.status === "rescheduled" && b.movedTo && (
            <Link href={ttsPath.booked(b.movedTo)} className="pp-btn-primary">
              See the new time
            </Link>
          )}
        </section>

        {live && (
          <>
            <CancelBooking bookingId={b.id} seniorId={b.seniorId} canCancel={startsIn > BOOKING_RULES.lateCancelHours * 3600_000} />
            <p className="text-center text-[14px] text-pp-muted">Can&apos;t make it? Please change or cancel at least 3 hours before so another student can book.</p>
          </>
        )}
        {(b.status === "cancelled" || b.status === "no_show_applicant") && (
          <Link href={ttsPath.senior(b.seniorId)} className="pp-btn-primary self-center">
            Book another time
          </Link>
        )}

        <p className="text-center text-[14px] text-pp-muted">
          This page is your booking link. Find it again anytime in{" "}
          <Link href={ttsPath.my} className="font-semibold text-pp-violet-600 underline underline-offset-2">
            My bookings
          </Link>
          .
        </p>

        <AdmissionsNote />
      </div>
    </>
  );
}
