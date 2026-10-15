import { TtsNav } from "@/components/peerpath/tts-nav";
import { AdmissionsNote } from "@/components/peerpath/ui";

export const metadata = { title: "Session guidelines — Talk to a Senior · Vedam" };

const RULES = [
  { t: "Be kind and respectful", d: "Seniors are students giving their own time. Please be polite, and expect the same from them." },
  { t: "Seniors share their own experience", d: "They can tell you what life at Vedam is like for them. They cannot promise anything about fees, scholarships, admission decisions or placements." },
  { t: "Official questions go to admissions", d: "For fees, scholarships, eligibility or your application status, contact the admissions team." },
  { t: "Stay on Google Meet", d: "Please don't ask for or share personal phone numbers or social media handles during the chat." },
  { t: "Cancel early if you can't come", d: "Cancel at least 3 hours before, so another student can take the time. Missing chats without cancelling may pause your bookings." },
  { t: "Tell us if something felt wrong", d: "Use the feedback form after the chat or the “Report a problem” link. We read every report." },
];

export default function Guidelines() {
  return (
    <>
      <TtsNav />
      <div className="mx-auto max-w-[720px] px-4 py-8 sm:px-6 lg:py-12">
        <h1 className="mb-2 text-[28px] font-bold text-pp-heading">Session guidelines</h1>
        <p className="mb-8 text-[16px] text-pp-muted">Six simple rules that keep every chat useful and safe.</p>
        <ol className="flex flex-col gap-4">
          {RULES.map((r, i) => (
            <li key={r.t} className="pp-card flex gap-4 p-5">
              <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-pp-violet-50 text-[14px] font-bold text-pp-violet-700">{i + 1}</span>
              <div>
                <h2 className="text-[17px] font-semibold text-pp-heading">{r.t}</h2>
                <p className="mt-1 text-[15px] leading-relaxed text-pp-muted">{r.d}</p>
              </div>
            </li>
          ))}
        </ol>
        <AdmissionsNote className="mt-8" />
      </div>
    </>
  );
}
