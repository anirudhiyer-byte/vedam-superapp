"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { bookingsByIds, findBookings, rememberBooking, rememberedBookings } from "@/lib/peerpath/client";
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

export function MyBookings() {
  const [list, setList] = useState<Booking[] | null>(null);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    bookingsByIds(rememberedBookings()).then(setList);
  }, []);

  async function lookUp(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || phone.replace(/\D/g, "").length < 10) {
      setMsg("Please enter the email and WhatsApp number you booked with.");
      return;
    }
    setBusy(true);
    setMsg(null);
    const found = await findBookings(email.trim(), phone);
    setBusy(false);
    if (found === null) return setMsg("You seem to be offline. Please try again.");
    if (!found.length) return setMsg("No bookings found for these details.");
    found.forEach((b) => rememberBooking(b.id));
    setList((cur) => {
      const m = new Map((cur ?? []).map((b) => [b.id, b]));
      found.forEach((b) => m.set(b.id, b));
      return [...m.values()].sort((a, b) => b.start.localeCompare(a.start));
    });
  }

  const now = Date.now();
  const upcoming = (list ?? []).filter((b) => b.status === "confirmed" && new Date(b.start).getTime() > now).sort((a, b) => a.start.localeCompare(b.start));
  const past = (list ?? []).filter((b) => !upcoming.includes(b) && b.status !== "rescheduled");

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-[28px] font-bold text-pp-heading">My bookings</h1>
          <p className="text-[16px] text-pp-muted">Your chats with Vedam seniors. No account needed.</p>
        </div>
        {list === null ? (
          <p className="text-[15px] text-pp-muted">Loading…</p>
        ) : list.length === 0 ? (
          <EmptyState title="No bookings on this device yet" body="Book a chat, or find bookings you made on another phone or laptop with your email and number.">
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

      <aside className="pp-card flex flex-col gap-4 p-5 lg:sticky lg:top-28">
        <h2 className="text-[17px] font-semibold text-pp-heading">Booked on another device?</h2>
        <form onSubmit={lookUp} className="flex flex-col gap-3" noValidate>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="my-email" className="pp-label">Email</label>
            <input id="my-email" type="email" autoComplete="email" className="pp-field" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="my-phone" className="pp-label">WhatsApp number</label>
            <input id="my-phone" type="tel" inputMode="tel" autoComplete="tel" className="pp-field" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          {msg && <p role="status" className="text-[14px] text-pp-orange-700">{msg}</p>}
          <button type="submit" className="pp-btn-secondary" disabled={busy}>
            {busy ? "Looking…" : "Find my bookings"}
          </button>
        </form>
      </aside>
    </div>
  );
}
