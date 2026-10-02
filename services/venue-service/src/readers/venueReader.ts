import type { SupabaseClient } from "@supabase/supabase-js";

/** The little the booking flow needs to know about a venue (SCRUM-29 owns the full catalogue). */
export interface VenueInfo {
  id: string;
  name: string;
  maxCapacity: number;
  isActive: boolean;
}

export interface VenueReader {
  /** Null when the venue does not exist. */
  getById(venueId: string): Promise<VenueInfo | null>;
  /** The venues with these ids (missing ones are simply absent), for showing names on lists. */
  getByIds(venueIds: string[]): Promise<VenueInfo[]>;
}

const COLUMNS = "id, name, max_capacity, is_active";

type Row = Record<string, unknown>;

const toVenue = (r: Row): VenueInfo => ({
  id: r.id as string,
  name: r.name as string,
  maxCapacity: r.max_capacity as number,
  isActive: Boolean(r.is_active),
});

export class SupabaseVenueReader implements VenueReader {
  constructor(private readonly db: SupabaseClient) {}

  async getById(venueId: string): Promise<VenueInfo | null> {
    const { data, error } = await this.db.from("venues").select(COLUMNS).eq("id", venueId).maybeSingle();
    if (error) throw new Error(`Reading venue failed: ${error.message}`, { cause: error });
    return data ? toVenue(data as unknown as Row) : null;
  }

  async getByIds(venueIds: string[]): Promise<VenueInfo[]> {
    if (venueIds.length === 0) return [];
    const { data, error } = await this.db.from("venues").select(COLUMNS).in("id", venueIds);
    if (error) throw new Error(`Reading venues failed: ${error.message}`, { cause: error });
    return (data as unknown as Row[]).map(toVenue);
  }
}
