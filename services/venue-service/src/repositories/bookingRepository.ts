import type { BookingChange, BookingRecord, Decision, FlagRecord, NewBooking, SlotConflict, UnavailabilityConflict } from "../domain/types";

/**
 * Storage for venue booking requests. The real implementation is Postgres (venue_bookings); the
 * database constraints in migration 06 are the authority for DR5/DR6/DR11, so insert() must turn
 * their violations into BookingErrors and never leak the raw database message (36-S5).
 */
export interface BookingRepository {
  /** True if a PENDING/APPROVED request already holds this venue over any part of the period, setup and turnaround included (SCRUM-103). */
  hasHold(venueId: string, start: Date, end: Date): Promise<boolean>;

  /**
   * SCRUM-103: the holding requests whose padded period (setup before, turnaround after) overlaps this padded
   * request, earliest first, ignoring `excludeBookingId` (a booking being changed, SCRUM-102). Identities are never returned (36-S5).
   */
  slotConflicts(venueId: string, start: Date, end: Date, excludeBookingId?: string): Promise<SlotConflict[]>;

  /** SCRUM-103: the holding requests whose padded period overlaps the window, earliest first (the availability view). */
  occupiedPeriods(venueId: string, from: Date, to: Date): Promise<SlotConflict[]>;

  /**
   * SCRUM-105: the unavailability blocks whose period overlaps the PADDED request (setup before, turnaround after), earliest
   * first. The block itself is not padded. Nothing about who made it (venue_unavailability_conflicts, migration 38).
   */
  unavailabilityConflicts(venueId: string, start: Date, end: Date): Promise<UnavailabilityConflict[]>;

  /** PENDING requests, oldest first: the Venue Staff queue (seam for SCRUM-37). */
  listPending(): Promise<BookingRecord[]>;

  /**
   * Withdraws the request if, and only if, it is still PENDING (SCRUM-35). One atomic conditional
   * update, so a decision made at the same moment wins or loses cleanly (35-S5). Null when the
   * request was not pending (or does not exist).
   */
  withdraw(id: string, by: string, at: Date): Promise<BookingRecord | null>;

  /**
   * Approves or rejects the request if, and only if, it is still PENDING (seam for SCRUM-38 to 40).
   * A rejection may carry a reason and a suggested alternative. Null when it was not pending.
   * Throws BOOKING_FLAGGED when approving a request that carries an open flag (SCRUM-104, enforced by the database).
   */
  decide(
    id: string,
    decision: Decision,
    by: string,
    at: Date,
  ): Promise<BookingRecord | null>;

  /**
   * SCRUM-102/AC1: gives a PENDING or APPROVED venue booking a new period and its own attendance and requirements, and
   * makes it PENDING again with its earlier decision cleared. Null when it was no longer PENDING or APPROVED.
   */
  change(id: string, change: BookingChange, at: Date): Promise<BookingRecord | null>;

  /**
   * SCRUM-102/AC2, AC7: cancels the venue booking with the reason, and releases the equipment requested for it, in one
   * step. Null (and nothing changed) when it was no longer PENDING or APPROVED.
   */
  cancel(id: string, by: string, at: Date, reason: string): Promise<BookingRecord | null>;

  /**
   * SCRUM-104: the open flags (buffer conflicts) on these bookings, oldest first. Only flags the caller may read come back.
   * Their presence blocks approving a pending request (104-S4); a flag never changes a booking's status.
   */
  flagsFor(bookingIds: string[]): Promise<FlagRecord[]>;

  /** One request by id, or null (SCRUM-33 detail). */
  getById(id: string): Promise<BookingRecord | null>;

  /** Requests for any of these events, most recently submitted first (SCRUM-33 list). */
  listByEvents(eventIds: string[]): Promise<BookingRecord[]>;

  /** Every request ever made for the event, oldest first (DR6 active check, DR7 repeat guard). */
  listByEvent(eventId: string): Promise<BookingRecord[]>;

  /**
   * Creates a PENDING request atomically. Throws BookingError:
   *  - SLOT_CONFLICT when the venue is held for an overlapping period (DR5, DR11)
   *  - ACTIVE_REQUEST_EXISTS when the rejected request it replaces already has a PENDING/APPROVED replacement (98-S20)
   *  - SUGGESTION_ALREADY_USED when the suggestion was already accepted (59-S3)
   */
  insert(input: NewBooking): Promise<BookingRecord>;
}
