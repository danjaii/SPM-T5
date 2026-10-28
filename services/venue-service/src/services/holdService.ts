import { parseHoldExpiryInput } from "@spm-t5/shared";
import { bookingError, forbidden, notFound, validationFailed } from "../domain/errors";
import type { BookingRepository } from "../repositories/bookingRepository";
import type { HoldExpiryWriter } from "../readers/holdExpiryWriter";
import type { Caller } from "./bookingService";

export interface HoldDeps {
  bookings: BookingRepository;
  /** Built only when an expiry is set, so other requests never touch it. */
  holds: () => HoldExpiryWriter;
  now: () => Date;
}

/** SCRUM-97: Venue Staff set and update the expiry of a tentative hold. */
export class HoldService {
  constructor(private readonly deps: HoldDeps) {}

  /** Checked in the spec's order: role, existence, status, then the expiry itself. The database repeats every rule. */
  async setExpiry(caller: Caller, id: string, body: unknown): Promise<{ id: string; status: "PENDING"; holdExpiresAt: Date }> {
    const { bookings, holds, now } = this.deps;
    if (caller.role !== "venue_staff") throw forbidden();
    const booking = await bookings.getById(id);
    if (!booking) throw notFound("Venue booking request not found.");
    if (booking.status !== "requested") throw bookingError("NOT_PENDING");
    const parsed = parseHoldExpiryInput(body, now(), booking.start);
    if (!parsed.ok) throw validationFailed(parsed.fieldErrors);

    const saved = await holds().set(id, parsed.data.expiresAt);
    return { id: saved.id, status: "PENDING", holdExpiresAt: saved.holdExpiresAt };
  }
}
