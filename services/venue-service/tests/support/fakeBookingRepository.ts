import { isHoldingDbStatus, periodsOverlap } from "@spm-t5/shared";
import { bookingError } from "../../src/domain/errors";
import type { BookingChange, BookingRecord, Decision, NewBooking } from "../../src/domain/types";
import type { BookingRepository } from "../../src/repositories/bookingRepository";

/**
 * In-memory BookingRepository for unit tests. It enforces the same rules as the database
 * constraints in supabase/migrations/06 and 28 (slot exclusion, one active replacement per rejected request, one
 * suggestion acceptance), so unit tests exercise the data-layer guard, not just the pre-checks.
 * insert() checks and pushes synchronously, which makes it atomic, like the real constraint.
 */
export class FakeBookingRepository implements BookingRepository {
  readonly rows: BookingRecord[] = [];
  private counter = 0;

  constructor(private readonly now: () => Date = () => new Date("2026-10-01T00:00:00.000Z")) {}

  /** Adds a row directly, bypassing every rule. For arranging test fixtures. */
  seed(partial: Partial<BookingRecord> & Pick<BookingRecord, "eventId" | "venueId" | "start" | "end">): BookingRecord {
    const row: BookingRecord = {
      id: `booking-${++this.counter}`,
      status: "requested",
      snapshot: { eventName: "Seeded event", expectedAttendance: 10, venueRequirements: null, accessibilityNeeds: null },
      requestedBy: "seed-user",
      createdAt: this.now(),
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: null,
      withdrawnBy: null,
      withdrawnAt: null,
      cancelledBy: null,
      cancelledAt: null,
      cancellationReason: null,
      amendsBookingId: null,
      fromSuggestion: false,
      suggestion: null,
      ...partial,
    };
    this.rows.push(row);
    return row;
  }

  async hasHold(venueId: string, start: Date, end: Date): Promise<boolean> {
    return this.rows.some(
      (r) => r.venueId === venueId && isHoldingDbStatus(r.status) && periodsOverlap(r, { start, end }),
    );
  }

  async listPending(): Promise<BookingRecord[]> {
    return this.rows.filter((r) => r.status === "requested").sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  }

  async withdraw(id: string, by: string, at: Date): Promise<BookingRecord | null> {
    const row = this.rows.find((r) => r.id === id);
    if (!row || row.status !== "requested") return null;
    Object.assign(row, { status: "withdrawn", withdrawnBy: by, withdrawnAt: at });
    return row;
  }

  async decide(id: string, decision: Decision, by: string, at: Date): Promise<BookingRecord | null> {
    const row = this.rows.find((r) => r.id === id);
    if (!row || row.status !== "requested") return null;
    Object.assign(row, { status: decision.outcome, reviewedBy: by, reviewedAt: at });
    if (decision.outcome === "rejected") {
      row.reviewNotes = decision.reason ?? null;
      row.suggestion = decision.suggestion ?? null;
    }
    return row;
  }

  async change(id: string, change: BookingChange): Promise<BookingRecord | null> {
    const row = this.rows.find((r) => r.id === id);
    if (!row || !["requested", "approved"].includes(row.status)) return null;
    // the overlap constraint (06) applies to the changed row too, ignoring the row itself (102-S4, 102-S6)
    if (this.rows.some((r) => r.id !== id && r.venueId === row.venueId && isHoldingDbStatus(r.status) && periodsOverlap(r, change))) {
      throw bookingError("SLOT_CONFLICT");
    }
    Object.assign(row, {
      start: change.start,
      end: change.end,
      snapshot: { ...row.snapshot, expectedAttendance: change.expectedAttendance, venueRequirements: change.venueRequirements },
      status: "requested",
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: null,
    });
    return row;
  }

  async cancel(id: string, by: string, at: Date, reason: string): Promise<BookingRecord | null> {
    const row = this.rows.find((r) => r.id === id);
    if (!row || !["requested", "approved"].includes(row.status)) return null;
    Object.assign(row, { status: "cancelled", cancelledBy: by, cancelledAt: at, cancellationReason: reason });
    return row;
  }

  async getById(id: string): Promise<BookingRecord | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async listByEvents(eventIds: string[]): Promise<BookingRecord[]> {
    return this.rows
      .filter((r) => eventIds.includes(r.eventId))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async listByEvent(eventId: string): Promise<BookingRecord[]> {
    return this.rows.filter((r) => r.eventId === eventId);
  }

  async insert(input: NewBooking): Promise<BookingRecord> {
    // migration 28 (98-S20): one active replacement per rejected venue booking
    if (input.amendsBookingId && this.rows.some((r) => r.amendsBookingId === input.amendsBookingId && isHoldingDbStatus(r.status))) {
      throw bookingError("ACTIVE_REQUEST_EXISTS");
    }
    if (
      input.fromSuggestion &&
      this.rows.some((r) => r.fromSuggestion && r.amendsBookingId === input.amendsBookingId)
    ) {
      throw bookingError("SUGGESTION_ALREADY_USED");
    }
    if (
      this.rows.some(
        (r) => r.venueId === input.venueId && isHoldingDbStatus(r.status) && periodsOverlap(r, input),
      )
    ) {
      throw bookingError("SLOT_CONFLICT");
    }
    return this.seed({
      eventId: input.eventId,
      venueId: input.venueId,
      start: input.start,
      end: input.end,
      requestedBy: input.requestedBy,
      snapshot: input.snapshot,
      amendsBookingId: input.amendsBookingId ?? null,
      fromSuggestion: input.fromSuggestion ?? false,
      status: "requested",
      createdAt: this.now(),
    });
  }
}
