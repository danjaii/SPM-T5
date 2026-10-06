/** One row of the list_public_events() database function (supabase/migrations/10_list_public_events.sql). */
export interface PublicEventRow {
  id: string;
  name: string;
  start_at: string;
  end_at: string | null;
  venue_name: string | null;
  venue_address: string | null;
}

/** One card in the attendee's List of events, as GET /events/upcoming sends it. */
export interface UpcomingEvent {
  id: string;
  name: string;
  start_at: string;
  end_at: string | null;
  venue: { name: string | null; address: string | null };
}

/** SCRUM-71: turns the database rows into the List of events. */
export function toUpcomingEvents(rows: PublicEventRow[]): UpcomingEvent[] {
  // SCRUM-71/AC1: what each card needs: name, date and time, and location
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    start_at: row.start_at,
    end_at: row.end_at,
    venue: { name: row.venue_name, address: row.venue_address },
  }));
}
