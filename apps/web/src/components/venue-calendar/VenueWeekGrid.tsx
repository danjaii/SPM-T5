"use client";

import { AlertTriangle, Lock } from "lucide-react";
import type { ReactNode } from "react";
import { formatShortSgt } from "@spm-t5/shared";
import { cn } from "@/lib/utils";
import type { CalendarPeriod, CalendarVenue } from "@/lib/venueCalendar";
import {
  BAR_END_HOUR, BAR_START_HOUR, blocksForDay, busyOnDay, daysOf, freeWindow, shortDay, spanningBlocks, type SpanningBlock,
} from "@/lib/venueTimeline";
import { DetailsPopover, periodBadge, periodRows } from "./VenueCalendarDetails";
import { blockReason, STATUS_LOOK } from "./VenueCalendarPeriod";
import { NAME_COLUMN } from "./VenueDayTimeline";

const WEEKDAY = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const pct = (n: number) => `${Number(n.toFixed(3))}%`;

/** A segment of the occupancy bar: bookings dark, setup and turnaround grey, blocks dark grey or red over a confirmed booking. */
function barColour(p: CalendarPeriod): string {
  if (p.kind === "setup" || p.kind === "turnaround") return "bg-border-strong";
  if (p.kind === "block") return p.overlaps_confirmed_booking ? "bg-status-danger-fg" : "bg-status-neutral-fg";
  return p.status === "CONFIRMED" ? "bg-status-success-fg" : "bg-status-info-fg";
}

/** Figma 09a: the thin bar at the top of a day showing which of its hours, 08:00 to 22:00, are occupied. */
function OccupancyBar({ periods, day }: { periods: CalendarPeriod[]; day: string }) {
  const segments = blocksForDay(periods.filter((p) => p.kind !== "open" && p.kind !== "closed"), day, BAR_START_HOUR, BAR_END_HOUR);
  return (
    <span data-bar aria-hidden="true" className="relative block h-1.5 shrink-0 overflow-hidden rounded-full bg-muted">
      {segments.map((s) => (
        <span key={`${s.period.start}-${s.period.kind}`} data-kind={s.period.kind} className={cn("absolute inset-y-0", barColour(s.period))} style={{ left: pct(s.leftPct), width: pct(s.widthPct) }} />
      ))}
    </span>
  );
}

/** A period on the week grid, opening its details (SCRUM-85, Figma 09a) with Open day view. */
function PeriodPopover({
  venue, period, day, span, onOpenDay, className, children,
}: {
  venue: CalendarVenue;
  period: CalendarPeriod;
  day: string;
  span?: SpanningBlock;
  onOpenDay: (date: string) => void;
  className: string;
  children: ReactNode;
}) {
  return (
    <DetailsPopover
      venue={venue}
      badge={periodBadge(period, span)}
      rows={periodRows(period, venue, span)}
      triggerLabel={`Details: ${period.kind === "block" ? blockReason(period) : period.label}, ${venue.name}, ${shortDay(day)}`}
      triggerClassName={cn("flex min-w-0 flex-col items-stretch rounded-md px-1.5 py-1 text-left text-xs", className)}
      onOpenDay={() => onOpenDay(day)}
    >
      {children}
    </DetailsPopover>
  );
}

/** One booking or single-day block in a day cell: its status in words with its icon, and its times that day. */
function Chip({ venue, period, day, onOpenDay }: { venue: CalendarVenue; period: CalendarPeriod; day: string; onOpenDay: (date: string) => void }) {
  const [part] = blocksForDay([period], day, 0, 24);
  const { icon: Icon, className } = STATUS_LOOK[period.status];
  const conflict = period.overlaps_confirmed_booking;
  const look =
    period.kind === "block"
      ? cn("calendar-block border", conflict ? "border-status-danger-fg bg-status-danger text-status-danger-fg" : "border-border-strong bg-status-neutral text-status-neutral-fg")
      : cn("border", className, period.status === "TENTATIVELY_HELD" ? "border-dashed border-status-info-fg" : "border-transparent");
  return (
    <PeriodPopover venue={venue} period={period} day={day} onOpenDay={onOpenDay} className={look}>
      <span className="flex items-center gap-1 truncate font-semibold">
        {conflict ? <AlertTriangle aria-hidden="true" className="size-3 shrink-0" /> : <Icon aria-hidden="true" className="size-3 shrink-0" />}
        <span className="truncate">{period.kind === "block" ? blockReason(period) : period.label}</span>
      </span>
      <span className="truncate">{part.startTime}–{part.endTime}</span>
    </PeriodPopover>
  );
}

/** Figma 09a: a block over several days, drawn once across them with its reason and when it starts and ends. */
function Banner({ venue, span, days, onOpenDay }: { venue: CalendarVenue; span: SpanningBlock; days: string[]; onOpenDay: (date: string) => void }) {
  const count = days.length;
  return (
    <div data-banner className="absolute top-6 z-10 px-1" style={{ left: pct((span.first / count) * 100), width: pct(((span.last - span.first + 1) / count) * 100) }}>
      <PeriodPopover
        venue={venue}
        period={span.period}
        day={days[span.first]}
        span={span}
        onOpenDay={onOpenDay}
        className={cn("calendar-block w-full flex-row items-center gap-2 border px-3 py-2 shadow-sm", span.overlapsConfirmed ? "border-status-danger-fg bg-status-danger text-status-danger-fg" : "border-border-strong bg-status-neutral text-status-neutral-fg")}
      >
        <Lock aria-hidden="true" className="size-4 shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-semibold">{span.period.label}{span.period.reason_label ? ` · ${span.period.reason_label}` : ""}</span>
          <span className="truncate">{formatShortSgt(new Date(span.start))} – {formatShortSgt(new Date(span.end))}</span>
        </span>
        {span.overlapsConfirmed && (
          <span className="flex shrink-0 items-center gap-1 font-semibold">
            <AlertTriangle aria-hidden="true" className="size-3.5" />
            Overlaps a confirmed booking
          </span>
        )}
      </PeriodPopover>
    </div>
  );
}

// SCRUM-130 (Figma 09a): the week. Every venue a row and the seven days across; each day has an occupancy bar for 08:00 to 22:00
// and its bookings and single-day blocks as chips, or says it is available or closed. A block over several days is one banner.
// Today's column is tinted. Choosing a period opens its details; Open day view goes to that day.
export function VenueWeekGrid({
  venues, from, to, today, onOpenDay,
}: {
  venues: CalendarVenue[];
  from: string;
  to: string;
  today: string;
  onOpenDay: (date: string) => void;
}) {
  const days = daysOf(from, to);
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card" role="region" aria-label={`Venue week from ${from} to ${to}`} tabIndex={0}>
      <div className="min-w-4xl">
        <div className="flex border-b border-border bg-muted/40">
          <div className={cn(NAME_COLUMN, "sticky left-0 z-20 flex items-end bg-muted px-4 py-2 text-xs font-medium text-muted-foreground")}>Venue</div>
          {days.map((day) => (
            <div key={day} data-today={day === today || undefined} className={cn("flex flex-1 flex-col border-l border-border px-2 py-2", day === today && "bg-status-info")}>
              <span className="text-xs font-medium text-muted-foreground">{WEEKDAY[new Date(`${day}T00:00:00.000Z`).getUTCDay()]}</span>
              <span className="text-sm font-bold text-foreground">{shortDay(day).slice(4)}</span>
            </div>
          ))}
        </div>
        {venues.map((venue) => {
          const spans = spanningBlocks(venue.periods, days);
          const covered = (i: number) => spans.some((s) => i >= s.first && i <= s.last);
          return (
            <div key={venue.id} data-venue-row className="flex border-b border-border last:border-b-0">
              <div className={cn(NAME_COLUMN, "sticky left-0 z-20 border-r border-border bg-card px-4 py-3")}>
                <p className="truncate text-sm font-semibold text-foreground">{venue.name}</p>
                <p className="text-xs text-muted-foreground">Capacity {venue.max_capacity}</p>
              </div>
              <div className="relative flex flex-1">
                {days.map((day, i) => {
                  const busy = covered(i) ? [] : busyOnDay(venue.periods, day);
                  const free = freeWindow(venue.periods, day);
                  return (
                    <div
                      key={day}
                      data-day={day}
                      className={cn("flex min-h-24 min-w-0 flex-1 flex-col gap-1.5 border-l border-border p-2", day === today && "bg-status-info/40", !free && busy.length === 0 && !covered(i) && "bg-muted")}
                    >
                      <OccupancyBar periods={venue.periods} day={day} />
                      {covered(i) ? null : busy.length > 0 ? (
                        busy.map((p) => <Chip key={`${p.start}-${p.kind}`} venue={venue} period={p} day={day} onOpenDay={onOpenDay} />)
                      ) : free ? (
                        <span className="text-xs text-muted-foreground">
                          <span className="block font-medium text-foreground">Available</span>
                          {free.start}–{free.end}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          <span className="block font-medium text-foreground">Closed</span>
                          Outside operating hours
                        </span>
                      )}
                    </div>
                  );
                })}
                {spans.map((span) => <Banner key={span.start} venue={venue} span={span} days={days} onOpenDay={onOpenDay} />)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
