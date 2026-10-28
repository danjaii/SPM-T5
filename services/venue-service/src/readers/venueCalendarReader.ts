import type { SupabaseClient } from "@supabase/supabase-js";
import { dbStatusToApi } from "@spm-t5/shared";

/** SCRUM-84: a venue as the availability calendar needs it. Operating hours are "HH:MM" Singapore time, or null for no limit. */
export interface CalendarVenue {
  id: string;
  name: string;
  address: string;
  maxCapacity: number;
  operatingStart: string | null;
  operatingEnd: string | null;
  setupMinutes: number;
  turnaroundMinutes: number;
  /** Fakes only; the real reader returns active venues alone. */
  isActive?: boolean;
}

/** A request that holds a venue: Pending is TENTATIVELY_HELD, Approved is CONFIRMED (docs/specs/venue-booking-request.md DR4). */
export interface CalendarBooking {
  venueId: string;
  status: "TENTATIVELY_HELD" | "CONFIRMED";
  eventStart: Date;
  eventEnd: Date;
  /** The event plus the venue's setup before and turnaround after (migration 27). */
  occupiedStart: Date;
  occupiedEnd: Date;
  setupMinutes: number;
  turnaroundMinutes: number;
}

/** A period Venue Staff blocked. The notes and who recorded it are not read at all. */
export interface CalendarBlock {
  venueId: string;
  start: Date;
  end: Date;
  /** The enum key, e.g. "maintenance". */
  reason: string;
}

/** Where the venue availability calendar reads from; tests pass a fake. */
export interface VenueCalendarReader {
  /** The holding bookings (padded period) and blocks of every active venue that overlap [from, to). */
  entries(from: Date, to: Date): Promise<{ bookings: CalendarBooking[]; blocks: CalendarBlock[] }>;
  /** The active venues, by name. */
  venueList(): Promise<CalendarVenue[]>;
}

type Row = Record<string, unknown>;

const hhmm = (time: unknown): string | null => (typeof time === "string" ? time.slice(0, 5) : null);

/** Reads as the caller (their token), so RLS and the security definer functions decide what is visible. */
export class SupabaseVenueCalendarReader implements VenueCalendarReader {
  constructor(private readonly db: SupabaseClient) {}

  /** One call to venue_calendar_entries (migration 58): coordinators, venue staff and technical support only. */
  async entries(from: Date, to: Date): Promise<{ bookings: CalendarBooking[]; blocks: CalendarBlock[] }> {
    const { data, error } = await this.db.rpc("venue_calendar_entries", { p_from: from.toISOString(), p_to: to.toISOString() });
    if (error) throw new Error("Could not read the venue calendar.", { cause: error });
    const bookings: CalendarBooking[] = [];
    const blocks: CalendarBlock[] = [];
    for (const r of (data ?? []) as Row[]) {
      if (r.entry === "block") {
        blocks.push({ venueId: r.venue_id as string, start: new Date(r.starts_at as string), end: new Date(r.ends_at as string), reason: r.reason as string });
        continue;
      }
      const status = dbStatusToApi(r.status as string);
      bookings.push({
        venueId: r.venue_id as string,
        status: status === "PENDING" ? "TENTATIVELY_HELD" : "CONFIRMED",
        eventStart: new Date(r.starts_at as string),
        eventEnd: new Date(r.ends_at as string),
        occupiedStart: new Date(r.occupied_start as string),
        occupiedEnd: new Date(r.occupied_end as string),
        setupMinutes: r.setup_minutes as number,
        turnaroundMinutes: r.turnaround_minutes as number,
      });
    }
    return { bookings, blocks };
  }

  async venueList(): Promise<CalendarVenue[]> {
    const { data, error } = await this.db
      .from("venues")
      .select("id, name, address, max_capacity, operating_hours_start, operating_hours_end, setup_minutes, turnaround_minutes")
      .eq("is_active", true)
      .order("name");
    if (error) throw new Error("Could not read the venues.", { cause: error });
    return ((data ?? []) as Row[]).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      address: r.address as string,
      maxCapacity: r.max_capacity as number,
      operatingStart: hhmm(r.operating_hours_start),
      operatingEnd: hhmm(r.operating_hours_end),
      setupMinutes: (r.setup_minutes as number | null) ?? 0,
      turnaroundMinutes: (r.turnaround_minutes as number | null) ?? 0,
    }));
  }
}
