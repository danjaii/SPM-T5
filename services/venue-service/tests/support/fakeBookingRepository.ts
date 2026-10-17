import { dbStatusToApi, isHoldingDbStatus, paddedPeriod, periodsOverlap, type Period, type VenueTiming } from "@spm-t5/shared";
import { bookingError } from "../../src/domain/errors";
import type { BookingChange, BookingRecord, Decision, FlagHistoryRecord, FlagRecord, NewBooking, SlotConflict, UnavailabilityConflict } from "../../src/domain/types";
import type { AffectedPair, VenueTimingWriter } from "../../src/readers/venueTimingWriter";
import type { BookingRepository } from "../../src/repositories/bookingRepository";

/** A flag row as the fake keeps it: open until `resolvedAt` is set (migration 36's venue_booking_flags). */
export interface FakeFlag extends FlagRecord {
  resolvedAt: Date | null;
  resolvedReason: "no_longer_conflicts" | "booking_closed" | "replaced" | null;
}

/**
 * In-memory BookingRepository for unit tests. It enforces the same rules as the database
 * constraints in supabase/migrations/06 and 28 (slot exclusion, one active replacement per rejected request, one
 * suggestion acceptance), so unit tests exercise the data-layer guard, not just the pre-checks.
 * insert() checks and pushes synchronously, which makes it atomic, like the real constraint.
 * Since SCRUM-103 the slot rule compares padded periods (the trigger in migration 27), using the venue's
 * current setup and turnaround times from setVenue(); a venue never given times is 0 and 0.
 * Since SCRUM-104 it also keeps flags like migration 36: setTiming() reconciles them (refresh_buffer_flags), a booking that
 * stops holding or moves resolves its flags (the trigger), and decide() refuses to approve a flagged request (the guard, CS104).
 */
export class FakeBookingRepository implements BookingRepository {
  readonly rows: BookingRecord[] = [];
  private counter = 0;

  constructor(private readonly now: () => Date = () => new Date("2026-10-01T00:00:00.000Z")) {}

  private readonly venues = new Map<string, VenueTiming & { name: string }>();

  /** SCRUM-104: every flag ever raised; an open one has `resolvedAt === null`. */
  readonly flagRows: FakeFlag[] = [];
  private flagCounter = 0;

  /** The open flags, for assertions. */
  openFlags(bookingId?: string): FakeFlag[] {
    return this.flagRows.filter((f) => f.resolvedAt === null && (bookingId === undefined || f.bookingId === bookingId));
  }

  private resolveFlags(match: (f: FakeFlag) => boolean, reason: NonNullable<FakeFlag["resolvedReason"]>): void {
    for (const f of this.flagRows) {
      if (f.resolvedAt === null && match(f)) Object.assign(f, { resolvedAt: this.now(), resolvedReason: reason });
    }
  }

  /** The trigger on venue_bookings: a booking that stops holding, or moves so the pair no longer clashes, clears its flags. */
  private afterBookingChange(row: BookingRecord, moved: boolean): void {
    const involves = (f: FakeFlag) => f.bookingId === row.id || f.otherBookingId === row.id;
    if (!isHoldingDbStatus(row.status)) {
      this.resolveFlags(involves, "booking_closed");
    } else if (moved) {
      this.resolveFlags((f) => {
        if (!involves(f)) return false;
        const a = this.rows.find((r) => r.id === f.bookingId);
        const b = this.rows.find((r) => r.id === f.otherBookingId);
        if (!a || !b) return true;
        const venue = this.venueOf(a.venueId);
        return !periodsOverlap(paddedPeriod(a, venue), paddedPeriod(b, venue));
      }, "no_longer_conflicts");
    }
  }

  /** refresh_buffer_flags(): flag every pair of holding, future bookings whose padded periods overlap, both ways; resolve the rest. */
  refreshBufferFlags(venueId: string): void {
    const venue = this.venueOf(venueId);
    const live = this.rows.filter((r) => r.venueId === venueId && isHoldingDbStatus(r.status) && r.end.getTime() > this.now().getTime());
    const pairs: [BookingRecord, BookingRecord][] = [];
    for (const x of live) for (const y of live) if (x.id < y.id && periodsOverlap(paddedPeriod(x, venue), paddedPeriod(y, venue))) pairs.push([x, y]);
    const has = (a: string, b: string) => this.flagRows.some((f) => f.resolvedAt === null && f.bookingId === a && f.otherBookingId === b);
    for (const [x, y] of pairs) {
      for (const [self, other] of [[x, y], [y, x]] as const) {
        if (!has(self.id, other.id)) {
          this.flagRows.push({
            id: `flag-${++this.flagCounter}`,
            bookingId: self.id,
            kind: "buffer_conflict",
            otherBookingId: other.id,
            otherStart: other.start,
            otherEnd: other.end,
            createdAt: this.now(),
            resolvedAt: null,
            resolvedReason: null,
          });
        }
      }
    }
    const stillPaired = (f: FakeFlag) => pairs.some(([x, y]) => (x.id === f.bookingId && y.id === f.otherBookingId) || (y.id === f.bookingId && x.id === f.otherBookingId));
    this.resolveFlags((f) => f.kind === "buffer_conflict" && this.rows.some((r) => r.id === f.bookingId && r.venueId === venueId) && !stillPaired(f), "no_longer_conflicts");
  }

  /** set_venue_timing(): saves the venue's times, reconciles the flags, and returns every open pair, the earlier booking first. */
  setTiming(venueId: string, setupMinutes: number, turnaroundMinutes: number): AffectedPair[] {
    this.venues.set(venueId, { ...this.venueOf(venueId), setupMinutes, turnaroundMinutes });
    this.refreshBufferFlags(venueId);
    const venue = this.venueOf(venueId);
    const pairs: AffectedPair[] = [];
    for (const f of this.openFlags()) {
      const a = this.rows.find((r) => r.id === f.bookingId);
      const b = this.rows.find((r) => r.id === f.otherBookingId);
      if (!a || !b || a.venueId !== venueId || f.kind !== "buffer_conflict") continue;
      if (a.start.getTime() > b.start.getTime() || (a.start.getTime() === b.start.getTime() && a.id > b.id)) continue;
      const side = (r: BookingRecord) => ({ bookingId: r.id, eventName: r.snapshot.eventName, eventStart: r.start, eventEnd: r.end });
      pairs.push({
        first: { ...side(a), occupiedUntil: paddedPeriod(a, venue).end },
        second: { ...side(b), occupiedFrom: paddedPeriod(b, venue).start },
      });
    }
    return pairs.sort((p, q) => p.first.eventStart.getTime() - q.first.eventStart.getTime());
  }

  /** A VenueTimingWriter backed by setTiming(), for the app's `venueTiming` option. */
  timingWriter(): VenueTimingWriter {
    return { set: async (venueId, setup, turnaround) => this.setTiming(venueId, setup, turnaround) };
  }

  /** SCRUM-107: every flag of one booking, open or resolved. */
  async flagHistoryFor(bookingId: string): Promise<FlagHistoryRecord[]> {
    return this.flagRows.filter((f) => f.bookingId === bookingId);
  }

  /** SCRUM-106: a venue_unavailable flag on a booking, as the block trigger (migration 43) raises it. */
  flagUnavailable(bookingId: string, start: Date, end: Date, reason = "maintenance"): FlagRecord {
    const flag: FakeFlag = {
      id: `flag-${++this.flagCounter}`,
      bookingId,
      kind: "venue_unavailable",
      otherBookingId: null,
      otherStart: start,
      otherEnd: end,
      unavailabilityId: `block-${this.flagCounter}`,
      unavailabilityReason: reason,
      createdAt: this.now(),
      resolvedAt: null,
      resolvedReason: null,
    };
    this.flagRows.push(flag);
    return flag;
  }

  async flagsFor(bookingIds: string[]): Promise<FlagRecord[]> {
    return this.openFlags()
      .filter((f) => bookingIds.includes(f.bookingId))
      .map(({ resolvedAt: _at, resolvedReason: _reason, ...flag }) => flag);
  }

  /** SCRUM-103: gives a venue its name and current setup and turnaround times. */
  setVenue(venueId: string, venue: Partial<VenueTiming> & { name?: string }): void {
    this.venues.set(venueId, { name: venue.name ?? venueId, setupMinutes: venue.setupMinutes ?? 0, turnaroundMinutes: venue.turnaroundMinutes ?? 0 });
  }

  private readonly blocks: { venueId: string; start: Date; end: Date; reason: string }[] = [];

  /** SCRUM-105: an unavailability block on a venue. The padded-overlap trigger (migration 39) refuses bookings that touch it. */
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
      sentBackChanges: null,
      sentBackAt: null,
      replacedByBookingId: null,
      replacedAt: null,
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
    this.afterBookingChange(row, false);
    return row;
  }

  async decide(id: string, decision: Decision, by: string, at: Date): Promise<BookingRecord | null> {
    const row = this.rows.find((r) => r.id === id);
    if (!row || row.status !== "requested") return null;
    // migration 36's approve guard (CS104, mapped to BOOKING_FLAGGED by the real repository)
    if (decision.outcome === "approved" && this.openFlags(id).length > 0) throw bookingError("BOOKING_FLAGGED");
    Object.assign(row, { status: decision.outcome, reviewedBy: by, reviewedAt: at });
    this.afterBookingChange(row, false);
    if (decision.outcome === "approved") this.takeOver(row, at);
    if (decision.outcome === "rejected") {
      row.reviewNotes = decision.reason ?? null;
      row.suggestion = decision.suggestion ?? null;
    }
    return row;
  }

  /** migration 45's venue_booking_take_over(): an approved replacement of a holding, flagged-unavailable original replaces it. */
  private takeOver(replacement: BookingRecord, at: Date): void {
    const original = this.rows.find((r) => r.id === replacement.amendsBookingId);
    if (!original || !isHoldingDbStatus(original.status)) return;
    if (!this.openFlags(original.id).some((f) => f.kind === "venue_unavailable")) return;
    Object.assign(original, { status: "replaced", replacedByBookingId: replacement.id, replacedAt: at });
    this.resolveFlags((f) => f.bookingId === original.id, "replaced");
  }

  async change(id: string, change: BookingChange): Promise<BookingRecord | null> {
    const row = this.rows.find((r) => r.id === id);
    if (!row || !["requested", "approved"].includes(row.status)) return null;
    // the padded-overlap trigger (27) applies to the changed row too, ignoring the row itself (102-S4, 102-S6, 103)
    if (this.conflictsWith(row.venueId, change, id).length > 0) {
      throw bookingError("SLOT_CONFLICT");
    }
    if (this.blocksFor(row.venueId, change).length > 0) throw bookingError("VENUE_UNAVAILABLE"); // migration 39
    const moved = change.start.getTime() !== row.start.getTime() || change.end.getTime() !== row.end.getTime();
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
    this.afterBookingChange(row, moved);
    return row;
  }

  async cancel(id: string, by: string, at: Date, reason: string): Promise<BookingRecord | null> {
    const row = this.rows.find((r) => r.id === id);
    if (!row || !["requested", "approved"].includes(row.status)) return null;
    Object.assign(row, { status: "cancelled", cancelledBy: by, cancelledAt: at, cancellationReason: reason });
    this.afterBookingChange(row, false);
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
    if (this.blocksFor(input.venueId, input).length > 0) throw bookingError("VENUE_UNAVAILABLE"); // migration 39
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
