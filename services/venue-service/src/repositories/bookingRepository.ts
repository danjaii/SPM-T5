import type { BookingRecord, NewBooking } from "../domain/types";

/**
 * Storage for venue booking requests. The real implementation is Postgres (venue_bookings); the
 * database constraints in migration 06 are the authority for DR5/DR6/DR11, so insert() must turn
 * their violations into BookingErrors and never leak the raw database message (36-S5).
 */
export interface BookingRepository {
  /** True if a PENDING/APPROVED request already holds this venue over any part of the period. */
  hasHold(venueId: string, start: Date, end: Date): Promise<boolean>;

  /**
   * Creates a PENDING request atomically. Throws BookingError:
   *  - SLOT_CONFLICT when the venue is held for an overlapping period (DR5, DR11)
   *  - ACTIVE_REQUEST_EXISTS when the event already has a PENDING/APPROVED request (DR6)
   *  - SUGGESTION_ALREADY_USED when the suggestion was already accepted (59-S3)
   */
  insert(input: NewBooking): Promise<BookingRecord>;
}
