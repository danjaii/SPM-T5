import type { SupabaseClient } from "@supabase/supabase-js";

/** One booking of an affected pair (SCRUM-104): its event name from the snapshot and its own event period. */
export interface AffectedSide {
  bookingId: string;
  eventName: string;
  eventStart: Date;
  eventEnd: Date;
}

/**
 * Two bookings that clash once padded with the venue's new times (104-S1). `first` is the earlier booking and is occupied
 * until `occupiedUntil`; `second` is occupied from `occupiedFrom`.
 */
export interface AffectedPair {
  first: AffectedSide & { occupiedUntil: Date };
  second: AffectedSide & { occupiedFrom: Date };
}

/** SCRUM-101: saves a venue's setup and turnaround times. SCRUM-104: and says which existing bookings now conflict. */
export interface VenueTimingWriter {
  set(venueId: string, setupMinutes: number, turnaroundMinutes: number): Promise<AffectedPair[]>;
}

const DEADLOCK_DETECTED = "40P01";
const MAX_ATTEMPTS = 3;

type Row = Record<string, unknown>;

/**
 * Calls the set_venue_timing database function as the caller. The function (migration 26, re-created by 36) is the only way
 * to write these columns and allows venue staff only, so RLS stays the authority; the route's role check is just the
 * friendly 403. It flags the conflicting bookings in the same transaction and returns the pairs (SCRUM-104).
 */
export class SupabaseVenueTimingWriter implements VenueTimingWriter {
  constructor(private readonly db: SupabaseClient) {}

  async set(venueId: string, setupMinutes: number, turnaroundMinutes: number): Promise<AffectedPair[]> {
    // 40P01: the function locks bookings before the venue (migration 36) so it should not deadlock with a coordinator's
    // change, but if Postgres picks it as a victim nothing was written and it is safe to run again.
    for (let attempt = 1; ; attempt++) {
      const { data, error } = await this.db.rpc("set_venue_timing", {
        p_venue_id: venueId,
        p_setup: setupMinutes,
        p_turnaround: turnaroundMinutes,
      });
      if (!error) return ((data ?? []) as Row[]).map(toAffectedPair);
      if (error.code === DEADLOCK_DETECTED && attempt < MAX_ATTEMPTS) continue;
      throw new Error(`Saving venue times failed: ${error.message}`, { cause: error });
    }
  }
}

function toAffectedPair(row: Row): AffectedPair {
  return {
    first: {
      bookingId: row.booking_id as string,
      eventName: (row.event_name as string | null) ?? "",
      eventStart: new Date(row.event_start as string),
      eventEnd: new Date(row.event_end as string),
      occupiedUntil: new Date(row.occupied_until as string),
    },
    second: {
      bookingId: row.other_booking_id as string,
      eventName: (row.other_event_name as string | null) ?? "",
      eventStart: new Date(row.other_event_start as string),
      eventEnd: new Date(row.other_event_end as string),
      occupiedFrom: new Date(row.other_occupied_from as string),
    },
  };
}
