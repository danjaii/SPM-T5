"use client";

import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CalendarVenue } from "@/lib/venueCalendar";
import { dayStatus, daysOf, monthRuns, shortDay, type MonthRun } from "@/lib/venueTimeline";
import { DetailsPopover, dayDetails, runDetails } from "./VenueCalendarDetails";
import { STATUS_LOOK } from "./VenueCalendarPeriod";
import { NAME_COLUMN } from "./VenueDayTimeline";

const pct = (n: number) => `${Number(n.toFixed(3))}%`;

/** How a run of busy days looks: booked green, held teal, blocked grey and striped, and red where a block lies over a booking. */
function runLook(run: MonthRun): string {
  if (run.conflict) return "calendar-block border-status-danger-fg bg-status-danger text-status-danger-fg";
  if (run.status === "BLOCKED") return "calendar-block border-border-strong bg-status-neutral text-status-neutral-fg";
  return cn(STATUS_LOOK[run.status].className, run.status === "CONFIRMED" ? "border-status-success-fg" : "border-status-info-fg");
}

// SCRUM-130 (Month): every venue a row and the days across. Free days are left empty and closed days grey; consecutive days with
// the same booked, held or blocked status are one bar with its icon and word. Choosing a bar, or an empty day, opens its details
// (the same popover as the day and week views) with Open day view.
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
            <div key={day} className={cn("w-12 shrink-0 border-l border-border px-1 py-2 text-center", day === today && "bg-status-info font-bold text-fg-primary")}>
              {Number(day.slice(8))}
            </div>
          ))}
        </div>
        {venues.map((venue) => {
          const runs = monthRuns(venue.periods, days);
          const inRun = (i: number) => runs.some((r) => i >= r.first && i <= r.last);
          return (
            <div key={venue.id} data-venue-row className="flex border-b border-border last:border-b-0">
              <div className={cn(NAME_COLUMN, "sticky left-0 z-20 border-r border-border bg-card px-4 py-3")}>
                <p className="truncate text-sm font-semibold text-foreground">{venue.name}</p>
                <p className="text-xs text-muted-foreground">Capacity {venue.max_capacity}</p>
              </div>
              <div className="relative flex h-14">
                {days.map((day, i) => {
                  const cell = cn("w-12 shrink-0 border-l border-border", day === today && "bg-status-info/40");
                  if (inRun(i)) return <div key={day} className={cell} />;
                  const status = dayStatus(venue.periods, day);
                  const { short } = STATUS_LOOK[status];
                  return (
                    <DetailsPopover
                      key={day}
                      venue={venue}
                      {...dayDetails(venue, day)}
                      triggerLabel={`Details: ${venue.name} on ${shortDay(day)}: ${short}`}
                      onOpenDay={() => onOpenDay(day)}
                      triggerClassName={cn(cell, "hover:bg-muted/60", status === "UNAVAILABLE" && "bg-muted")}
                    >
                      <span className="sr-only">{short}</span>
                    </DetailsPopover>
                  );
                })}
                {runs.map((run) => {
                  const { icon: Icon, short } = STATUS_LOOK[run.status];
                  const first = days[run.first];
                  const last = days[run.last];
                  return (
                    <div
                      key={run.first}
                      data-run={run.status}
                      className="absolute inset-y-1.5 z-10 px-0.5"
                      style={{ left: pct((run.first / days.length) * 100), width: pct(((run.last - run.first + 1) / days.length) * 100) }}
                    >
                      <DetailsPopover
                        venue={venue}
                        {...runDetails(venue, days, run)}
                        triggerLabel={`Details: ${venue.name}, ${short}${run.conflict ? " (conflict)" : ""}, ${first === last ? shortDay(first) : `${shortDay(first)} to ${shortDay(last)}`}`}
                        onOpenDay={() => onOpenDay(first)}
                        triggerClassName={cn("flex size-full items-center justify-center gap-1 overflow-hidden rounded-lg border px-1 text-xs font-medium", first === last && "flex-col gap-0", runLook(run))}
                      >
                        {run.conflict ? <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" /> : <Icon aria-hidden="true" className="size-3.5 shrink-0" />}
                        <span className="truncate">{short}</span>
                      </DetailsPopover>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
