import type { SupabaseClient } from "@supabase/supabase-js";

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

/** Where the venue availability calendar reads from; tests pass a fake. */
export interface VenueCalendarReader {
  /** The active venues, by name. */
  venueList(): Promise<CalendarVenue[]>;
}

type Row = Record<string, unknown>;

const hhmm = (time: unknown): string | null => (typeof time === "string" ? time.slice(0, 5) : null);

/** Reads as the caller (their token), so RLS and the security definer functions decide what is visible. */
export class SupabaseVenueCalendarReader implements VenueCalendarReader {
  constructor(private readonly db: SupabaseClient) {}

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
