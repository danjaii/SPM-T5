import type { SupabaseClient } from "@supabase/supabase-js";

/** SCRUM-86: one of the event's venue bookings, as the request form offers it. */
export interface VenueBookingInfo {
  id: string;
  eventId: string;
  venueName: string;
  /** The DB venue_booking_status; only some can be picked (EQUIPMENT_REQUEST_VENUE_BOOKING_STATUSES). */
  status: string;
  /** The booked period (UTC); a request covers the same period. */
  start: Date;
  end: Date;
}

export interface VenueBookingReader {
  /** The event's bookings the caller can see (RLS: the assigned coordinator sees their events' bookings). */
  forEvent(eventId: string): Promise<VenueBookingInfo[]>;
}

type Row = Record<string, unknown>;

const toBooking = (r: Row): VenueBookingInfo => ({
  id: r.id as string,
  eventId: r.event_id as string,
  venueName: ((r.venue as Row | null)?.name as string | undefined) ?? "Unknown venue",
  status: r.status as string,
  start: new Date(r.event_start_datetime as string),
  end: new Date(r.event_end_datetime as string),
});

export class SupabaseVenueBookingReader implements VenueBookingReader {
  constructor(private readonly db: SupabaseClient) {}

  async forEvent(eventId: string): Promise<VenueBookingInfo[]> {
    const { data, error } = await this.db
      .from("venue_bookings")
      .select("id, event_id, status, event_start_datetime, event_end_datetime, venue:venues!venue_bookings_venue_id_fkey(name)")
      .eq("event_id", eventId)
      .order("event_start_datetime", { ascending: true });
    if (error) throw new Error(`Reading venue bookings failed: ${error.message}`, { cause: error });
    return (data as unknown as Row[]).map(toBooking);
  }
}
