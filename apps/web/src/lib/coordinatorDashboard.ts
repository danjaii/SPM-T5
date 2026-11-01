import { EVENT_STATUSES, isClosedEventStatus, type EventStatus } from "@spm-t5/shared";
import { isAffected } from "./affectedBookings";
import { formatDate, formatEventDateTime } from "./formatEventDateTime";
import type { LeadKpi } from "./leadQueueView";
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

// SCRUM-160 (Figma 16): the Home header, the figures and "This week". Dates are read in Singapore time, like the rest of the app.
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A Date whose UTC fields read as Singapore time. */
const inSingapore = (d: Date) => new Date(d.getTime() + SGT_OFFSET_MS);
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** "Good morning, Priya": the first name of whoever is signed in, or just the greeting when the name is unknown. */
export function greeting(fullName: string | undefined, now = new Date()): string {
  const hour = inSingapore(now).getUTCHours();
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const first = fullName?.trim().split(/\s+/)[0];
  return first ? `Good ${part}, ${first}` : `Good ${part}`;
}

/** How many things wait for the coordinator: flagged bookings plus events returned to Planning. Undefined when neither source loaded. */
export function needsActionCount(bookings: VenueBookingListItem[] | undefined, returned: unknown[] | undefined): number | undefined {
  return bookings || returned ? (bookings?.filter(isAffected).length ?? 0) + (returned?.length ?? 0) : undefined;
}

/** The line under the greeting. */
export function homeSummary(actions: number | undefined): string {
  if (actions === undefined) return "Some of your information could not be loaded.";
  if (actions === 0) return "Nothing needs you today. Everything is on track.";
  return `${plural(actions, "thing needs", "things need")} you today. Everything else is on track.`;
}

export interface WeekItem {
  id: string;
  name: string;
  /** "MON" */
  weekday: string;
  day: number;
  /** "Seminar Room 1 · 8:00", or "Venue pending · 8:00" until a booking is requested or approved. */
  detail: string;
  status: EventStatus;
}

/** The open events that start between Monday and Sunday of this week, earliest first, each with its venue and start time. */
export function eventsThisWeek(events: DashboardEvent[], bookings: VenueBookingListItem[] | undefined, now = new Date()): WeekItem[] {
  const today = inSingapore(now);
  const daysSinceMonday = (today.getUTCDay() + 6) % 7;
  const weekStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - daysSinceMonday) - SGT_OFFSET_MS;
  return events
    .filter((e) => e.preferred_start_datetime && !isClosedEventStatus(e.status))
    .map((e) => ({ e, start: new Date(e.preferred_start_datetime as string) }))
    .filter(({ start }) => start.getTime() >= weekStart && start.getTime() < weekStart + 7 * DAY_MS)
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map(({ e, start }) => {
      const local = inSingapore(start);
      const venue = bookings?.find((b) => b.eventId === e.id && (b.status === "APPROVED" || b.status === "PENDING"))?.venueName;
      const time = `${local.getUTCHours()}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
      return { id: e.id, name: e.name, weekday: WEEKDAYS[local.getUTCDay()], day: local.getUTCDate(), detail: `${venue ?? "Venue pending"} · ${time}`, status: e.status as EventStatus };
    });
}

/** The figures above the lists. A figure whose source failed is left out rather than shown as zero. */
export function coordinatorKpis(events: DashboardEvent[] | undefined, bookings: VenueBookingListItem[] | undefined, actions: number | undefined, thisWeek: number): LeadKpi[] {
  const kpis: LeadKpi[] = [];
  if (actions !== undefined) {
    kpis.push({ label: "Needs action", value: actions, note: actions > 0 ? "See the list below" : "All caught up", warn: actions > 0 });
  }
  if (events) {
    kpis.push({ label: "Active events", value: events.filter((e) => !isClosedEventStatus(e.status)).length, note: `${thisWeek} this week` });
  }
  if (bookings) {
    const pending = bookings.filter((b) => b.status === "PENDING").length;
    kpis.push({ label: "Pending bookings", value: pending, note: pending > 0 ? "Waiting on venue team" : "Nothing waiting" });
  }
  return kpis;
}
