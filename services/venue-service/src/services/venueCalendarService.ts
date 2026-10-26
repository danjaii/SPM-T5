import { unavailabilityReasonLabel, type CalendarRange } from "@spm-t5/shared";
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
}

export interface CalendarVenueView {
  id: string;
  name: string;
  address: string;
  max_capacity: number;
  periods: CalendarPeriod[];
}

/** What lies over a stretch of time. The one with the highest `priority` wins where several overlap (spec: precedence). */
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

function blockSegment(b: CalendarBlock, id: number): Segment {
  return {
    priority: PRIORITY.block,
    key: `block:${id}`,
    kind: "block",
    status: "BLOCKED",
    start: b.start.getTime(),
    end: b.end.getTime(),
    extra: { reason: b.reason, reason_label: unavailabilityReasonLabel(b.reason) ?? "Other" },
  };
}

/** The stretches of the range when nothing else is on it: open, or closed outside the venue's operating hours. */
function operatingSegments(_venue: CalendarVenue, range: CalendarRange): Segment[] {
  return [{ priority: PRIORITY.open, key: "open", kind: "open", status: "AVAILABLE", start: range.start.getTime(), end: range.end.getTime() }];
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
    if (last && last.seg.key === seg.key && last.end === start) last.end = end;
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
      const segments = [
        ...operatingSegments(v, range),
        ...entries.bookings.filter((b) => b.venueId === v.id).flatMap(bookingSegments),
        ...entries.blocks.filter((b) => b.venueId === v.id).map(blockSegment),
      ];
      return { id: v.id, name: v.name, address: v.address, max_capacity: v.maxCapacity, periods: resolve(segments, range) };
    });
}
