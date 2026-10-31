import type { SupabaseClient } from "@supabase/supabase-js";
import { HOLDING_DB_STATUSES, type BookingAtVenue, type VenueInput } from "@spm-t5/shared";

/** SCRUM-58: what the edit needs to read, apart from the save itself. */
export interface VenueEditReader {
  /** The venue as the edit form needs it (layout and facility ids, not names), or null when there is no such venue. */
  forEdit(venueId: string): Promise<VenueInput | null>;
  /** The bookings at the venue that still hold it, for the capacity check (58-S4). */
  bookings(venueId: string): Promise<BookingAtVenue[]>;
}

interface VenueRow {
  name: string;
  address: string;
  description: string | null;
  max_capacity: number;
  operating_hours_start: string | null;
  operating_hours_end: string | null;
  is_accessible: boolean;
  accessibility_notes: string | null;
  venue_supported_layouts: { room_layout_id: string; max_capacity_for_layout: number }[] | null;
  venue_facilities: { facility_id: string }[] | null;
}

interface BookingRow {
  id: string;
  status: string;
  event_start_datetime: string;
  event_end_datetime: string;
  snapshot_event_name: string | null;
  snapshot_expected_attendance: number | null;
}

/** Reads as the caller, so RLS applies: Venue Staff read every venue and every booking. */
export class SupabaseVenueEditReader implements VenueEditReader {
  constructor(private readonly db: SupabaseClient) {}

  async forEdit(venueId: string): Promise<VenueInput | null> {
    const { data, error } = await this.db
      .from("venues")
      .select(
        "id, name, address, description, max_capacity, operating_hours_start, operating_hours_end, is_accessible, accessibility_notes, " +
          "venue_supported_layouts(room_layout_id, max_capacity_for_layout), venue_facilities(facility_id)",
      )
      .eq("id", venueId)
      .maybeSingle<VenueRow>();
    if (error) throw new Error(`Reading the venue failed: ${error.message}`, { cause: error });
    if (!data) return null;
    return {
      name: data.name,
      address: data.address,
      description: data.description,
      maxCapacity: data.max_capacity,
      // Postgres returns time columns as "HH:MM:SS"; the form works in "HH:MM".
      operatingHoursStart: data.operating_hours_start?.slice(0, 5) ?? null,
      operatingHoursEnd: data.operating_hours_end?.slice(0, 5) ?? null,
      isAccessible: data.is_accessible,
      accessibilityNotes: data.accessibility_notes,
      layouts: (data.venue_supported_layouts ?? []).map((l) => ({ layoutId: l.room_layout_id, maxCapacity: l.max_capacity_for_layout })),
      facilityIds: (data.venue_facilities ?? []).map((f) => f.facility_id),
    };
  }

  async bookings(venueId: string): Promise<BookingAtVenue[]> {
    const { data, error } = await this.db
      .from("venue_bookings")
      .select("id, status, event_start_datetime, event_end_datetime, snapshot_event_name, snapshot_expected_attendance")
      .eq("venue_id", venueId)
      .in("status", [...HOLDING_DB_STATUSES]);
    if (error) throw new Error(`Reading the venue's bookings failed: ${error.message}`, { cause: error });
    return ((data ?? []) as BookingRow[]).map((b) => ({
      bookingId: b.id,
      eventName: b.snapshot_event_name ?? "",
      eventStart: b.event_start_datetime,
      eventEnd: b.event_end_datetime,
      expectedAttendance: b.snapshot_expected_attendance,
      status: b.status,
    }));
  }
}
