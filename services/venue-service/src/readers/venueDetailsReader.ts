import type { SupabaseClient } from "@supabase/supabase-js";
import { toSearchableVenue, VENUE_SELECT, type SearchableVenue, type VenueRow } from "./venueSearchReader";

/** SCRUM-109: one venue with everything the suitability check compares (the same shape the venue search reads). */
export interface VenueDetailsReader {
  /** Null when the venue does not exist or is retired. */
  getById(venueId: string): Promise<SearchableVenue | null>;
}

export class SupabaseVenueDetailsReader implements VenueDetailsReader {
  constructor(private readonly db: SupabaseClient) {}

  async getById(venueId: string): Promise<SearchableVenue | null> {
    const { data, error } = await this.db.from("venues").select(VENUE_SELECT).eq("id", venueId).eq("is_active", true).maybeSingle();
    if (error) throw new Error(`Reading venue failed: ${error.message}`, { cause: error });
    return data ? toSearchableVenue(data as unknown as VenueRow) : null;
  }
}
