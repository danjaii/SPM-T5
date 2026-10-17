import { utcToSgt, type UnavailabilityBlockView } from "@spm-t5/shared";

// Browser-safe types and helpers for the venue availability view (SCRUM-103). The server-side fetch is in
// ./venueAvailabilityServer.

/** One holding booking on the day, as GET /venues/:id/availability returns it (instants are UTC ISO strings). */
export interface AvailabilityPeriod {
  status: "PENDING" | "APPROVED";
  /** The event itself. */
  event_start: string;
  event_end: string;
  /** Setup and turnaround included. */
  occupied_start: string;
  occupied_end: string;
}

export interface VenueAvailabilityData {
  venue: { id: string; name: string };
  /** The Singapore day, YYYY-MM-DD. */
  date: string;
  setup_minutes: number;
  turnaround_minutes: number;
  periods: AvailabilityPeriod[];
  /** SCRUM-105: the unavailability blocks touching the day (absent from an older service). */
  unavailable?: UnavailabilityBlockView[];
}

/** "HH:MM" Singapore time, with the date in front when it is not on `day`. */
export function clock(iso: string, day: string): string {
  const { date, time } = utcToSgt(new Date(iso));
  return date === day ? time : `${date} ${time}`;
}

/** Today's date in Singapore, YYYY-MM-DD. */
export const todaySgt = (now: Date = new Date()) => utcToSgt(now).date;
