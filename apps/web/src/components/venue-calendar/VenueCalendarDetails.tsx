"use client";

import { X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { utcToSgt } from "@spm-t5/shared";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatusBadge } from "@/components/ui/status-badge";
import type { StatusTone } from "@/lib/status";
import { cn } from "@/lib/utils";
import { formatPeriodInstant, type CalendarPeriod, type CalendarStatus, type CalendarVenue } from "@/lib/venueCalendar";
import { blocksForDay, busyOnDay, dayStatus, freeWindow, nextFreeWindow, shortDay, type JoinedBlock } from "@/lib/venueTimeline";
import { blockReason, STATUS_LOOK } from "./VenueCalendarPeriod";

export type DetailRow = [term: string, text: string];
const time = (iso: string) => utcToSgt(new Date(iso)).time;
const TONE: Record<CalendarStatus, StatusTone> = {
  CONFIRMED: "success", TENTATIVELY_HELD: "info", BLOCKED: "neutral", AVAILABLE: "success", UNAVAILABLE: "neutral",
};

/**
 * SCRUM-85/AC1 to AC4, Figma 09a: what one period is and when. A booking gives the day it is held, its setup and turnaround and the
 * next free window; anything else gives when it starts and ends and what it is (the free window, a block's reason, the booking a
 * setup or turnaround belongs to, or that the venue is closed). `block` is the whole block when the service cut it into pieces.
 */
export function periodRows(period: CalendarPeriod, venue: CalendarVenue, block?: JoinedBlock): DetailRow[] {
  if (period.kind === "event") {
    const rows: DetailRow[] = [["Held", `${shortDay(utcToSgt(new Date(period.start)).date)}, ${time(period.start)}–${time(period.end)}`]];
    if (period.occupied_start && period.occupied_start !== period.start) rows.push(["Setup", `${time(period.occupied_start)}–${time(period.start)}`]);
    if (period.occupied_end && period.occupied_end !== period.end) rows.push(["Turnaround", `${time(period.end)}–${time(period.occupied_end)}`]);
    const next = nextFreeWindow(venue.periods, period.occupied_end ?? period.end);
    if (next) rows.push(["Next free window", next]);
    return rows;
  }
  const start = block?.start ?? period.start;
  const end = block?.end ?? period.end;
  const rows: DetailRow[] = [["Starts", formatPeriodInstant(start)], ["Ends", formatPeriodInstant(end)]];
  switch (period.kind) {
    case "open":
      return [...rows, ["Free window", `Free from ${formatPeriodInstant(start)} until ${formatPeriodInstant(end)}`]];
    case "block":
      return [
        ...rows,
        ...(period.reason_label ? [["Reason", period.reason_label] as DetailRow] : []),
        ...((block?.overlapsConfirmed ?? period.overlaps_confirmed_booking) ? [["Note", "Conflicts with a confirmed booking"] as DetailRow] : []),
      ];
    case "setup": {
      const booking = venue.periods.find((p) => p.kind === "event" && p.start === period.end);
      return [...rows, ["What it is", booking ? `Setup time for the booking that starts ${formatPeriodInstant(booking.start)}` : "Setup time for a booking that starts after this period"]];
    }
    case "turnaround": {
      const booking = venue.periods.find((p) => p.kind === "event" && p.end === period.start);
      return [...rows, ["What it is", booking ? `Turnaround time for the booking that ends ${formatPeriodInstant(booking.end)}` : "Turnaround time for a booking that ends before this period"]];
    }
    default:
      return [...rows, ["Why", "Outside operating hours"]];
  }
}

/** The status badge of a period: its label, in red with "conflict" when a block lies over a confirmed booking. */
export function periodBadge(period: CalendarPeriod, block?: JoinedBlock): { label: string; tone: StatusTone } {
  return (block?.overlapsConfirmed ?? period.overlaps_confirmed_booking)
    ? { label: `${period.label} · conflict`, tone: "danger" }
    : { label: period.label, tone: TONE[period.status] };
}

/** Month view: a day of a venue, as its busiest status and each booking and block with its times, or that it is free or closed. */
export function dayDetails(venue: CalendarVenue, day: string): { badge: { label: string; tone: StatusTone }; rows: DetailRow[] } {
  const status = dayStatus(venue.periods, day);
  const busy = busyOnDay(venue.periods, day);
  const free = freeWindow(venue.periods, day);
  const rows: DetailRow[] =
    busy.length > 0
      ? busy.map((p) => {
          const [part] = blocksForDay([p], day, 0, 24);
          return [p.kind === "block" ? blockReason(p) : p.label, `${part.startTime}–${part.endTime}`];
        })
      : free
        ? [["Available", `${free.start}–${free.end}`]]
        : [["Why", "Outside operating hours"]];
  return { badge: { label: STATUS_LOOK[status].short, tone: TONE[status] }, rows: [["Day", shortDay(day)], ...rows] };
}

// SCRUM-85, Figma 09a: choosing a period (or a month day) opens its details beside it: the venue, a status badge, the rows, and
// Open day view where there is a day to go to. Escape, clicking outside or Close shuts it.
export function DetailsPopover({
  venue,
  badge,
  rows,
  triggerLabel,
  triggerClassName,
  onOpenDay,
  children,
}: {
  venue: CalendarVenue;
  badge: { label: string; tone: StatusTone };
  rows: DetailRow[];
  triggerLabel: string;
  triggerClassName: string;
  /** Shown as Open day view; left out on the day view itself. */
  onOpenDay?: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={triggerLabel}
        className={cn("focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", triggerClassName, open && "z-10 ring-2 ring-fg-primary")}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="gap-3 p-4" aria-label="Availability details">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-bold text-foreground">{venue.name}</p>
            <p className="text-xs text-muted-foreground">{venue.address} · Max capacity {venue.max_capacity}</p>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Close details" onClick={() => setOpen(false)}>
            <X aria-hidden="true" />
          </Button>
        </div>
        <StatusBadge label={badge.label} tone={badge.tone} className="self-start" />
        <dl className="flex flex-col gap-1.5 text-sm">
          {rows.map(([term, text], i) => (
            <div key={`${term}-${i}`} className="flex gap-3">
              <dt className="w-32 shrink-0 text-muted-foreground">{term}</dt>
              <dd className="min-w-0 font-medium break-words text-foreground">{text}</dd>
            </div>
          ))}
        </dl>
        {onOpenDay && (
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => { setOpen(false); onOpenDay(); }}>
            Open day view
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
