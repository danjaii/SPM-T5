import type { AvailabilityConflict } from "@spm-t5/shared";
import type { BookingRepository } from "../repositories/bookingRepository";
import { UnavailabilityRule } from "./unavailabilityRule";

/**
 * SCRUM-109 Scenario 4: is the venue free for the period, and if not, which period is in the way?
 * This is the one seam between the suitability check and the booking rules, so the check does not change
 * when the rules do (SCRUM-103 setup and turnaround time, SCRUM-105 unavailability).
 */
export type AvailabilityLookup = (venueId: string, start: Date, end: Date) => Promise<AvailabilityConflict | null>;

/**
 * Today: a plain "is it held?" from the database (`venue_slot_is_held` sees every coordinator's bookings), which does
 * not say which booking is in the way, so the conflict carries the requested period with `exact: false`.
 *
 * When SCRUM-103 merges, replace the body with one line, which returns the exact occupied period:
 *   `new SlotConflictRule(bookings).findConflict(venueId, start, end)`
 */
export const availabilityLookup =
  (bookings: BookingRepository): AvailabilityLookup =>
  async (venueId, start, end) => {
    if (await bookings.hasHold(venueId, start, end)) return { start, end, exact: false };
    // SCRUM-105: nothing holds the slot, but an unavailability block may be in the way (its own period, the earliest one)
    const block = await new UnavailabilityRule(bookings).findBlock(venueId, start, end);
    return block ? { start: block.start, end: block.end, exact: true, kind: "unavailable" } : null;
  };
