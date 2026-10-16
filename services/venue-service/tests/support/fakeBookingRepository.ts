import { dbStatusToApi, isHoldingDbStatus, paddedPeriod, periodsOverlap, type Period, type VenueTiming } from "@spm-t5/shared";
import { bookingError } from "../../src/domain/errors";
import type { BookingChange, BookingRecord, Decision, NewBooking, SlotConflict, UnavailabilityConflict } from "../../src/domain/types";
import type { BookingRepository } from "../../src/repositories/bookingRepository";

/**
 * In-memory BookingRepository for unit tests. It enforces the same rules as the database
 * constraints in supabase/migrations/06 and 28 (slot exclusion, one active replacement per rejected request, one
 * suggestion acceptance), so unit tests exercise the data-layer guard, not just the pre-checks.
 * insert() checks and pushes synchronously, which makes it atomic, like the real constraint.
 * Since SCRUM-103 the slot rule compares padded periods (the trigger in migration 27), using the venue's
 * current setup and turnaround times from setVenue(); a venue never given times is 0 and 0.
 */
export class FakeBookingRepository implements BookingRepository {
  readonly rows: BookingRecord[] = [];
  private counter = 0;

  constructor(private readonly now: () => Date = () => new Date("2026-10-01T00:00:00.000Z")) {}

  private readonly venues = new Map<string, VenueTiming & { name: string }>();

  /** SCRUM-103: gives a venue its name and current setup and turnaround times. */
  setVenue(venueId: string, venue: Partial<VenueTiming> & { name?: string }): void {
    this.venues.set(venueId, { name: venue.name ?? venueId, setupMinutes: venue.setupMinutes ?? 0, turnaroundMinutes: venue.turnaroundMinutes ?? 0 });
  }

  private readonly blocks: { venueId: string; start: Date; end: Date; reason: string }[] = [];

  /** SCRUM-105: an unavailability block on a venue. The padded-overlap trigger (migration 38) refuses bookings that touch it. */
  setUnavailable(venueId: string, start: Date, end: Date, reason = "maintenance"): void {
    this.blocks.push({ venueId, start, end, reason });
  }

  /** The blocks that overlap the padded `p` (half-open; the block itself is not padded), earliest first. */
  private blocksFor(venueId: string, p: Period) {
    const venue = this.venueOf(venueId);
    const wanted = paddedPeriod(p, venue);
    return this.blocks
      .filter((b) => b.venueId === venueId && periodsOverlap(b, wanted))
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  async unavailabilityConflicts(venueId: string, start: Date, end: Date): Promise<UnavailabilityConflict[]> {
    const venue = this.venueOf(venueId);
    return this.blocksFor(venueId, { start, end }).map((b) => ({ start: b.start, end: b.end, reason: b.reason, venueName: venue.name }));
  }

  private venueOf(venueId: string) {
    return this.venues.get(venueId) ?? { name: venueId, setupMinutes: 0, turnaroundMinutes: 0 };
  }

  /** The holding requests at this venue whose padded period overlaps the padded `p`, earliest first. */
  private conflictsWith(venueId: string, p: Period, excludeId?: string): BookingRecord[] {
    const venue = this.venueOf(venueId);
    const wanted = paddedPeriod(p, venue);
    return this.rows
      .filter((r) => r.id !== excludeId && r.venueId === venueId && isHoldingDbStatus(r.status) && periodsOverlap(paddedPeriod(r, venue), wanted))
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }

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
      suitability: null,
      suitabilityUnmet: null,
      suitabilityOverrideReason: null,
      ...partial,
    };
    this.rows.push(row);
    return row;
  }

  async hasHold(venueId: string, start: Date, end: Date): Promise<boolean> {
    return this.conflictsWith(venueId, { start, end }).length > 0;
  }

  async slotConflicts(venueId: string, start: Date, end: Date, excludeBookingId?: string): Promise<SlotConflict[]> {
    const venue = this.venueOf(venueId);
    return this.conflictsWith(venueId, { start, end }, excludeBookingId).map((r) => this.occupied(r, venue));
  }

  async occupiedPeriods(venueId: string, from: Date, to: Date): Promise<SlotConflict[]> {
    const venue = this.venueOf(venueId);
    return this.rows
      .filter((r) => r.venueId === venueId && isHoldingDbStatus(r.status) && periodsOverlap(paddedPeriod(r, venue), { start: from, end: to }))
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .map((r) => this.occupied(r, venue));
  }

  private occupied(r: BookingRecord, venue: VenueTiming & { name: string }): SlotConflict {
    const padded = paddedPeriod(r, venue);
    return {
      eventStart: r.start,
      eventEnd: r.end,
      occupiedStart: padded.start,
      occupiedEnd: padded.end,
      status: dbStatusToApi(r.status) === "PENDING" ? "PENDING" : "APPROVED",
      venueName: venue.name,
      timing: { setupMinutes: venue.setupMinutes, turnaroundMinutes: venue.turnaroundMinutes },
    };
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
    // the padded-overlap trigger (27) applies to the changed row too, ignoring the row itself (102-S4, 102-S6, 103)
    if (this.conflictsWith(row.venueId, change, id).length > 0) {
      throw bookingError("SLOT_CONFLICT");
    }
    if (this.blocksFor(row.venueId, change).length > 0) throw bookingError("VENUE_UNAVAILABLE"); // migration 38
    Object.assign(row, {
      start: change.start,
      end: change.end,
      snapshot: { ...row.snapshot, expectedAttendance: change.expectedAttendance, venueRequirements: change.venueRequirements },
      ...(change.suitability
        ? { suitability: change.suitability.result, suitabilityUnmet: change.suitability.unmet, suitabilityOverrideReason: change.suitability.overrideReason }
        : {}),
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
    if (this.conflictsWith(input.venueId, input).length > 0) {
      throw bookingError("SLOT_CONFLICT");
    }
    if (this.blocksFor(input.venueId, input).length > 0) throw bookingError("VENUE_UNAVAILABLE"); // migration 38
    return this.seed({
      eventId: input.eventId,
      venueId: input.venueId,
      start: input.start,
      end: input.end,
      requestedBy: input.requestedBy,
      snapshot: input.snapshot,
      amendsBookingId: input.amendsBookingId ?? null,
      fromSuggestion: input.fromSuggestion ?? false,
      suitability: input.suitability?.result ?? null,
      suitabilityUnmet: input.suitability?.unmet ?? null,
      suitabilityOverrideReason: input.suitability?.overrideReason ?? null,
      status: "requested",
      createdAt: this.now(),
    });
  }
}
