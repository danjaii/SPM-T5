import { utcToSgt, type Period } from "./venueBooking";

// SCRUM-103 (docs/specs/venue-padded-occupancy.md): a booking occupies its venue from `setup` minutes before it starts
// to `turnaround` minutes after it ends. The database has the authoritative copy (venue_padded_period, migration 27);
// this mirror serves the unit tests, the fakes and the message below, so nothing re-derives padding by hand.

const MINUTE_MS = 60_000;

/** A venue's current setup and turnaround times, in whole minutes (SCRUM-101). */
export interface VenueTiming {
  setupMinutes: number;
  turnaroundMinutes: number;
}

/** The time a booking really takes up: setup before, turnaround after. Half-open like every other period. */
export function paddedPeriod(period: Period, timing: VenueTiming): Period {
  return {
    start: new Date(period.start.getTime() - timing.setupMinutes * MINUTE_MS),
    end: new Date(period.end.getTime() + timing.turnaroundMinutes * MINUTE_MS),
  };
}

/** A holding booking as the availability view and a refusal describe it. Never says whose it is (36-S5). */
export interface OccupiedPeriod {
  /** The event itself. */
  eventStart: Date;
  eventEnd: Date;
  /** Setup and turnaround included. */
  occupiedStart: Date;
  occupiedEnd: Date;
  /** The API status: PENDING or APPROVED. */
  status: "PENDING" | "APPROVED";
}

/** "HH:MM", or "YYYY-MM-DD HH:MM" for a period that does not sit in one Singapore day. */
function describePeriod(period: Period): [string, string] {
  const start = utcToSgt(period.start);
  const end = utcToSgt(period.end);
  return start.date === end.date ? [start.time, end.time] : [`${start.date} ${start.time}`, `${end.date} ${end.time}`];
}

/**
 * 103-S1: why a request was refused, for example
 * "Orchid Hall is occupied from 09:30 to 12:45, including setup and turnaround".
 * `occupied` is the holder's padded period. The suffix is left off for a venue with no setup or turnaround time.
 */
export function slotConflictMessage(venueName: string, occupied: Period, timing: VenueTiming): string {
  const [from, to] = describePeriod(occupied);
  const padded = timing.setupMinutes > 0 || timing.turnaroundMinutes > 0;
  return `${venueName} is occupied from ${from} to ${to}${padded ? ", including setup and turnaround" : ""}`;
}
