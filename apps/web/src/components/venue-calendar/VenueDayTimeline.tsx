"use client";

import { AlertTriangle } from "lucide-react";
import { utcToSgt } from "@spm-t5/shared";
import { cn } from "@/lib/utils";
import { formatPeriodTimes, type CalendarVenue } from "@/lib/venueCalendar";
import { blocksForDay, hourBounds, hourLabel, nowPct, type TimelineBlock } from "@/lib/venueTimeline";
import { DetailsPopover, periodBadge, periodRows } from "./VenueCalendarDetails";
import { blockReason, KIND_NAME, periodLook, ReasonHint, STATUS_LOOK } from "./VenueCalendarPeriod";

const pct = (n: number) => `${Number(n.toFixed(3))}%`;
/** The width of the venue name column and of the whole grid, shared by the day, week and month views so they line up. */
export const NAME_COLUMN = "w-36 shrink-0 sm:w-44";

/** What a block says, beyond its icon and label: the event's occupied window, a block's reason, or setup/turnaround. */
function BlockText({ block }: { block: TimelineBlock }) {
  const { period } = block;
  if (period.kind === "setup" || period.kind === "turnaround") return <span className="sr-only">{KIND_NAME[period.kind]}</span>;
  // free time is the plain background, named for screen readers; closed time says so in words (SCRUM-84/AC3, AC4)
  if (period.kind === "open") return <span className="sr-only">{period.label}</span>;
  const Icon = STATUS_LOOK[period.status].icon;
  // closed time is background, so it is the icon over "Closed", centred, which fits an hour's width; its times are in the
  // details, and "Unavailable", the API's word, is kept for screen readers
  if (period.kind === "closed")
    return (
      <span className="flex w-full flex-col items-center font-semibold">
        <Icon aria-hidden="true" className="size-3.5" />
        {STATUS_LOOK.UNAVAILABLE.short}
        <span className="sr-only"> ({period.label})</span>
      </span>
    );
  return (
    <>
      <span className="flex w-full min-w-0 items-center gap-1 font-semibold">
        {period.overlaps_confirmed_booking ? <AlertTriangle aria-hidden="true" className="size-3 shrink-0" /> : <Icon aria-hidden="true" className="size-3 shrink-0" />}
        <span className="truncate">{period.kind === "block" ? blockReason(period) : period.label}</span>
      </span>
      <span className="w-full truncate">
        {block.startTime}–{block.endTime}
        {/* SCRUM-130/AC1: the whole time the booking holds the venue, setup and turnaround included */}
        {period.kind === "event" && period.occupied_start && period.occupied_end && (period.occupied_start !== period.start || period.occupied_end !== period.end)
          ? ` · occupied ${utcToSgt(new Date(period.occupied_start)).time}–${utcToSgt(new Date(period.occupied_end)).time}`
          : ""}
        {period.overlaps_confirmed_booking ? " · conflicts with a confirmed booking" : ""}
      </span>
    </>
  );
}

// SCRUM-85: choosing a block opens its details beside it (the same popover as the week and month views).
function Block({ venue, block }: { venue: CalendarVenue; block: TimelineBlock }) {
  const { period } = block;
  const background = period.kind === "open" || period.kind === "closed";
  return (
    <div
      data-block
      data-kind={period.kind}
      className={cn("absolute rounded-md text-xs", background ? "inset-y-0" : "inset-y-1.5", periodLook(period))}
      style={{ left: pct(block.leftPct), width: pct(block.widthPct) }}
    >
      <DetailsPopover
        venue={venue}
        badge={periodBadge(period)}
        rows={periodRows(period, venue)}
        triggerLabel={`Details: ${period.label}${KIND_NAME[period.kind] ? ` ${KIND_NAME[period.kind]}` : ""}, ${formatPeriodTimes(period.start, period.end)}`}
        triggerClassName="relative flex size-full flex-col items-start justify-center overflow-hidden rounded-md px-2 text-left focus-visible:z-10"
      >
        <BlockText block={block} />
      </DetailsPopover>
      {period.kind === "block" && (
        <span className="absolute top-0 right-0 z-10">
          <ReasonHint text={blockReason(period)} />
        </span>
      )}
    </div>
  );
}

// SCRUM-130/AC1, AC2 (Figma 09): one day, every venue a row, the hours across. Setup and turnaround are dashed either side of a
// booking, a block is striped with its reason, and a red line marks now. It scrolls sideways inside its box on a narrow screen.
export function VenueDayView({ venues, date, now }: { venues: CalendarVenue[]; date: string; now?: Date }) {
  const { startHour, endHour } = hourBounds(venues, date);
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const clock = now ?? new Date();
  const nowAt = nowPct(date, startHour, endHour, clock);
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card" role="region" aria-label={`Venue timeline for ${date}`} tabIndex={0}>
      <div className="min-w-3xl">
        <div className="flex border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground">
          <div className={cn(NAME_COLUMN, "sticky left-0 z-20 bg-muted px-4 py-2")}>Venue</div>
          <div className="relative flex-1">
            {hours.map((hour, i) => (
              <span key={hour} className="absolute top-2 pl-1" style={{ left: pct((i / hours.length) * 100) }}>
                {hourLabel(hour)}
              </span>
            ))}
            {nowAt !== null && (
              <span data-now-label className="absolute top-1.5 z-10 -translate-x-1/2 rounded-full bg-destructive px-1.5 font-semibold text-primary-foreground" style={{ left: pct(nowAt) }}>
                {utcToSgt(clock).time}
              </span>
            )}
          </div>
        </div>
        {venues.map((venue) => (
          <div key={venue.id} data-venue-row className="flex border-b border-border last:border-b-0">
            <div className={cn(NAME_COLUMN, "sticky left-0 z-20 border-r border-border bg-card px-4 py-3")}>
              <p className="truncate text-sm font-semibold text-foreground">{venue.name}</p>
              <p className="text-xs text-muted-foreground">Capacity {venue.max_capacity}</p>
            </div>
            <div className="relative h-16 flex-1">
              {hours.map((hour, i) => (
                <span key={hour} aria-hidden="true" className="absolute inset-y-0 border-l border-border" style={{ left: pct((i / hours.length) * 100) }} />
              ))}
              {blocksForDay(venue.periods, date, startHour, endHour).map((block) => (
                <Block key={`${block.period.start}-${block.period.kind}`} venue={venue} block={block} />
              ))}
              {nowAt !== null && <span aria-hidden="true" data-now className="absolute inset-y-0 z-10 w-0.5 bg-destructive" style={{ left: pct(nowAt) }} />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
