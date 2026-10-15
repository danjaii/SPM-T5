import { utcToSgt } from "./venueBooking";

// SCRUM-104 (docs/specs/venue-buffer-conflicts.md): the flags a venue booking can carry, and the sentence that tells Venue
// Staff which two bookings now clash. Pure and dependency free, so venue-service and apps/web word them identically.
// SCRUM-106 uses the same flag types for "Venue unavailable" (docs/specs/venue-unavailability-flags.md).

/** What a flag says is wrong with a booking. A booking can carry several, one per cause. */
export const VENUE_BOOKING_FLAG_KINDS = ["buffer_conflict", "venue_unavailable"] as const;
export type VenueBookingFlagKind = (typeof VENUE_BOOKING_FLAG_KINDS)[number];

/** The words shown on the badge and banner. The en dash is on purpose (Jira SCRUM-106 Scenario 1). */
export const VENUE_BOOKING_FLAG_LABELS: Record<VenueBookingFlagKind, string> = {
  buffer_conflict: "Buffer conflict",
  venue_unavailable: "Venue unavailable – alternative needed",
};

export function isVenueBookingFlagKind(value: unknown): value is VenueBookingFlagKind {
  return typeof value === "string" && (VENUE_BOOKING_FLAG_KINDS as readonly string[]).includes(value);
}

/** The label for a kind; undefined for a value this feature does not know. */
export function flagLabel(kind: string): string | undefined {
  return isVenueBookingFlagKind(kind) ? VENUE_BOOKING_FLAG_LABELS[kind] : undefined;
}

/** The other booking's event period in Singapore time (DR3), as the API shows it. */
export interface FlagPeriodDto {
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:MM" */
  startTime: string;
  /** "HH:MM" */
  endTime: string;
}

/**
 * One open flag on a venue booking, as the API shows it. Coordinators see the other booking's period (104-S3) and never
 * its event name (36-S5); Venue Staff also get `otherEventName`.
 */
export interface FlagDto {
  id: string;
  kind: VenueBookingFlagKind;
  /** The text for `kind`, so a client need not repeat the table above. */
  label: string;
  /** When the flag was raised, an ISO instant. */
  createdAt: string;
  /** The conflicting booking's event period; null for a flag that is not about another booking. */
  otherPeriod: FlagPeriodDto | null;
  /** Staff DTOs only. */
  otherEventName?: string | null;
}

// ---------------------------------------------------------------------------
// 104-S1: "Summit A (occupies until 12:45) now conflicts with Summit B (occupies from 12:00)".
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "2026-11-14" -> "14 Nov". */
function shortDate(isoDate: string): string {
  const month = MONTHS[Number(isoDate.slice(5, 7)) - 1] ?? isoDate.slice(5, 7);
  return `${Number(isoDate.slice(8, 10))} ${month}`;
}

/**
 * A Singapore "HH:MM" for an instant. When it falls on a different Singapore day from `ownDay` (the "YYYY-MM-DD" of the
 * booking it belongs to), the date goes in front: "15 Nov 00:30". Padding can run past midnight.
 */
function clock(instant: Date, ownDay: string): string {
  const { date, time } = utcToSgt(instant);
  return date === ownDay ? time : `${shortDate(date)} ${time}`;
}

/** One side of a buffer conflict: a booking's event name and when its event starts. */
export interface BufferConflictSide {
  name: string;
  /** The booking's own event start; its Singapore date is the day that needs no date in front of a time. */
  eventStart: Date;
}

/**
 * The sentence shown to Venue Staff when saving new setup/turnaround times leaves two bookings clashing.
 * `first` is the booking that runs earlier: it is occupied until `occupiedUntil`. `second` is the later one, occupied
 * from `occupiedFrom`. The times are the padded edges (SCRUM-103), in Singapore time.
 */
export function bufferConflictSummary(
  first: BufferConflictSide & { occupiedUntil: Date },
  second: BufferConflictSide & { occupiedFrom: Date },
): string {
  const firstDay = utcToSgt(first.eventStart).date;
  const secondDay = utcToSgt(second.eventStart).date;
  return (
    `${first.name} (occupies until ${clock(first.occupiedUntil, firstDay)}) now conflicts with ` +
    `${second.name} (occupies from ${clock(second.occupiedFrom, secondDay)})`
  );
}

/** 104-S6: what Venue Staff are told after a save that flags nothing. */
export const NO_BOOKINGS_AFFECTED_MESSAGE = "No existing bookings are affected.";
