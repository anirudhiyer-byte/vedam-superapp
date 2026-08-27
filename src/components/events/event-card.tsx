import Link from "next/link";
import {
  type EventRow, categoryColor, eventDateLabel, eventTimeLabel, isOffline,
} from "@/lib/events";

export function EventCard({ event, registered }: { event: EventRow; registered?: boolean }) {
  const accent = categoryColor(event.category);
  return (
    <Link
      href={`/events/${event.event_code}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-surface transition-transform hover:-translate-y-1"
    >
      <div className="relative h-36 w-full overflow-hidden" style={{ background: event.banner_url ? undefined : accent }}>
        {event.banner_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.banner_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="font-display text-lg font-bold text-white/90">{event.category || "Vedam Event"}</span>
          </div>
        )}
        {event.ribbon_label && (
          <span className="absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur">
            {event.ribbon_label}{event.ribbon_value ? `: ${event.ribbon_value}` : ""}
          </span>
        )}
        <span className="absolute right-3 top-3 rounded-full bg-black/55 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur">
          {isOffline(event) ? "In person" : "Online"}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="font-display text-base font-semibold text-heading">{event.name}</h3>
        {event.host && <p className="font-body text-xs text-muted">with {event.host}</p>}
        {event.blurb && <p className="line-clamp-2 font-body text-sm leading-relaxed text-muted">{event.blurb}</p>}
        <div className="mt-auto flex items-center justify-between pt-2">
          <div className="font-body text-xs text-foreground/70">
            <div>{eventDateLabel(event)}</div>
            <div className="text-muted">{eventTimeLabel(event)}</div>
          </div>
          {registered ? (
            <span className="rounded-full bg-surface-warm px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-accent">
              Registered
            </span>
          ) : (
            <span className="rounded-lg bg-brand-gradient px-3 py-1.5 text-xs font-semibold text-white">
              View
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
