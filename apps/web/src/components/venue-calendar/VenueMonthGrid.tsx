"use client";

import { cn } from "@/lib/utils";
import type { CalendarVenue } from "@/lib/venueCalendar";
import { dayStatus, daysOf, shortDay } from "@/lib/venueTimeline";
import { STATUS_LOOK } from "./VenueCalendarPeriod";
import { NAME_COLUMN } from "./VenueDayTimeline";

// SCRUM-130 (Month): every venue a row, the days across, each cell the day's busiest status as its icon and a word. Choosing a cell
// opens that day in the day view.
export function VenueMonthGrid({
  venues,
  from,
  to,
  today,
  onOpenDay,
}: {
  venues: CalendarVenue[];
  from: string;
  to: string;
  today: string;
  onOpenDay: (date: string) => void;
}) {
  const days = daysOf(from, to);
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card" role="region" aria-label={`Venue month from ${from} to ${to}`} tabIndex={0}>
      <div className="w-max min-w-full">
        <div className="flex border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground">
          <div className={cn(NAME_COLUMN, "sticky left-0 z-20 bg-muted px-4 py-2")}>Venue</div>
          {days.map((day) => (
            <div key={day} className={cn("w-14 shrink-0 px-1 py-2 text-center", day === today && "font-bold text-fg-primary")}>
              {Number(day.slice(8))}
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
              const status = dayStatus(venue.periods, day);
              const { icon: Icon, className, short } = STATUS_LOOK[status];
              return (
                <button
                  key={day}
                  type="button"
                  aria-label={`Open ${venue.name} on ${shortDay(day)}: ${short}`}
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
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
