/** One row of the list_public_events() database function (supabase/migrations/10_list_public_events.sql). */
export interface PublicEventRow {
  id: string;
  name: string;
  status: string;
  start_at: string;
  end_at: string | null;
  venue_name: string | null;
  venue_address: string | null;
  registration_capacity: number | null;
  registration_opens_at: string | null;
  registration_closes_at: string | null;
  /** Registrations that hold a place: registered (Confirmed) only; a Pending one doesn't (SCRUM-83/AC13, migration 11). */
  active_registrations: number;
  /** The caller's own registration for this event, if any (registration_status enum). */
  my_registration_status: string | null;
  /** SCRUM-9: the names the attendee's search looks in; null when the event has no organisation, category or coordinator. */
  organisation_name: string | null;
  category_name: string | null;
  coordinator_name: string | null;
}

/** One card in the attendee's List of events, as GET /events/upcoming sends it. */
export interface UpcomingEvent {
  id: string;
  name: string;
  start_at: string;
  end_at: string | null;
  venue: { name: string | null; address: string | null };
  availability: Availability;
  my_registration: MyRegistration;
  /** SCRUM-9/AC1: what the search looks in besides the name, venue and date: the event's status, and its organisation, category and coordinator. */
  status: string;
  organisation: string | null;
  category: string | null;
  coordinator: string | null;
  /** SCRUM-9/AC2: places left; null when the event has no limit. */
  available_slots: number | null;
}

/** SCRUM-71/AC7: the one label a card shows ("open" means no label, and the Register button shows). */
export type Availability = "cancelled" | "full" | "closed" | "open";

/** SCRUM-71/AC7: which label applies to this event at `now`. */
export function availabilityOf(row: PublicEventRow, now: Date): Availability {
  if (row.status === "cancelled") return "cancelled";
  // No capacity means no cap, so it never fills up
  if (row.registration_capacity !== null && row.active_registrations >= row.registration_capacity) return "full";
  // Outside the registration window: it has closed, or (decided with the team) it hasn't opened yet
  if (row.registration_closes_at !== null && new Date(row.registration_closes_at) <= now) return "closed";
  if (row.registration_opens_at !== null && new Date(row.registration_opens_at) > now) return "closed";
  // SCRUM-83/AC3: with no deadline (or a deadline after the start), registration closes when the event starts
  if (new Date(row.start_at) <= now) return "closed";
  return "open";
}

/** SCRUM-71/AC10: the attendee's own active registration, which the card shows instead of the Register button. */
export type MyRegistration = "confirmed" | "pending" | null;

// The registration_status enum has no Pending/Confirmed, so (decided with the team): registered is Confirmed and
// waitlisted is Pending. withdrawn and cancelled (the "Rejected" case) aren't active, so they count as none.
const ACTIVE_REGISTRATIONS: Record<string, MyRegistration> = { registered: "confirmed", waitlisted: "pending" };

/** SCRUM-71/AC10: the attendee's active registration, or null when they have none. */
export function myRegistration(status: string | null): MyRegistration {
  return (status && ACTIVE_REGISTRATIONS[status]) || null;
}

/**
 * SCRUM-9/AC2: the places left on a card: the capacity minus the Confirmed registrations (a Pending one holds no place, SCRUM-83/AC13),
 * never below 0. An event with no capacity has no limit, so there is no number (null).
 */
export function availableSlots(row: PublicEventRow): number | null {
  if (row.registration_capacity === null) return null;
  return Math.max(0, row.registration_capacity - row.active_registrations);
}

/** SCRUM-71/AC1: what one card needs: name, date and time, and location. SCRUM-83/AC7: the registration form shows the same. */
export function toUpcomingEvent(row: PublicEventRow, now: Date): UpcomingEvent {
  return {
    id: row.id,
    name: row.name,
    start_at: row.start_at,
    end_at: row.end_at,
    venue: { name: row.venue_name, address: row.venue_address },
    availability: availabilityOf(row, now),
    my_registration: myRegistration(row.my_registration_status),
    status: row.status,
    organisation: row.organisation_name,
    category: row.category_name,
    coordinator: row.coordinator_name,
    available_slots: availableSlots(row),
  };
}

/** SCRUM-71: turns the database rows into the List of events, as it stands at `now`. */
export function toUpcomingEvents(rows: PublicEventRow[], now: Date): UpcomingEvent[] {
  return rows
    // SCRUM-71/AC2: upcoming means it hasn't started yet; an event that has started is no longer shown
    .filter((row) => new Date(row.start_at) > now)
    // SCRUM-71/AC5: soonest first
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
    .map((row) => toUpcomingEvent(row, now));
}
