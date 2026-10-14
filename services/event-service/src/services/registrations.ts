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
export function toMyRegistration(row: MyRegistrationRow, publicEvents: Map<string, PublicEventRow>) {
  const event = Array.isArray(row.event) ? row.event[0] : row.event;
  const publicEvent = publicEvents.get(event.id);
  return {
    id: row.id,
    status: registrationStatus(row.status),
    registered_at: row.registered_at,
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
  /** What the attendee submitted on the form (SCRUM-83/AC8: they may have edited their profile's details). */
  registration_details: { name: string; email: string; phone: string };
}

/** SCRUM-83/AC15: one row of the registration information page that organisers and coordinators see. */
export function toEventRegistration(row: EventRegistrationRow) {
  return {
    id: row.id,
    status: registrationStatus(row.status),
    registered_at: row.registered_at,
    name: row.registration_details.name,
    email: row.registration_details.email,
    phone: row.registration_details.phone,
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
