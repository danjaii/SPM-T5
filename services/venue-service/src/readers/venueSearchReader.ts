import type { SupabaseClient } from "@supabase/supabase-js";

/** A venue with everything the search filters on and the results show (SCRUM-65 AC7). */
export interface SearchableVenue {
  id: string;
  name: string;
  address: string;
  maxCapacity: number;
  /** Daily opening and closing time as "HH:MM" (Singapore time), or null when the venue has no stated limit. */
  openingTime: string | null;
  closingTime: string | null;
  isAccessible: boolean;
  accessibilityNotes: string | null;
  layouts: { id: string; name: string; maxCapacity: number }[];
  facilities: { id: string; name: string }[];
}

/** The layout and facility choices the search form offers. */
export interface SearchOptions {
  layouts: { id: string; name: string }[];
  facilities: { id: string; name: string }[];
}

/** Where the venue search reads from; tests pass a fake. */
export interface VenueSearchReader {
  /** Ids of the active venues free for the period (no holding booking, no maintenance block, half-open). */
  availableVenueIds(start: Date, end: Date): Promise<string[]>;
  /** Every active venue the caller may see, with layouts and facilities. */
  activeVenues(): Promise<SearchableVenue[]>;
  options(): Promise<SearchOptions>;
}

type Row = Record<string, unknown>;

interface VenueRow {
  id: string;
  name: string;
  address: string;
  max_capacity: number;
  operating_hours_start: string | null;
  operating_hours_end: string | null;
  is_accessible: boolean;
  accessibility_notes: string | null;
  venue_supported_layouts: { max_capacity_for_layout: number; room_layouts: { id: string; name: string } }[] | null;
  venue_facilities: { facilities: { id: string; name: string } }[] | null;
}

const SELECT =
  "id, name, address, max_capacity, operating_hours_start, operating_hours_end, is_accessible, accessibility_notes, " +
  "venue_supported_layouts(max_capacity_for_layout, room_layouts(id, name)), venue_facilities(facilities(id, name))";

export class SupabaseVenueSearchReader implements VenueSearchReader {
  constructor(private readonly db: SupabaseClient) {}

  async availableVenueIds(start: Date, end: Date): Promise<string[]> {
    // available_venues is a security-definer function (migration 14), so it sees every coordinator's bookings.
    const { data, error } = await this.db.rpc("available_venues", {
      p_start: start.toISOString(),
      p_end: end.toISOString(),
    });
    if (error) throw new Error(`Finding available venues failed: ${error.message}`, { cause: error });
    return (data as string[] | null) ?? [];
  }

  async activeVenues(): Promise<SearchableVenue[]> {
    const { data, error } = await this.db.from("venues").select(SELECT).eq("is_active", true).order("name");
    if (error) throw new Error(`Reading venues failed: ${error.message}`, { cause: error });
    return ((data ?? []) as unknown as VenueRow[]).map((v) => ({
      id: v.id,
      name: v.name,
      address: v.address,
      maxCapacity: v.max_capacity,
      // Postgres returns time columns as "HH:MM:SS"; the search compares and shows "HH:MM".
      openingTime: v.operating_hours_start?.slice(0, 5) ?? null,
      closingTime: v.operating_hours_end?.slice(0, 5) ?? null,
      isAccessible: v.is_accessible,
      accessibilityNotes: v.accessibility_notes,
      layouts: (v.venue_supported_layouts ?? []).map((l) => ({
        id: l.room_layouts.id,
        name: l.room_layouts.name,
        maxCapacity: l.max_capacity_for_layout,
      })),
      facilities: (v.venue_facilities ?? []).map((f) => ({ id: f.facilities.id, name: f.facilities.name })),
    }));
  }

  async options(): Promise<SearchOptions> {
    const [layouts, facilities] = await Promise.all([
      this.db.from("room_layouts").select("id, name").eq("is_active", true).order("name"),
      this.db.from("facilities").select("id, name").order("name"),
    ]);
    if (layouts.error) throw new Error(`Reading layouts failed: ${layouts.error.message}`, { cause: layouts.error });
    if (facilities.error) throw new Error(`Reading facilities failed: ${facilities.error.message}`, { cause: facilities.error });
    const pick = (rows: Row[] | null) => (rows ?? []).map((r) => ({ id: r.id as string, name: r.name as string }));
    return { layouts: pick(layouts.data), facilities: pick(facilities.data) };
  }
}
