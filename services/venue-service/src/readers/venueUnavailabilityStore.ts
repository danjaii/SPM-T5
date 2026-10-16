import type { SupabaseClient } from "@supabase/supabase-js";
import type { UnavailabilityBlockRow } from "@spm-t5/shared";
import { forbidden, notFound, validationFailed } from "../domain/errors";

/** What marking a venue unavailable needs. The reason has been validated by the shared parser. */
export interface MarkUnavailable {
  start: Date;
  end: Date;
  reason: string;
  notes?: string;
}

/** SCRUM-105: reads and writes a venue's unavailability blocks. */
export interface VenueUnavailabilityStore {
  /** Saves a block and returns it as stored (who made it, when). */
  mark(venueId: string, input: MarkUnavailable): Promise<UnavailabilityBlockRow>;
  /**
   * Every block of the venue, earliest first (the caller keeps the ones it needs). `withRecorder` also reads the name of the
   * member of staff who made each block; coordinators do not get it.
   */
  list(venueId: string, withRecorder: boolean): Promise<UnavailabilityBlockRow[]>;
}

const COLUMNS = "id, start_datetime, end_datetime, reason, notes, created_at";

type Row = Record<string, unknown>;

const toRow = (r: Row): UnavailabilityBlockRow => ({
  id: r.id as string,
  start: new Date(r.start_datetime as string),
  end: new Date(r.end_datetime as string),
  reason: r.reason as string,
  notes: (r.notes as string | null) ?? null,
  recordedByName: ((r.recorder as { full_name?: string } | null)?.full_name as string | undefined) ?? null,
  recordedAt: new Date(r.created_at as string),
});

/**
 * Talks to Postgres as the caller. Reads are the table (row policy: venue staff and coordinators, migration 39). The one write is
 * mark_venue_unavailable(), which checks the role itself and is the only writer; the route's role check is just the friendly 403.
 */
export class SupabaseVenueUnavailabilityStore implements VenueUnavailabilityStore {
  constructor(private readonly db: SupabaseClient) {}

  async mark(venueId: string, input: MarkUnavailable): Promise<UnavailabilityBlockRow> {
    const { data, error } = await this.db.rpc("mark_venue_unavailable", {
      p_venue_id: venueId,
      p_start: input.start.toISOString(),
      p_end: input.end.toISOString(),
      p_reason: input.reason,
      p_notes: input.notes ?? null,
    });
    if (error) {
      if (error.code === "42501") throw forbidden("Only venue staff can mark a venue unavailable.");
      if (error.code === "P0002") throw notFound("Venue not found.");
      if (error.code === "22023") throw validationFailed({ form: error.message });
      throw new Error("Could not save the unavailability.", { cause: error });
    }
    const { data: row, error: readError } = await this.db
      .from("venue_unavailability")
      .select(`${COLUMNS}, recorder:users!created_by(full_name)`)
      .eq("id", data as string)
      .maybeSingle();
    if (readError || !row) throw new Error("Could not read back the unavailability.", { cause: readError });
    return toRow(row as unknown as Row);
  }

  async list(venueId: string, withRecorder: boolean): Promise<UnavailabilityBlockRow[]> {
    const { data, error } = await this.db
      .from("venue_unavailability")
      .select(withRecorder ? `${COLUMNS}, recorder:users!created_by(full_name)` : COLUMNS)
      .eq("venue_id", venueId)
      .order("start_datetime", { ascending: true });
    if (error) throw new Error("Could not read the venue's unavailability.", { cause: error });
    return (data as unknown as Row[]).map(toRow);
  }
}
