import type { SupabaseClient } from "@supabase/supabase-js";
import { HOLDING_DB_STATUSES } from "@spm-t5/shared";
import { bookingError } from "../domain/errors";
import type { BookingRecord, NewBooking } from "../domain/types";
import type { BookingRepository } from "./bookingRepository";

/** Columns read back from venue_bookings. */
export const BOOKING_COLUMNS =
  "id, event_id, venue_id, event_start_datetime, event_end_datetime, status, requested_by, created_at, " +
  "reviewed_by, reviewed_at, review_notes, withdrawn_by, withdrawn_at, amends_booking_id, from_suggestion, " +
  "suggested_venue_id, suggested_start_datetime, suggested_end_datetime, " +
  "snapshot_event_name, snapshot_expected_attendance, snapshot_venue_requirements, snapshot_accessibility_needs";

type Row = Record<string, unknown>;

const date = (v: unknown) => (v ? new Date(v as string) : null);

export function toBookingRecord(row: Row): BookingRecord {
  return {
    id: row.id as string,
    eventId: row.event_id as string,
    venueId: row.venue_id as string,
    start: new Date(row.event_start_datetime as string),
    end: new Date(row.event_end_datetime as string),
    status: row.status as string,
    snapshot: {
      eventName: (row.snapshot_event_name as string | null) ?? "",
      expectedAttendance: (row.snapshot_expected_attendance as number | null) ?? null,
      venueRequirements: (row.snapshot_venue_requirements as string | null) ?? null,
      accessibilityNeeds: (row.snapshot_accessibility_needs as string | null) ?? null,
    },
    requestedBy: (row.requested_by as string | null) ?? null,
    createdAt: new Date(row.created_at as string),
    reviewedBy: (row.reviewed_by as string | null) ?? null,
    reviewedAt: date(row.reviewed_at),
    reviewNotes: (row.review_notes as string | null) ?? null,
    withdrawnBy: (row.withdrawn_by as string | null) ?? null,
    withdrawnAt: date(row.withdrawn_at),
    amendsBookingId: (row.amends_booking_id as string | null) ?? null,
    fromSuggestion: Boolean(row.from_suggestion),
    suggestion: row.suggested_venue_id
      ? {
          venueId: row.suggested_venue_id as string,
          start: new Date(row.suggested_start_datetime as string),
          end: new Date(row.suggested_end_datetime as string),
        }
      : null,
  };
}

const DEADLOCK_DETECTED = "40P01";
const MAX_ATTEMPTS = 3;

interface PgError {
  code?: string;
  message?: string;
}

/**
 * Turns a Postgres constraint violation into a BookingError. The raw message names the conflicting
 * key and can identify another event's booking, so it is inspected here and never passed on (36-S5).
 * Anything unrecognised is rethrown as a plain Error, which the HTTP layer reports as a 500.
 */
function translate(error: PgError): Error {
  const message = error.message ?? "";
  if (error.code === "23P01") return bookingError("SLOT_CONFLICT");
  if (error.code === "23505") {
    if (message.includes("venue_bookings_one_active_per_event")) return bookingError("ACTIVE_REQUEST_EXISTS");
    if (message.includes("venue_bookings_one_suggestion_accept")) return bookingError("SUGGESTION_ALREADY_USED");
  }
  // The original stays attached as `cause` for server-side logging; it is never sent to the caller.
  return new Error("Could not save the venue booking request.", { cause: error });
}

export class SupabaseBookingRepository implements BookingRepository {
  constructor(private readonly db: SupabaseClient) {}

  async hasHold(venueId: string, start: Date, end: Date): Promise<boolean> {
    const { data, error } = await this.db
      .from("venue_bookings")
      .select("id")
      .eq("venue_id", venueId)
      .in("status", [...HOLDING_DB_STATUSES])
      .lt("event_start_datetime", end.toISOString())
      .gt("event_end_datetime", start.toISOString())
      .limit(1);
    if (error) throw new Error("Could not check the venue's availability.");
    return data.length > 0;
  }

  async getById(id: string): Promise<BookingRecord | null> {
    const { data, error } = await this.db.from("venue_bookings").select(BOOKING_COLUMNS).eq("id", id).maybeSingle();
    if (error) throw new Error("Could not read the venue booking request.");
    return data ? toBookingRecord(data as unknown as Row) : null;
  }

  async listByEvents(eventIds: string[]): Promise<BookingRecord[]> {
    if (eventIds.length === 0) return [];
    const { data, error } = await this.db
      .from("venue_bookings")
      .select(BOOKING_COLUMNS)
      .in("event_id", eventIds)
      .order("created_at", { ascending: false });
    if (error) throw new Error("Could not read your venue booking requests.");
    return (data as unknown as Row[]).map(toBookingRecord);
  }

  async listByEvent(eventId: string): Promise<BookingRecord[]> {
    const { data, error } = await this.db
      .from("venue_bookings")
      .select(BOOKING_COLUMNS)
      .eq("event_id", eventId)
      .order("created_at", { ascending: true });
    if (error) throw new Error("Could not read the event's venue booking requests.");
    return (data as unknown as Row[]).map(toBookingRecord);
  }

  async insert(input: NewBooking): Promise<BookingRecord> {
    const row = {
      event_id: input.eventId,
      venue_id: input.venueId,
      event_start_datetime: input.start.toISOString(),
      event_end_datetime: input.end.toISOString(),
      requested_by: input.requestedBy,
      status: "requested",
      snapshot_event_name: input.snapshot.eventName,
      snapshot_expected_attendance: input.snapshot.expectedAttendance,
      snapshot_venue_requirements: input.snapshot.venueRequirements,
      snapshot_accessibility_needs: input.snapshot.accessibilityNeeds,
      amends_booking_id: input.amendsBookingId ?? null,
      from_suggestion: input.fromSuggestion ?? false,
    };

    // When two overlapping inserts collide head-on, Postgres aborts one as a deadlock victim (40P01;
    // about 7% of races in testing). Only one row ever survives, but the loser has not yet been told
    // why. 40P01 is safe to retry: the winner has committed by then, so the retry reports the real
    // reason (SLOT_CONFLICT, ACTIVE_REQUEST_EXISTS, ...).
    for (let attempt = 1; ; attempt++) {
      const { data, error } = await this.db.from("venue_bookings").insert(row).select(BOOKING_COLUMNS).single();
      if (!error) return toBookingRecord(data as unknown as Row);
      if (error.code === DEADLOCK_DETECTED && attempt < MAX_ATTEMPTS) continue;
      throw translate(error);
    }
  }
}
