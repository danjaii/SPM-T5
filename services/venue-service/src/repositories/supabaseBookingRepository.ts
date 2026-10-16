import type { SupabaseClient } from "@supabase/supabase-js";
import { dbStatusToApi } from "@spm-t5/shared";
import { BookingError, bookingError, forbidden } from "../domain/errors";
import type { BookingChange, BookingRecord, Decision, FlagRecord, NewBooking, SlotConflict, UnavailabilityConflict } from "../domain/types";
import type { BookingRepository } from "./bookingRepository";

/** Columns read back from venue_bookings. */
export const BOOKING_COLUMNS =
  "id, event_id, venue_id, event_start_datetime, event_end_datetime, status, requested_by, created_at, " +
  "reviewed_by, reviewed_at, review_notes, withdrawn_by, withdrawn_at, amends_booking_id, from_suggestion, " +
  "cancelled_by, cancelled_at, cancellation_reason, " +
  "suggested_venue_id, suggested_start_datetime, suggested_end_datetime, " +
  "snapshot_event_name, snapshot_expected_attendance, snapshot_venue_requirements, snapshot_accessibility_needs, " +
  "suitability, suitability_unmet, suitability_override_reason";

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
    suitability: (row.suitability as "suitable" | "not_suitable" | null) ?? null,
    suitabilityUnmet: (row.suitability_unmet as BookingRecord["suitabilityUnmet"]) ?? null,
    suitabilityOverrideReason: (row.suitability_override_reason as string | null) ?? null,
    suggestion: row.suggested_venue_id
      ? {
          venueId: row.suggested_venue_id as string,
          start: new Date(row.suggested_start_datetime as string),
          end: new Date(row.suggested_end_datetime as string),
        }
      : null,
  };
}

/** A row of venue_slot_conflicts / venue_occupied_periods (migration 27). */
function toSlotConflict(row: Row): SlotConflict {
  return {
    eventStart: new Date(row.event_start as string),
    eventEnd: new Date(row.event_end as string),
    occupiedStart: new Date(row.occupied_start as string),
    occupiedEnd: new Date(row.occupied_end as string),
    status: dbStatusToApi(row.status as string) === "PENDING" ? "PENDING" : "APPROVED",
    venueName: row.venue_name as string,
    timing: { setupMinutes: row.setup_minutes as number, turnaroundMinutes: row.turnaround_minutes as number },
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
  // SCRUM-102: change_venue_booking() and cancel_venue_booking() (migration 30) refuse with these
  if (error.code === "42501") return forbidden();
  if (error.code === "CS102") return bookingError("EVENT_NOT_ELIGIBLE");
  // SCRUM-105: the padded-overlap trigger (migration 38) found the period inside an unavailability block
  if (error.code === "CS105") return bookingError("VENUE_UNAVAILABLE");
  // SCRUM-104: the approve guard (migration 36) refuses a request that still carries an open flag
  if (error.code === "CS104") return bookingError("BOOKING_FLAGGED");
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
   * Asks the database through venue_slot_is_held (migration 07, padded since migration 27), a yes/no security definer helper:
   * under RLS a coordinator cannot read other coordinators' requests, so a plain select here would
   * never see the request holding the slot. The padded-overlap trigger remains the authority.
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

  /** The padded conflicts, from venue_slot_conflicts (migration 27): security definer, so other coordinators' holds are visible, and identity-free. */
  async slotConflicts(venueId: string, start: Date, end: Date, excludeBookingId?: string): Promise<SlotConflict[]> {
    const { data, error } = await this.db.rpc("venue_slot_conflicts", {
      p_venue_id: venueId,
      p_start: start.toISOString(),
      p_end: end.toISOString(),
      p_exclude_booking_id: excludeBookingId ?? null,
    });
    if (error) throw new Error("Could not check the venue's availability.");
    return ((data ?? []) as Row[]).map(toSlotConflict);
  }

  /** SCRUM-105: the blocks in the way, from venue_unavailability_conflicts (migration 38): security definer, role-gated, period and reason only. */
  async unavailabilityConflicts(venueId: string, start: Date, end: Date): Promise<UnavailabilityConflict[]> {
    const { data, error } = await this.db.rpc("venue_unavailability_conflicts", {
      p_venue_id: venueId,
      p_start: start.toISOString(),
      p_end: end.toISOString(),
    });
    if (error) throw new Error("Could not check the venue's availability.");
    return ((data ?? []) as Row[]).map((r) => ({
      start: new Date(r.start_datetime as string),
      end: new Date(r.end_datetime as string),
      reason: r.reason as string,
      venueName: r.venue_name as string,
    }));
  }

  /** What occupies the venue in a window, from venue_occupied_periods (migration 27). */
  async occupiedPeriods(venueId: string, from: Date, to: Date): Promise<SlotConflict[]> {
    const { data, error } = await this.db.rpc("venue_occupied_periods", {
      p_venue_id: venueId,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
    });
    if (error) throw new Error("Could not read the venue's availability.");
    return ((data ?? []) as Row[]).map(toSlotConflict);
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
    if (error) {
      // A refusal the database makes on purpose (CS104 flagged, 42501) is a BookingError, not a 500 (104-S4).
      const known = translate(error);
      if (known instanceof BookingError) throw known;
      throw new Error("Could not update the venue booking request.", { cause: error });
    }
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
   * the overlap constraint (06) still applies. Null when the venue booking was no longer PENDING or APPROVED. The time of
   * the change is the database's own, so the interface's `at` is not taken here.
   */
  async change(id: string, change: BookingChange): Promise<BookingRecord | null> {
    const { data, error } = await this.db.rpc("change_venue_booking", {
      p_booking_id: id,
      p_start: change.start.toISOString(),
      p_end: change.end.toISOString(),
      p_expected_attendance: change.expectedAttendance,
      p_venue_requirements: change.venueRequirements,
      // migration 33: the suitability result made afresh for the changed numbers (null leaves the stored one)
      p_suitability: change.suitability?.result ?? null,
      p_suitability_unmet: change.suitability?.unmet ?? null,
      p_suitability_override_reason: change.suitability?.overrideReason ?? null,
    });
    if (error) throw translate(error);
    return data === true ? this.getById(id) : null;
  }

  /**
   * SCRUM-102/AC2, AC7: through cancel_venue_booking() (migration 30), a security definer function, for the same reason as
   * change(). It also releases the venue booking's equipment, in the same step. Null when it was no longer PENDING or
   * APPROVED. `by` and `at` are the database's own (auth.uid(), now()), so they are not sent.
   */
  async cancel(id: string, _by: string, _at: Date, reason: string): Promise<BookingRecord | null> {
    const { data, error } = await this.db.rpc("cancel_venue_booking", { p_booking_id: id, p_reason: reason });
    if (error) throw translate(error);
    return data === true ? this.getById(id) : null;
  }

  /**
   * SCRUM-104: the open flags on these bookings, oldest first, read as the caller. RLS (migration 36) shows Venue Staff
   * every flag and a coordinator only the flags on bookings of their own events.
   */
  async flagsFor(bookingIds: string[]): Promise<FlagRecord[]> {
    if (bookingIds.length === 0) return [];
    const { data, error } = await this.db
      .from("venue_booking_flags")
      .select("id, booking_id, kind, other_booking_id, other_start, other_end, created_at")
      .in("booking_id", bookingIds)
      .is("resolved_at", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) throw new Error("Could not read the venue booking flags.");
    return ((data ?? []) as Row[]).map((row) => ({
      id: row.id as string,
      bookingId: row.booking_id as string,
      kind: row.kind as FlagRecord["kind"],
      otherBookingId: (row.other_booking_id as string | null) ?? null,
      otherStart: date(row.other_start),
      otherEnd: date(row.other_end),
      createdAt: new Date(row.created_at as string),
    }));
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
      suitability: input.suitability?.result ?? null,
      suitability_unmet: input.suitability?.unmet ?? null,
      suitability_override_reason: input.suitability?.overrideReason ?? null,
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
