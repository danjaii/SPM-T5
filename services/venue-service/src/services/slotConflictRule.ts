import { slotConflictMessage } from "@spm-t5/shared";
import { BookingError } from "../domain/errors";
import type { SlotConflict } from "../domain/types";
import type { BookingRepository } from "../repositories/bookingRepository";

/** The 409 refusal for a held slot, saying which period is occupied (103-S1). */
export function slotConflictError(conflict: SlotConflict): BookingError {
  const message = slotConflictMessage(conflict.venueName, { start: conflict.occupiedStart, end: conflict.occupiedEnd }, conflict.timing);
  return new BookingError("SLOT_CONFLICT", 409, message);
}

/**
 * SCRUM-36 (DR5) and SCRUM-103: a venue slot held by a PENDING/APPROVED request cannot be requested again, and a
 * request occupies its venue from its setup before it starts to its turnaround after it ends.
 * This is the friendly pre-check that gives a clear refusal early. It is not the guarantee:
 * two callers can both pass it, so the insert path relies on the database trigger (DR11).
 */
export class SlotConflictRule {
  constructor(private readonly bookings: BookingRepository) {}

  /**
   * The earliest holding request whose padded period overlaps the padded request, or null when the slot is free.
   * SCRUM-109/110 reuse this to say whether a venue is available. `excludeBookingId` is a booking being changed (SCRUM-102),
   * which does not conflict with itself.
   */
  async findConflict(venueId: string, start: Date, end: Date, excludeBookingId?: string): Promise<SlotConflict | null> {
    return (await this.bookings.slotConflicts(venueId, start, end, excludeBookingId))[0] ?? null;
  }

  /** Resolves if the period is free; throws BookingError SLOT_CONFLICT, naming the occupied period, if any part is held. */
  async check(venueId: string, start: Date, end: Date, excludeBookingId?: string): Promise<void> {
    const conflict = await this.findConflict(venueId, start, end, excludeBookingId);
    if (conflict) throw slotConflictError(conflict);
  }
}
