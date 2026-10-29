import { TtsNav } from "@/components/peerpath/tts-nav";
import type { Metadata } from "next";
import { FeedbackForm } from "@/components/peerpath/feedback-form";
import { ConfirmItsYou } from "@/components/peerpath/confirm-its-you";
import { EmptyState } from "@/components/peerpath/ui";
import { guardPeerPath } from "@/lib/peerpath/gate";
import { loadBooking } from "@/lib/peerpath/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Feedback — Talk to a Senior · Vedam", robots: { index: false } };

export default async function FeedbackPage({ params }: { params: Promise<{ id: string }> }) {
  await guardPeerPath();
  const { id } = await params;
  const b = await loadBooking(id);
  if (!b) return (<><TtsNav /><ConfirmItsYou /></>);
  const started = new Date(b.start).getTime() < Date.now();
  const open = (b.status === "completed" || (b.status === "confirmed" && started)) && !b.feedbackGiven;

  return (
    <>
      <TtsNav />
      <div className="mx-auto max-w-[640px] px-4 py-8 sm:px-6 lg:py-12">
        <section className="pp-card p-5 sm:p-8">
          <p className="pp-eyebrow mb-2">Takes 20 seconds</p>
          <h1 className="mb-6 text-[26px] font-bold text-pp-heading">Tell us how it went</h1>
          {open ? (
            <FeedbackForm bookingId={b.id} seniorFirstName={b.senior.firstName} />
          ) : (
            <EmptyState
              title={b.feedbackGiven ? "Thanks, we have your feedback" : "Feedback isn't open for this chat"}
              body={b.feedbackGiven ? "You already told us how this chat went." : "Feedback opens once the chat has started. Cancelled or moved chats don't need feedback."}
            />
          )}
          <p className="mt-6 border-t border-pp-line pt-5 text-[14px] text-pp-muted">
            Something went wrong in the chat?{" "}
            <a href={`mailto:connect@vedam.org?subject=${encodeURIComponent("Talk to a Senior: report a problem")}&body=${encodeURIComponent(`Booking ID: ${b.id}\n\n`)}`} className="font-semibold text-[#FF7A6E] underline underline-offset-2">
              Report a problem
            </a>
          </p>
        </section>
      </div>
    </>
  );
}
