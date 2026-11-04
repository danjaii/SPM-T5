"use client";

import { utcToSgt } from "@spm-t5/shared";
import { cn } from "@/lib/utils";
import type { CalendarPeriod, CalendarVenue } from "@/lib/venueCalendar";
import { busyOnDay, dayStatus, daysOf, shortDay, type CalendarView } from "@/lib/venueTimeline";
import { blockReason, STATUS_LOOK } from "./VenueCalendarPeriod";
import { NAME_COLUMN } from "./VenueDayTimeline";

/** How many periods a week cell lists before "+N more". */
const WEEK_CELL_LIMIT = 3;

/** One booked or blocked period in a week cell: its icon, a short word and its times that day. */
function Chip({ period, date }: { period: CalendarPeriod; date: string }) {
  const { icon: Icon, short } = STATUS_LOOK[period.status];
  const start = utcToSgt(new Date(period.start));
  const end = utcToSgt(new Date(period.end));
  const times = `${start.date === date ? start.time : "00:00"}–${end.date === date ? end.time : "24:00"}`;
  return (
    <span
      data-kind={period.kind}
      className={cn("flex flex-col rounded px-1.5 py-0.5", STATUS_LOOK[period.status].className, period.kind === "block" && "calendar-block")}
      title={period.kind === "block" ? blockReason(period) : undefined}
    >
      <span className="flex items-center gap-1 font-semibold">
        <Icon aria-hidden="true" className="size-3 shrink-0" />
        {short}
      </span>
      <span className="truncate">{times}</span>
    </span>
  );
}

// SCRUM-130 (Figma 09 Week and Month): every venue a row, the days across. A week cell lists the day's bookings and blocks; a month
// cell shows the day's busiest status. Choosing a cell opens that day in the day view.
export function VenueRangeGrid({
  view,
  venues,
  from,
  to,
  today,
  onOpenDay,
}: {
  view: Exclude<CalendarView, "day">;
  venues: CalendarVenue[];
  from: string;
  to: string;
  today: string;
  onOpenDay: (date: string) => void;
}) {
  const days = daysOf(from, to);
  const month = view === "month";
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card" role="region" aria-label={`Venue ${view} from ${from} to ${to}`} tabIndex={0}>
      <div className={month ? "w-max min-w-full" : "min-w-3xl"}>
        <div className="flex border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground">
          <div className={cn(NAME_COLUMN, "sticky left-0 z-20 bg-muted px-4 py-2")}>Venue</div>
          {days.map((day) => (
            <div key={day} className={cn("px-1 py-2 text-center", month ? "w-14 shrink-0" : "flex-1", day === today && "font-bold text-fg-primary")}>
              {month ? Number(day.slice(8)) : shortDay(day)}
            </div>
          ))}
        </div>
        {venues.map((venue) => (
          <div key={venue.id} data-venue-row className="flex border-b border-border last:border-b-0">
            <div className={cn(NAME_COLUMN, "sticky left-0 z-20 border-r border-border bg-card px-4 py-3")}>
              <p className="truncate text-sm font-semibold text-foreground">{venue.name}</p>
              <p className="text-xs text-muted-foreground">Capacity {venue.max_capacity}</p>
            </div>
            {days.map((day) => {
              const name = `Open ${venue.name} on ${shortDay(day)}`;
              if (month) {
                const status = dayStatus(venue.periods, day);
                const { icon: Icon, className, short } = STATUS_LOOK[status];
                return (
                  <button
                    key={day}
                    type="button"
                    aria-label={`${name}: ${short}`}
                    onClick={() => onOpenDay(day)}
                    className={cn(
                      "flex w-14 shrink-0 flex-col items-center justify-center gap-0.5 border-l border-border text-xs focus-visible:relative focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      // free and closed days stay quiet so the booked and blocked ones stand out
                      status === "AVAILABLE" || status === "UNAVAILABLE" ? "text-muted-foreground" : className,
                      status === "UNAVAILABLE" && "bg-muted",
                      status === "BLOCKED" && "calendar-block",
                    )}
                  >
                    <Icon aria-hidden="true" className="size-3.5" />
                    {short}
                  </button>
                );
              }
              const busy = busyOnDay(venue.periods, day);
              return (
                <button
                  key={day}
                  type="button"
                  aria-label={name}
                  onClick={() => onOpenDay(day)}
                  className="flex min-h-16 min-w-0 flex-1 flex-col items-stretch gap-1 border-l border-border p-1 text-left text-xs hover:bg-muted/40 focus-visible:relative focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {busy.length === 0 ? (
                    <span className="px-1.5 py-0.5 text-muted-foreground">{STATUS_LOOK[dayStatus(venue.periods, day)].short}</span>
                  ) : (
                    <span className="flex flex-col gap-1">
                      {busy.slice(0, WEEK_CELL_LIMIT).map((p) => <Chip key={`${p.start}-${p.kind}`} period={p} date={day} />)}
                      {busy.length > WEEK_CELL_LIMIT && <span className="px-1.5 text-muted-foreground">+{busy.length - WEEK_CELL_LIMIT} more</span>}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
