import { registrationStatus } from "@spm-t5/shared";
import { availabilityOf, myRegistration, type Availability, type PublicEventRow } from "./upcomingEvents";

// SCRUM-83: why a registration is refused, for each state a List of events card can show (SCRUM-71/AC7)
const REFUSALS: Partial<Record<Availability, string>> = {
  cancelled: "This event has been cancelled.", // SCRUM-83/AC17
  closed: "Registration closed.", // SCRUM-83/AC3
  full: "Event full.", // SCRUM-83/AC4
};

interface EmbeddedEvent {
  id: string;
  name: string;
  status: string;
  preferred_start_datetime: string | null;
  preferred_end_datetime: string | null;
}

/** One event_registrations row with its event embedded, as GET /events/my-registrations selects it. */
export interface MyRegistrationRow {
  id: string;
  status: string;
  registered_at: string;
  /** Without generated types Supabase describes an embed as an array; at runtime it is a single object, so accept both. */
  event: EmbeddedEvent | EmbeddedEvent[];
}

/**
 * SCRUM-83/AC15: one entry on the attendee's "My registrations" page.
 * `publicEvents` are list_public_events()'s rows by event id, for the event's location (SCRUM-72/AC4).
 */
export function toMyRegistration(row: MyRegistrationRow, publicEvents: Map<string, PublicEventRow>, now: Date) {
  const event = Array.isArray(row.event) ? row.event[0] : row.event;
  const publicEvent = publicEvents.get(event.id);
  return {
    id: row.id,
    status: registrationStatus(row.status),
    registered_at: row.registered_at,
    // SCRUM-73/AC2, AC5: whether the Withdraw button is offered, by the same rules as the withdraw route
    can_withdraw: withdrawalRefusal(row.status, event, now) === null,
    event: {
      id: event.id,
      name: event.name,
      start_at: event.preferred_start_datetime,
      end_at: event.preferred_end_datetime,
      // SCRUM-72/AC4: the venue's name and address, as on the List of events (SCRUM-71/AC3)
      venue: { name: publicEvent?.venue_name ?? null, address: publicEvent?.venue_address ?? null },
    },
  };
}

/** One event_registrations row as GET /events/:id/registrations selects it. */
export interface EventRegistrationRow {
  id: string;
  status: string;
  registered_at: string;
  /**
   * What the attendee submitted on the form (SCRUM-83/AC8: they may have edited their profile's details).
   * Null, or without these fields, for a registration made before the form existed (e.g. the seed data).
   */
  registration_details: { name?: string; email?: string; phone?: string } | null;
  /** SCRUM-74/AC5: the attendee's profile, for a registration with no form details. Embedded, so possibly an array. */
  attendee?: AttendeeProfile | AttendeeProfile[] | null;
}

interface AttendeeProfile {
  full_name: string | null;
  email: string | null;
  phone: string | null;
}

/** SCRUM-83/AC15: one row of the registration information page that organisers and coordinators see. */
export function toEventRegistration(row: EventRegistrationRow) {
  const form = row.registration_details ?? {};
  const profile = Array.isArray(row.attendee) ? row.attendee[0] : row.attendee;
  return {
    id: row.id,
    status: registrationStatus(row.status),
    registered_at: row.registered_at,
    // SCRUM-74/AC5: what the attendee submitted on the form, or their profile when there was no form
    name: form.name ?? profile?.full_name ?? null,
    email: form.email ?? profile?.email ?? null,
    phone: form.phone ?? profile?.phone ?? null,
  };
}

/** SCRUM-83/AC5, AC16: the attendee already has an active (Pending or Confirmed) registration for this event. */
export const ALREADY_REGISTERED = "You already have an active registration for this event.";

/** SCRUM-83: the message to refuse a registration for `event` at `now` with, or null when registration is open. */
export function registrationRefusal(event: PublicEventRow, now: Date): string | null {
  const refusal = REFUSALS[availabilityOf(event, now)];
  if (refusal) return refusal;
  // SCRUM-83/AC5: one active (Pending or Confirmed) registration per attendee per event
  if (myRegistration(event.my_registration_status)) return ALREADY_REGISTERED;
  return null;
}

/** SCRUM-73/AC2: the registration_status values that can be withdrawn: Pending (waitlisted) and Confirmed (registered). */
const WITHDRAWABLE_STATUSES = ["waitlisted", "registered"];

/**
 * SCRUM-73: the message to refuse withdrawing a registration (its database `status`, and its `event`) at `now` with,
 * or null when it can be withdrawn.
 */
export function withdrawalRefusal(
  status: string,
  event: { status: string; preferred_start_datetime: string | null },
  now: Date,
): string | null {
  // SCRUM-73/AC2: only Pending or Confirmed; not one already Rejected or Withdrawn
  if (!WITHDRAWABLE_STATUSES.includes(status)) return "Only a Pending or Confirmed registration can be withdrawn.";
  // SCRUM-73/AC5: not from a cancelled event, nor once the event has started (an event that has ended has started too)
  if (event.status === "cancelled") return "This event has been cancelled.";
  if (event.preferred_start_datetime && new Date(event.preferred_start_datetime) <= now) {
    return "This event has already started.";
  }
  return null;
}
