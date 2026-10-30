import { EVENT_STATUSES, type EventStatus } from "@spm-t5/shared";
import { formatDate, formatEventDateTime } from "./formatEventDateTime";
import type { VenueBookingListItem } from "./venueBookings";

// SCRUM-160: the pure rules behind the Event Coordinator dashboard, kept apart from the fetching so they can be tested alone.

export interface DashboardEvent {
  id: string;
  name: string;
  status: string;
  preferred_start_datetime?: string | null;
  preferred_end_datetime?: string | null;
  expected_attendance?: number | null;
  organiser_name?: string | null;
}

type BookingStatus = NonNullable<VenueBookingListItem["status"]>;

/** The latest safety decision and sent-back counts for one event that is back in Planning. */
export interface PlanningEvidence {
  safetyDecisions: { decision: string; reason: string | null; revoked_at?: string | null }[] | null;
  venueBookingsSentBack: number;
  equipmentRequestsSentBack: number;
}

/** AC1: the assigned events in each status, in lifecycle order, leaving out statuses with none. */
export function groupEventsByStatus(events: DashboardEvent[]): { status: EventStatus; items: DashboardEvent[] }[] {
  return EVENT_STATUSES.map((status) => ({ status, items: events.filter((e) => e.status === status) })).filter((g) => g.items.length > 0);
}

/** AC4: the same for venue booking requests, in the order each status first appears (the list is soonest first); one with no known status is left out. */
export function groupBookingsByStatus(bookings: VenueBookingListItem[]): { status: BookingStatus; items: VenueBookingListItem[] }[] {
  const groups = new Map<BookingStatus, VenueBookingListItem[]>();
  for (const b of bookings) if (b.status) groups.set(b.status, [...(groups.get(b.status) ?? []), b]);
  return [...groups].map(([status, items]) => ({ status, items }));
}

/** The line under an event's name: when it is, how many are expected and who organises it. Parts the event lacks are left out. */
export function eventPeek(e: DashboardEvent): string[] {
  return [
    e.preferred_start_datetime ? formatEventDateTime(e.preferred_start_datetime, e.preferred_end_datetime ?? null) : null,
    e.expected_attendance != null ? `${e.expected_attendance} expected` : null,
    e.organiser_name ? `Organiser: ${e.organiser_name}` : null,
  ].filter((part): part is string => part !== null);
}

/** The line under a venue request: the venue, the day and the hours. */
export function bookingPeek(b: VenueBookingListItem): string[] {
  return [b.venueName, formatDate(new Date(`${b.date}T00:00:00+08:00`)), `${b.startTime}–${b.endTime}`];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * AC3: why an event is back in Planning, or null when nothing sent it back. The Safety Officer's open request for changes
 * comes first (it names what they want); otherwise the arrangements an event change sent back for review.
 */
export function returnedReason(e: PlanningEvidence): string | null {
  // newest first; a decision an important change revoked no longer applies
  const latest = e.safetyDecisions?.find((d) => !d.revoked_at);
  if (latest?.decision === "changes_requested") {
    return latest.reason ? `The Safety Officer wants changes: ${latest.reason}` : "The Safety Officer wants changes.";
  }
  const parts = [
    e.venueBookingsSentBack > 0 && plural(e.venueBookingsSentBack, "venue booking", "venue bookings"),
    e.equipmentRequestsSentBack > 0 && plural(e.equipmentRequestsSentBack, "equipment request", "equipment requests"),
  ].filter(Boolean);
  return parts.length > 0 ? `The event details changed, so ${parts.join(" and ")} must be reviewed again.` : null;
}
