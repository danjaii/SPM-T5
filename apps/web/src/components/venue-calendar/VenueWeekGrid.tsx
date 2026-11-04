"use client";

import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatPeriodTimes, type CalendarPeriod, type CalendarVenue } from "@/lib/venueCalendar";
import { blocksForDay, hourBounds, weekChunks, type DayBlock } from "@/lib/venueWeekGrid";
import { VenueCalendarDetails } from "./VenueCalendarDetails";
import { KIND_NAME, ReasonHint, STATUS_LOOK } from "./VenueCalendarPeriod";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Sat 14 Nov": the Singapore date as a column heading. */
function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
/** Each hour of the day takes this much height (a whole day column is 16 hours at 3 rem each by default). */
const HOUR_REM = 3;
const pct = (n: number) => `${Number(n.toFixed(3))}%`;
const keyOf = (p: CalendarPeriod) => `${p.start}-${p.kind}`;

/** How one kind of period looks on the grid. Status is always the icon and its words as well as the colour. */
function blockLook(period: CalendarPeriod): string {
  // SCRUM-130/AC1: setup and turnaround are tinted and dashed, so they read as time around the event, not the event
  if (period.kind === "setup" || period.kind === "turnaround") return "border border-dashed border-border-strong bg-muted/60 text-foreground";
  // free time is a light wash; time outside operating hours is neutral; neither competes with the bookings
  if (period.kind === "open") return "bg-status-success/30 text-status-success-fg";
  if (period.kind === "closed") return "bg-status-neutral/60 text-status-neutral-fg";
  return cn("border border-border-strong", STATUS_LOOK[period.status].className);
}

function GridBlock({ block, selected, onSelect }: { block: DayBlock; selected: boolean; onSelect: () => void }) {
  const { period } = block;
  const Icon = STATUS_LOOK[period.status].icon;
  const name = `Details: ${period.label}, ${formatPeriodTimes(period.start, period.end)}`;
  return (
    <div
      data-block
      data-kind={period.kind}
      className={cn(
        "absolute inset-x-0.5 overflow-hidden rounded-md text-xs",
        blockLook(period),
        // SCRUM-130/AC2: a block is striped, so it is not told apart by colour alone
        period.kind === "block" && "calendar-block",
        selected && "ring-2 ring-ring",
      )}
      style={{ top: pct(block.topPct), height: pct(block.heightPct) }}
    >
      <button
        type="button"
        aria-label={name}
        aria-pressed={selected}
        onClick={onSelect}
        className="flex size-full flex-col items-start gap-0.5 overflow-hidden p-1 text-left focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="flex items-center gap-1 font-semibold">
          <Icon aria-hidden="true" className="size-3 shrink-0" />
          {period.label}
        </span>
        {KIND_NAME[period.kind] && <span>{KIND_NAME[period.kind]}</span>}
        <span className="text-muted-foreground">{block.startTime}–{block.endTime}</span>
        {period.overlaps_confirmed_booking && (
          <span className="flex items-center gap-1 font-semibold text-status-danger-fg">
            <AlertTriangle aria-hidden="true" className="size-3 shrink-0" />
            Conflicts with a confirmed booking
          </span>
        )}
      </button>
      {period.kind === "block" && (
        <span className="absolute top-0 right-0 z-10">
          <ReasonHint text={period.reason_label ? `${period.label}: ${period.reason_label}` : period.label} />
        </span>
      )}
    </div>
  );
}

/**
 * SCRUM-130/AC1 (Figma frame 09): one venue as a week grid. Days run across, hours run down, and every booking, hold, setup,
 * turnaround, block and free or closed stretch sits at its time. A longer range is shown a week at a time. Choosing a block opens the
 * availability details (SCRUM-85); Venue Staff also get Mark unavailable (AC3).
 */
export function VenueWeekGrid({ venue, range, onMarkUnavailable }: { venue: CalendarVenue; range: { from: string; to: string }; onMarkUnavailable?: () => void }) {
  const headingId = `venue-week-${venue.id}`;
  const [selected, setSelected] = useState<string | null>(null);
  const chosen = venue.periods.find((p) => keyOf(p) === selected);
  const { startHour, endHour } = hourBounds(venue.periods);
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);
  const height = `${(endHour - startHour) * HOUR_REM}rem`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-0.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={headingId} className="text-lg font-bold text-foreground">{venue.name}</h2>
          {/* SCRUM-130/AC3: only Venue Staff are given this (the page decides; the service and database check it again) */}
          {onMarkUnavailable && (
            <Button type="button" variant="outline" size="sm" aria-label={`Mark ${venue.name} unavailable`} onClick={onMarkUnavailable}>
              Mark unavailable
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{venue.address} · Capacity {venue.max_capacity}</p>
        <p className="text-sm text-muted-foreground">
          {venue.operating_hours ? `Open ${venue.operating_hours.start} to ${venue.operating_hours.end}` : "Open at any time"}
        </p>
      </div>

      {weekChunks(range.from, range.to).map((days) => (
        // a week may be wider than the screen: it scrolls sideways inside its own box, which the keyboard can reach
        <div
          key={days[0]}
          role="region"
          aria-label={`${venue.name}, week of ${dayLabel(days[0])}`}
          tabIndex={0}
          className="overflow-x-auto rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <div className="grid min-w-max" style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(7rem, 1fr))` }}>
            <div>
              <div className="py-1 text-sm">&nbsp;</div>
              <div data-testid="hour-labels" className="relative text-xs text-muted-foreground" style={{ height }}>
                {hours.filter((h, i) => i % 2 === 0 || h === endHour).map((h) => (
                  <span key={h} className="absolute right-1 -translate-y-1/2" style={{ top: pct(((h - startHour) / (endHour - startHour)) * 100) }}>
                    {String(h).padStart(2, "0")}:00
                  </span>
                ))}
              </div>
            </div>
            {days.map((date) => (
              <div key={date} role="group" aria-label={dayLabel(date)} className="border-l border-border">
                <div className="py-1 text-center text-sm font-medium text-foreground">{dayLabel(date)}</div>
                <div className="relative" style={{ height }}>
                  {hours.map((h) => (
                    <div key={h} aria-hidden="true" className="absolute inset-x-0 border-t border-border" style={{ top: pct(((h - startHour) / (endHour - startHour)) * 100) }} />
                  ))}
                  {blocksForDay(venue.periods, date, startHour, endHour).map((block) => (
                    <GridBlock key={`${keyOf(block.period)}-${date}`} block={block} selected={keyOf(block.period) === selected} onSelect={() => setSelected(keyOf(block.period))} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {chosen && <VenueCalendarDetails venue={venue} period={chosen} onClose={() => setSelected(null)} />}
    </section>
  );
}
