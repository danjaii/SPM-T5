import { addDays, sgtToUtc, unavailabilityReasonLabel, type CalendarRange } from "@spm-t5/shared";
import type { CalendarBlock, CalendarBooking, CalendarVenue } from "../readers/venueCalendarReader";

export type CalendarStatus = "TENTATIVELY_HELD" | "CONFIRMED" | "BLOCKED" | "AVAILABLE" | "UNAVAILABLE";

/** The exact words the calendar shows (SCRUM-84 AC2 to AC4). A block is "Blocked"; "Unavailable" is only closed hours. */
export const STATUS_LABELS: Record<CalendarStatus, string> = {
  TENTATIVELY_HELD: "Tentatively Held",
  CONFIRMED: "Confirmed",
  BLOCKED: "Blocked",
  AVAILABLE: "Available",
  UNAVAILABLE: "Unavailable",
};

export type CalendarKind = "open" | "closed" | "event" | "setup" | "turnaround" | "block";

/** A period as the API returns it. Fields after `end` exist only for the kind that needs them; callers ignore ones they do not know. */
export interface CalendarPeriod {
  kind: CalendarKind;
  status: CalendarStatus;
  label: string;
  start: string;
  end: string;
  event_start?: string;
  event_end?: string;
  occupied_start?: string;
  occupied_end?: string;
  setup_minutes?: number;
  turnaround_minutes?: number;
  reason?: string;
  reason_label?: string;
  /** Only on blocks: true over the stretch that overlaps the event, setup or turnaround of a Confirmed booking. */
  overlaps_confirmed_booking?: boolean;
}

export interface CalendarVenueView {
  id: string;
  name: string;
  address: string;
  max_capacity: number;
  /** Singapore local time "HH:MM", or null when the venue has no limit. */
  operating_hours: { start: string; end: string } | null;
  periods: CalendarPeriod[];
}

/** What lies over a stretch of time. The one with the highest `priority` wins where several overlap (spec: precedence). */
interface Interval {
  start: number;
  end: number;
}

interface Segment {
  priority: number;
  /** Adjacent stretches with the same key are one period. */
  key: string;
  kind: CalendarKind;
  status: CalendarStatus;
  start: number;
  end: number;
  extra?: Partial<CalendarPeriod>;
}

const PRIORITY = { block: 100, eventConfirmed: 80, eventHeld: 70, bufferConfirmed: 60, bufferHeld: 50, open: 10, closed: 5 } as const;

const iso = (ms: number) => new Date(ms).toISOString();

function bookingSegments(b: CalendarBooking, id: number): Segment[] {
  const confirmed = b.status === "CONFIRMED";
  const event: Segment = {
    priority: confirmed ? PRIORITY.eventConfirmed : PRIORITY.eventHeld,
    key: `event:${id}`,
    kind: "event",
    status: b.status,
    start: b.eventStart.getTime(),
    end: b.eventEnd.getTime(),
    extra: {
      event_start: b.eventStart.toISOString(),
      event_end: b.eventEnd.toISOString(),
      occupied_start: b.occupiedStart.toISOString(),
      occupied_end: b.occupiedEnd.toISOString(),
      setup_minutes: b.setupMinutes,
      turnaround_minutes: b.turnaroundMinutes,
    },
  };
  const buffer = { priority: confirmed ? PRIORITY.bufferConfirmed : PRIORITY.bufferHeld, status: b.status };
  return [
    event,
    { ...buffer, key: `setup:${id}`, kind: "setup", start: b.occupiedStart.getTime(), end: b.eventStart.getTime() },
    { ...buffer, key: `turnaround:${id}`, kind: "turnaround", start: b.eventEnd.getTime(), end: b.occupiedEnd.getTime() },
  ];
}

/**
 * A block, cut wherever a Confirmed booking's occupied period (setup, event, turnaround) starts or ends inside it, so the pieces
 * lying over that period are flagged and the rest are not. A Pending booking never flags. The flag says nothing about which booking.
 */
function blockSegments(b: CalendarBlock, id: number, confirmed: Interval[]): Segment[] {
  const start = b.start.getTime();
  const end = b.end.getTime();
  const cuts = [...new Set([start, end, ...confirmed.flatMap((c) => [c.start, c.end])])].filter((t) => t >= start && t <= end).sort((x, y) => x - y);
  const label = unavailabilityReasonLabel(b.reason) ?? "Other";
  return cuts.slice(0, -1).map((from, i) => {
    const to = cuts[i + 1]!;
    const flagged = confirmed.some((c) => c.start < to && c.end > from);
    return {
      priority: PRIORITY.block,
      key: `block:${id}:${flagged}`,
      kind: "block",
      status: "BLOCKED",
      start: from,
      end: to,
      extra: { reason: b.reason, reason_label: label, overlaps_confirmed_booking: flagged },
    };
  });
}

/** Operating hours that mean something: both set and not equal. Anything else is no restriction (spec AC3 S2). */
function hoursOf(v: CalendarVenue): { start: string; end: string } | null {
  return v.operatingStart && v.operatingEnd && v.operatingStart !== v.operatingEnd ? { start: v.operatingStart, end: v.operatingEnd } : null;
}

/**
 * The stretches of the range when nothing else is on it: open inside the venue's operating hours (Singapore time, per day;
 * an end before the start runs into the next day), closed otherwise.
 */
function operatingSegments(venue: CalendarVenue, range: CalendarRange): Segment[] {
  const lo = range.start.getTime();
  const hi = range.end.getTime();
  const hours = hoursOf(venue);
  if (!hours) return [{ priority: PRIORITY.open, key: "open", kind: "open", status: "AVAILABLE", start: lo, end: hi }];

  const segments: Segment[] = [{ priority: PRIORITY.closed, key: "closed", kind: "closed", status: "UNAVAILABLE", start: lo, end: hi }];
  const overnight = hours.end < hours.start;
  // One day before the range, so the tail of an overnight window that began the evening before is included.
  for (let day = addDays(range.from, -1); day <= range.to; day = addDays(day, 1)) {
    const start = sgtToUtc(day, hours.start).getTime();
    const end = sgtToUtc(overnight ? addDays(day, 1) : day, hours.end).getTime();
    segments.push({ priority: PRIORITY.open, key: "open", kind: "open", status: "AVAILABLE", start, end });
  }
  return segments;
}

/** Cuts the range at every start and end, takes the winner of each piece, and joins neighbours with the same key. */
function resolve(segments: Segment[], range: CalendarRange): CalendarPeriod[] {
  const lo = range.start.getTime();
  const hi = range.end.getTime();
  const cuts = [...new Set([lo, hi, ...segments.flatMap((s) => [s.start, s.end])])].filter((t) => t >= lo && t <= hi).sort((a, b) => a - b);

  const out: { seg: Segment; start: number; end: number }[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const [start, end] = [cuts[i]!, cuts[i + 1]!];
    const covering = segments.filter((s) => s.start <= start && s.end >= end);
    const seg = covering.reduce((best, s) => (s.priority > best.priority ? s : best));
    const last = out[out.length - 1];
    if (last && last.seg.key === seg.key) last.end = end; // the cuts are contiguous, so a neighbour always ends where this starts
    else out.push({ seg, start, end });
  }
  return out.map(({ seg, start, end }) => ({
    kind: seg.kind,
    status: seg.status,
    label: STATUS_LABELS[seg.status],
    start: iso(start),
    end: iso(end),
    ...seg.extra,
  }));
}

/** SCRUM-84: every venue, by name, with ordered periods that cover the whole range. */
export function buildCalendar(
  venues: CalendarVenue[],
  entries: { bookings: CalendarBooking[]; blocks: CalendarBlock[] },
  range: CalendarRange,
): CalendarVenueView[] {
  return [...venues]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((v) => {
      const bookings = entries.bookings.filter((b) => b.venueId === v.id);
      const confirmed = bookings.filter((b) => b.status === "CONFIRMED").map((b) => ({ start: b.occupiedStart.getTime(), end: b.occupiedEnd.getTime() }));
      const segments = [
        ...operatingSegments(v, range),
        ...bookings.flatMap(bookingSegments),
        ...entries.blocks.filter((b) => b.venueId === v.id).flatMap((b, id) => blockSegments(b, id, confirmed)),
      ];
      return { id: v.id, name: v.name, address: v.address, max_capacity: v.maxCapacity, operating_hours: hoursOf(v), periods: resolve(segments, range) };
    });
}
