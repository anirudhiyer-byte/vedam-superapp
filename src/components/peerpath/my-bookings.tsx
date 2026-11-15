import Link from "next/link";
import { TTS, ttsPath } from "@/lib/peerpath/constants";
import { fmtDay, fmtTime } from "@/lib/peerpath/slots";
import type { Booking, BookingStatus } from "@/lib/peerpath/types";
import { Avatar, EmptyState } from "./ui";

const LABEL: Record<BookingStatus, string> = {
  confirmed: "Booked",
  completed: "Done",
  cancelled: "Cancelled",
  rescheduled: "Moved",
  no_show_applicant: "Missed",
};

function Row({ b }: { b: Booking }) {
  const started = new Date(b.start).getTime() <= Date.now();
  const feedback = (b.status === "completed" || (b.status === "confirmed" && started)) && !b.feedbackGiven;
  return (
    <li className="pp-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <Link href={ttsPath.booked(b.id)} className="flex min-w-0 items-center gap-3">
        <Avatar senior={{ firstName: b.senior.firstName, photoUrl: null }} size={44} />
        <span className="min-w-0">
          <span className="block text-[16px] font-semibold text-pp-heading">
            {b.senior.firstName} <span className="font-normal text-pp-muted">· {b.senior.campus}</span>
          </span>
          <span className="block text-[14px] text-pp-muted">
            {fmtDay(b.start)}, {fmtTime(b.start)} · {b.type === "Group" ? "Group" : "1:1"} ·{" "}
            <span className={b.status === "confirmed" ? "text-[#4ADE80]" : ""}>{started && b.status === "confirmed" ? "Done" : LABEL[b.status]}</span>
          </span>
        </span>
      </Link>
      <div className="flex flex-wrap gap-2">
        {b.status === "confirmed" && !started && b.meetUrl && (
          <a href={b.meetUrl} target="_blank" rel="noreferrer" className="pp-btn-primary min-h-[40px] px-4 text-[14px]">
            Join Meet
          </a>
        )}
        {feedback && (
          <Link href={ttsPath.feedback(b.id)} className="pp-btn-primary min-h-[40px] px-4 text-[14px]">
            Give feedback
          </Link>
        )}
        <Link href={ttsPath.booked(b.id)} className="pp-btn-secondary min-h-[40px] px-4 text-[14px]">
          Details
        </Link>
      </div>
    </li>
  );
}

/** The logged-in user's bookings (loaded on the server with pp_my_bookings). */
export function MyBookings({ list }: { list: Booking[] | null }) {
  const now = Date.now();
  const upcoming = (list ?? []).filter((b) => b.status === "confirmed" && new Date(b.start).getTime() > now).sort((a, b) => a.start.localeCompare(b.start));
  const past = (list ?? []).filter((b) => !upcoming.includes(b) && b.status !== "rescheduled");

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8">
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-[28px] font-bold text-pp-heading">My bookings</h1>
          <p className="text-[16px] text-pp-muted">Your chats with Vedam seniors, on this account.</p>
        </div>
        {list === null ? (
          <p role="alert" className="text-[15px] text-pp-muted">We couldn&apos;t load your bookings. Please refresh the page.</p>
        ) : list.length === 0 ? (
          <EmptyState title="No bookings yet" body="When you book a chat with a senior, it shows up here.">
            <Link href={TTS} className="pp-btn-primary mt-2">
              Find a senior
            </Link>
          </EmptyState>
        ) : (
          <>
            <section className="flex flex-col gap-3">
              <h2 className="text-[17px] font-semibold text-pp-heading">Upcoming</h2>
              {upcoming.length ? <ul className="flex flex-col gap-3">{upcoming.map((b) => <Row key={b.id} b={b} />)}</ul> : <p className="text-[14px] text-pp-muted">Nothing coming up. <Link href={TTS} className="font-semibold text-pp-violet-600 underline">Book a chat</Link></p>}
            </section>
            {past.length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="text-[17px] font-semibold text-pp-heading">Past</h2>
                <ul className="flex flex-col gap-3">{past.map((b) => <Row key={b.id} b={b} />)}</ul>
              </section>
            )}
          </>
        )}
      </div>

    </div>
  );
}
