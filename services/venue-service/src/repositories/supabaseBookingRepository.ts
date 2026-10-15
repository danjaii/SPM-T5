import type { SupabaseClient } from "@supabase/supabase-js";
import { bookingError } from "../domain/errors";
import type { BookingChange, BookingRecord, Decision, NewBooking } from "../domain/types";
import type { BookingRepository } from "./bookingRepository";

/** Columns read back from venue_bookings. */
export const BOOKING_COLUMNS =
  "id, event_id, venue_id, event_start_datetime, event_end_datetime, status, requested_by, created_at, " +
  "reviewed_by, reviewed_at, review_notes, withdrawn_by, withdrawn_at, amends_booking_id, from_suggestion, " +
  "cancelled_by, cancelled_at, cancellation_reason, " +
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
    cancelledBy: (row.cancelled_by as string | null) ?? null,
    cancelledAt: date(row.cancelled_at),
    cancellationReason: (row.cancellation_reason as string | null) ?? null,
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
    // 98-S20 (migration 28): the rejected venue booking already has an active replacement
    if (message.includes("venue_bookings_one_active_replacement")) return bookingError("ACTIVE_REQUEST_EXISTS");
    if (message.includes("venue_bookings_one_suggestion_accept")) return bookingError("SUGGESTION_ALREADY_USED");
  }
  // The original stays attached as `cause` for server-side logging; it is never sent to the caller.
  return new Error("Could not save the venue booking request.", { cause: error });
}

export class SupabaseBookingRepository implements BookingRepository {
  constructor(private readonly db: SupabaseClient) {}

  /**
   * Asks the database through venue_slot_is_held (migration 07), a yes/no security definer helper:
   * under RLS a coordinator cannot read other coordinators' requests, so a plain select here would
   * never see the request holding the slot. The exclusion constraint remains the authority.
   */
  async hasHold(venueId: string, start: Date, end: Date): Promise<boolean> {
    const { data, error } = await this.db.rpc("venue_slot_is_held", {
      p_venue_id: venueId,
      p_start: start.toISOString(),
      p_end: end.toISOString(),
    });
    if (error) throw new Error("Could not check the venue's availability.");
    return data === true;
  }

  async listPending(): Promise<BookingRecord[]> {
    const { data, error } = await this.db
      .from("venue_bookings")
      .select(BOOKING_COLUMNS)
      .eq("status", "requested")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) throw new Error("Could not read the pending venue booking requests.");
    return (data as unknown as Row[]).map(toBookingRecord);
  }

  /** The conditional `status = 'requested'` makes the transition atomic: only one of two racing callers matches. */
  private async transitionFromPending(id: string, patch: Record<string, unknown>): Promise<BookingRecord | null> {
    const { data, error } = await this.db
      .from("venue_bookings")
      .update(patch)
      .eq("id", id)
      .eq("status", "requested")
      .select(BOOKING_COLUMNS)
      .maybeSingle();
    if (error) throw new Error("Could not update the venue booking request.", { cause: error });
    return data ? toBookingRecord(data as unknown as Row) : null;
  }

  withdraw(id: string, by: string, at: Date): Promise<BookingRecord | null> {
    return this.transitionFromPending(id, {
      status: "withdrawn",
      withdrawn_by: by,
      withdrawn_at: at.toISOString(),
    });
  }

  decide(id: string, decision: Decision, by: string, at: Date): Promise<BookingRecord | null> {
    const patch: Record<string, unknown> = {
      status: decision.outcome,
      reviewed_by: by,
      reviewed_at: at.toISOString(),
    };
    if (decision.outcome === "rejected") {
      patch.review_notes = decision.reason ?? null;
      if (decision.suggestion) {
        patch.suggested_venue_id = decision.suggestion.venueId;
        patch.suggested_start_datetime = decision.suggestion.start.toISOString();
        patch.suggested_end_datetime = decision.suggestion.end.toISOString();
      }
    }
    return this.transitionFromPending(id, patch);
  }

  /**
   * SCRUM-102/AC1: through change_venue_booking() (migration 30), a security definer function, because coordinators may only
   * update a venue booking's status directly (07). It checks the caller and the venue booking and updates it in one step;
   * the overlap constraint (06) still applies. Null when the venue booking was no longer PENDING or APPROVED.
   */
  async change(id: string, change: BookingChange, _at: Date): Promise<BookingRecord | null> {
    const { data, error } = await this.db.rpc("change_venue_booking", {
      p_booking_id: id,
      p_start: change.start.toISOString(),
      p_end: change.end.toISOString(),
      p_expected_attendance: change.expectedAttendance,
      p_venue_requirements: change.venueRequirements,
    });
    if (error) throw translate(error);
    return data === true ? this.getById(id) : null;
  }

  /**
   * SCRUM-102/AC2, AC3: through cancel_venue_bookings() (migration 30), a security definer function, for the same reason
   * as change(). It cancels all of them or none. Null when any was no longer PENDING or APPROVED.
   */
  async cancel(ids: string[], by: string, at: Date, reason: string): Promise<BookingRecord[] | null> {
    const { data, error } = await this.db.rpc("cancel_venue_bookings", { p_booking_ids: ids, p_reason: reason });
    if (error) throw translate(error);
    if (data !== true) return null;
    const rows = await Promise.all(ids.map((id) => this.getById(id)));
    return rows.filter((r): r is BookingRecord => r !== null);
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
