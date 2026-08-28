import Link from "next/link";
import {
  type EventRow, categoryColor, eventDateLabel, eventTimeLabel, isOffline, eventDayMonth,
  pointsTotalPossible,
} from "@/lib/events";

export function EventCard({ event, registered }: { event: EventRow; registered?: boolean }) {
  const accent = categoryColor(event.category);
  const { day, month } = eventDayMonth(event);
  const off = isOffline(event);
  const pts = pointsTotalPossible(event.points_config);

  return (
    <Link
      href={`/events/${event.event_code}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-surface transition-all hover:-translate-y-1 hover:shadow-[0_18px_40px_-22px_rgba(43,19,92,0.35)]"
    >
      <div className="relative h-32 w-full overflow-hidden" style={{ background: event.banner_url ? undefined : accent }}>
        {event.banner_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.banner_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div aria-hidden className="absolute inset-0 opacity-20"
            style={{ backgroundImage: "radial-gradient(#fff 1px, transparent 1.3px)", backgroundSize: "18px 18px" }} />
        )}
        {event.category && (
          <span className="absolute left-3 top-3 rounded-full bg-black/30 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur">
            {event.category}
          </span>
        )}
        <div className="absolute -bottom-4 right-4 w-[52px] rounded-xl border border-border bg-surface py-1.5 text-center shadow-[0_18px_40px_-22px_rgba(43,19,92,0.4)]">
          <div className="font-display text-xl font-extrabold leading-none text-heading">{day}</div>
          <div className="font-mono text-[10px] font-semibold text-accent">{month}</div>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4 pt-5">
        <h3 className="font-display text-[17px] font-bold leading-tight text-heading">{event.name}</h3>
        <div className="mt-2 flex items-center gap-2 font-mono text-xs text-muted">
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: off ? "#F97D03" : "#12b3a6" }} />
          {off ? "In person" : "Online"}{event.host ? ` · ${event.host}` : ""}
        </div>
        <div className="mt-1 font-mono text-xs text-muted">{eventDateLabel(event)} · {eventTimeLabel(event)}</div>

        <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
          {registered ? (
            <span className="font-mono text-xs font-semibold text-accent">✓ Registered</span>
          ) : (
            <span className="font-mono text-xs text-muted">{event.max_attendees ? `${event.max_attendees} seats` : "Open"}</span>
          )}
          {pts > 0
            ? <span className="font-mono text-xs font-bold text-primary">+{pts} pts</span>
            : <span className="rounded-lg bg-brand-gradient px-3 py-1.5 text-xs font-semibold text-white">View</span>}
        </div>
      </div>
    </Link>
  );
}
