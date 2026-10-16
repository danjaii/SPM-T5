import { unavailableMessage } from "@spm-t5/shared";
import { BookingError } from "../domain/errors";
import type { UnavailabilityConflict } from "../domain/types";
import type { BookingRepository } from "../repositories/bookingRepository";

/** The 409 refusal for a request that overlaps an unavailability block: the block's period, never its reason (105-S4). */
export function unavailableError(block: UnavailabilityConflict): BookingError {
  return new BookingError("VENUE_UNAVAILABLE", 409, unavailableMessage(block.venueName, block.start, block.end));
}

/**
 * SCRUM-105: a venue marked unavailable cannot be requested for a period that touches the block, and a request occupies its
 * venue from its setup before it starts to its turnaround after it ends (SCRUM-103), so those count against the block.
 * Like SlotConflictRule this is the friendly pre-check; the padded-overlap trigger (migration 39, CS105) is the guarantee.
 */
export class UnavailabilityRule {
  constructor(private readonly bookings: BookingRepository) {}

  /** The earliest block in the way of the padded request, or null when none is. */
  async findBlock(venueId: string, start: Date, end: Date): Promise<UnavailabilityConflict | null> {
    return (await this.bookings.unavailabilityConflicts(venueId, start, end))[0] ?? null;
  }

  /** Resolves if no block is in the way; throws BookingError VENUE_UNAVAILABLE, naming the block's period, otherwise. */
  async check(venueId: string, start: Date, end: Date): Promise<void> {
    const block = await this.findBlock(venueId, start, end);
    if (block) throw unavailableError(block);
  }
}
