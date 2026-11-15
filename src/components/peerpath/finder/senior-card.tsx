import Link from "next/link";
import type { SeniorWithSlots, Slot } from "@/lib/peerpath/types";
import { fmtSlotShort } from "@/lib/peerpath/slots";
import { ttsPath } from "@/lib/peerpath/constants";
import { Avatar, Rating, seniorFrom, seniorMeta } from "@/components/peerpath/ui";
import { IconArrow, IconChat, IconUsers } from "@/components/peerpath/icons";

export function bookHref(slot: Slot) {
  const q = new URLSearchParams({ senior: slot.seniorId, start: slot.start, type: slot.type, duration: String(slot.duration) });
  return ttsPath.book(q);
}

export function SeniorCard({ senior, slots }: { senior: SeniorWithSlots; slots: Slot[] }) {
  const from = seniorFrom(senior);
  const next = slots.slice(0, 3);
  return (
    <article className="pp-card flex flex-col gap-4 p-5">
      <div className="flex items-start gap-3.5">
        <Avatar senior={senior} size={52} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Link href={ttsPath.senior(senior.id)} className="text-[17px] font-semibold text-pp-heading hover:text-pp-violet-600">
            {senior.firstName}
          </Link>
          <p className="text-[14px] text-pp-muted">{seniorMeta(senior)}</p>
          {from && <p className="text-[13px] text-pp-muted">{from}</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Rating senior={senior} />
        {senior.languages.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[13px] text-pp-muted">
            <IconChat className="h-3.5 w-3.5" />
            {senior.languages.join(", ")}
          </span>
        )}
        {senior.sessionTypes.includes("Group") && (
          <span className="inline-flex items-center gap-1 text-[13px] text-pp-muted">
            <IconUsers className="h-3.5 w-3.5" />
            Group chats
          </span>
        )}
      </div>

      {senior.askMeAbout.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="pp-eyebrow">Ask me about</p>
          <ul className="flex flex-wrap gap-1.5">
            {senior.askMeAbout.slice(0, 4).map((a) => (
              <li key={a} className="pp-tag">
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2">
        <p className="pp-eyebrow">{next.length ? "Next free times" : "Free times"}</p>
        {next.length ? (
          <div className="flex flex-wrap gap-2">
            {next.map((s) => (
              <Link
                key={s.start + s.type}
                href={bookHref(s)}
                className="inline-flex min-h-[40px] items-center rounded-lg border border-pp-violet-200 bg-pp-card px-3 text-[13px] font-semibold text-pp-violet-700 transition hover:border-pp-violet-500 hover:bg-pp-violet-50"
              >
                {fmtSlotShort(s.start)}
                {s.type === "Group" && <span className="ml-1.5 font-medium text-pp-muted">· group</span>}
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-[14px] text-pp-muted">No free times in the next two weeks.</p>
        )}
        <Link href={ttsPath.senior(senior.id)} className="mt-1 inline-flex items-center gap-1.5 self-start text-[14px] font-semibold text-pp-violet-600 hover:text-pp-violet-700">
          View profile &amp; all times <IconArrow />
        </Link>
      </div>
    </article>
  );
}
