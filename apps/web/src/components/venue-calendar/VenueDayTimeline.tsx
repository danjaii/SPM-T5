"use client";

import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { utcToSgt } from "@spm-t5/shared";
import { cn } from "@/lib/utils";
import { formatPeriodTimes, type CalendarPeriod, type CalendarVenue } from "@/lib/venueCalendar";
import { blocksForDay, hourBounds, hourLabel, nowPct, type TimelineBlock } from "@/lib/venueTimeline";
import { VenueCalendarDetails } from "./VenueCalendarDetails";
import { blockReason, KIND_NAME, periodLook, ReasonHint, STATUS_LOOK } from "./VenueCalendarPeriod";

const pct = (n: number) => `${Number(n.toFixed(3))}%`;
export const periodKey = (venueId: string, p: CalendarPeriod) => `${venueId}:${p.start}-${p.kind}`;
/** The width of the venue name column and of the whole grid, shared by the day, week and month views so they line up. */
export const NAME_COLUMN = "w-36 shrink-0 sm:w-44";

/** What a block says, beyond its icon and label: the event's occupied window, a block's reason, or setup/turnaround. */
function BlockText({ block }: { block: TimelineBlock }) {
  const { period } = block;
  if (period.kind === "setup" || period.kind === "turnaround") return <span className="sr-only">{KIND_NAME[period.kind]}</span>;
  // free time is the plain background, named for screen readers; closed time says so in words (SCRUM-84/AC3, AC4)
  if (period.kind === "open") return <span className="sr-only">{period.label}</span>;
  const Icon = STATUS_LOOK[period.status].icon;
  return (
    <>
      <span className="flex items-center gap-1 truncate font-semibold">
        {period.overlaps_confirmed_booking ? <AlertTriangle aria-hidden="true" className="size-3 shrink-0" /> : <Icon aria-hidden="true" className="size-3 shrink-0" />}
        {period.kind === "block" ? blockReason(period) : period.label}
      </span>
      <span className="truncate">
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

function Block({ venueId, block, selected, onSelect }: { venueId: string; block: TimelineBlock; selected: boolean; onSelect: (key: string) => void }) {
  const { period } = block;
  const background = period.kind === "open" || period.kind === "closed";
  return (
    <div
      data-block
      data-kind={period.kind}
      className={cn("absolute rounded-md text-xs", background ? "inset-y-0" : "inset-y-1.5", periodLook(period), selected && "z-10 ring-2 ring-ring")}
      style={{ left: pct(block.leftPct), width: pct(block.widthPct) }}
    >
      <button
        type="button"
        aria-label={`Details: ${period.label}${KIND_NAME[period.kind] ? ` ${KIND_NAME[period.kind]}` : ""}, ${formatPeriodTimes(period.start, period.end)}`}
        aria-pressed={selected}
        onClick={() => onSelect(periodKey(venueId, period))}
        className="flex size-full flex-col items-start justify-center overflow-hidden rounded-md px-2 text-left focus-visible:relative focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <BlockText block={block} />
      </button>
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
export function VenueDayTimeline({
  venues,
  date,
  selected,
  onSelect,
  now,
}: {
  venues: CalendarVenue[];
  date: string;
  selected: string | null;
  onSelect: (key: string) => void;
  now?: Date;
}) {
  const { startHour, endHour } = hourBounds(venues, date);
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const nowAt = nowPct(date, startHour, endHour, now);
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
                {utcToSgt(now ?? new Date()).time}
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
                <Block
                  key={periodKey(venue.id, block.period)}
                  venueId={venue.id}
                  block={block}
                  selected={selected === periodKey(venue.id, block.period)}
                  onSelect={onSelect}
                />
              ))}
              {nowAt !== null && <span aria-hidden="true" data-now className="absolute inset-y-0 z-10 w-0.5 bg-destructive" style={{ left: pct(nowAt) }} />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** SCRUM-85 on the day view: choosing a block opens its details under the timeline; choosing it again, or Close, shuts them. */
export function VenueDayView({ venues, date, now }: { venues: CalendarVenue[]; date: string; now?: Date }) {
  const [selected, setSelected] = useState<string | null>(null);
  const chosen = venues.flatMap((venue) => venue.periods.map((period) => ({ venue, period }))).find(({ venue, period }) => periodKey(venue.id, period) === selected);
  return (
    <>
      <VenueDayTimeline venues={venues} date={date} selected={selected} onSelect={(key) => setSelected(key === selected ? null : key)} now={now} />
      {chosen && <VenueCalendarDetails venue={chosen.venue} period={chosen.period} onClose={() => setSelected(null)} />}
    </>
  );
}
