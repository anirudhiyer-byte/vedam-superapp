import Link from "next/link";
import { redirect } from "next/navigation";
import { TtsNav } from "@/components/peerpath/tts-nav";
import type { Metadata } from "next";
import { BookingForm } from "@/components/peerpath/booking-form";
import { AdmissionsNote, Avatar, EmptyState, seniorMeta } from "@/components/peerpath/ui";
import { IconBack, IconCalendar, IconVideo } from "@/components/peerpath/icons";
import { PEERPATH_LINKS, TTS, ttsPath } from "@/lib/peerpath/constants";
import { withReturn } from "@/lib/peerpath/booking-codes";
import { guardPeerPath } from "@/lib/peerpath/gate";
import { getSessionUser, isUuid, loadBooking, loadMyContact, loadSenior } from "@/lib/peerpath/server";
import { fmtDay, fmtTime } from "@/lib/peerpath/slots";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Book your chat — Talk to a Senior · Vedam" };

type SP = Promise<{ senior?: string; start?: string; type?: string; duration?: string; r?: string }>;

export default async function BookPage({ searchParams }: { searchParams: SP }) {
  await guardPeerPath();
  const sp = await searchParams;

  // this page, so login and the popups bring the user back to the same senior and time
  const here = new URLSearchParams();
  for (const k of ["senior", "start", "type", "duration", "r"] as const) {
    const v = sp[k];
    if (typeof v === "string" && v) here.set(k, v);
  }
  const returnTo = ttsPath.book(here);

  // booking needs a login: who books is taken from the account, never typed in
  if (!(await getSessionUser())) redirect(withReturn(PEERPATH_LINKS.login, returnTo));

  const contact = await loadMyContact();
  const senior = sp.senior ? await loadSenior(sp.senior) : null;
  const old = isUuid(sp.r) ? await loadBooking(sp.r) : null;
  const moving = old && old.status === "confirmed" ? old : null;
  const slot = senior?.slots.find((s) => s.start === sp.start && s.type === sp.type);
  const duration = slot?.type === "Group" ? 30 : Number(sp.duration) === 15 && senior?.durations.includes(15) ? 15 : 30;

  return (
    <>
      <TtsNav />
      <div className="mx-auto max-w-[960px] px-4 py-6 sm:px-6 lg:py-10">
        <Link href={senior ? ttsPath.senior(senior.id, moving?.id) : TTS} className="mb-5 inline-flex min-h-[44px] items-center gap-1.5 text-[15px] font-semibold text-pp-violet-600 hover:text-pp-violet-700">
          <IconBack /> {senior ? "Back to times" : "All seniors"}
        </Link>

        {!senior || !slot ? (
          <EmptyState title="This time is no longer free" body="Someone may have just booked it, or the link is old. Please pick another time.">
            <Link href={senior ? ttsPath.senior(senior.id, moving?.id) : TTS} className="pp-btn-primary mt-2">
              See free times
            </Link>
          </EmptyState>
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
            <section className="pp-card p-5 sm:p-7">
              <h1 className="mb-1 text-[24px] font-bold text-pp-heading">{moving ? "Move your chat" : "Book your chat"}</h1>
              <p className="mb-6 text-[15px] text-pp-muted">{moving ? "Your old time will be freed for another student." : "Check your details and confirm."}</p>
              <BookingForm
                seniorId={senior.id}
                start={slot.start}
                type={slot.type}
                duration={duration}
                rescheduleOf={moving?.id ?? null}
                contact={contact}
                returnTo={returnTo}
                seniorPath={ttsPath.senior(senior.id, moving?.id)}
              />
            </section>

            <aside className="order-first flex flex-col gap-4 lg:order-last lg:sticky lg:top-28">
              <section className="pp-card flex flex-col gap-4 p-5">
                <div className="flex items-center gap-3">
                  <Avatar senior={senior} size={48} />
                  <div>
                    <p className="text-[16px] font-semibold text-pp-heading">{senior.firstName}</p>
                    <p className="text-[13px] text-pp-muted">{seniorMeta(senior)}</p>
                  </div>
                </div>
                <div className="flex flex-col gap-2.5 rounded-xl bg-pp-violet-50 p-4 text-[15px] text-pp-heading">
                  <p className="flex items-center gap-2.5">
                    <IconCalendar className="h-5 w-5 text-pp-violet-600" />
                    {fmtDay(slot.start)}, {fmtTime(slot.start)} IST
                  </p>
                  <p className="flex items-center gap-2.5">
                    <IconVideo className="h-5 w-5 text-pp-violet-600" />
                    {duration} min · {slot.type === "Group" ? "Group chat on Google Meet" : "1:1 on Google Meet"}
                  </p>
                </div>
              </section>
              <AdmissionsNote />
            </aside>
          </div>
        )}
      </div>
    </>
  );
}
