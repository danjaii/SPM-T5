import type { SupabaseClient } from "@supabase/supabase-js";

/** SCRUM-101: saves a venue's setup and turnaround times. */
export interface VenueTimingWriter {
  set(venueId: string, setupMinutes: number, turnaroundMinutes: number): Promise<void>;
}

/**
 * Calls the set_venue_timing database function as the caller. The function (migration 26) is the only way
 * to write these columns and allows venue staff only, so RLS stays the authority; the route's role check
 * is just the friendly 403.
 */
export class SupabaseVenueTimingWriter implements VenueTimingWriter {
  constructor(private readonly db: SupabaseClient) {}

  async set(venueId: string, setupMinutes: number, turnaroundMinutes: number): Promise<void> {
    const { error } = await this.db.rpc("set_venue_timing", {
      p_venue_id: venueId,
      p_setup: setupMinutes,
      p_turnaround: turnaroundMinutes,
    });
    if (error) throw new Error(`Saving venue times failed: ${error.message}`, { cause: error });
  }
}
