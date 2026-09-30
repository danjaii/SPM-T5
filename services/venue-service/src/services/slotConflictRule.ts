import { bookingError } from "../domain/errors";
import type { BookingRepository } from "../repositories/bookingRepository";

/**
 * SCRUM-36 (DR5): a venue slot held by a PENDING/APPROVED request cannot be requested again.
 * This is the friendly pre-check that gives a clear refusal early. It is not the guarantee:
 * two callers can both pass it, so the insert path relies on the database constraint (DR11).
 */
export class SlotConflictRule {
  constructor(private readonly bookings: BookingRepository) {}

  /** Resolves if the period is free; throws BookingError SLOT_CONFLICT if any part is held. */
  async check(venueId: string, start: Date, end: Date): Promise<void> {
    if (await this.bookings.hasHold(venueId, start, end)) throw bookingError("SLOT_CONFLICT");
  }
}
