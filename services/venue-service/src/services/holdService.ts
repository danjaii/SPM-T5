import { parseHoldExpiryInput, parseHoldWarningInput } from "@spm-t5/shared";
import { bookingError, forbidden, notFound, validationFailed } from "../domain/errors";
import type { BookingRepository } from "../repositories/bookingRepository";
import type { HoldExpiryWriter } from "../readers/holdExpiryWriter";
import type { HoldWarningWriter } from "../readers/holdWarningWriter";
import type { Caller } from "./bookingService";

export interface HoldDeps {
  bookings: BookingRepository;
  /** Built only when an expiry is set, so other requests never touch it. */
  holds: () => HoldExpiryWriter;
  /** SCRUM-108: built only when a warning time is set. */
  warnings: () => HoldWarningWriter;
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

  /** SCRUM-108/AC1: the event's coordinator sets how long before expiry they are warned. Role, existence, status, then the minutes; the database repeats every rule and checks it is their own event. */
  async setWarning(caller: Caller, id: string, body: unknown): Promise<{ id: string; status: "PENDING"; holdWarningMinutes: number }> {
    if (caller.role !== "event_coordinator") throw forbidden();
    const booking = await this.deps.bookings.getById(id);
    if (!booking) throw notFound("Venue booking request not found.");
    if (booking.status !== "requested") throw bookingError("NOT_PENDING");
    const parsed = parseHoldWarningInput(body);
    if (!parsed.ok) throw validationFailed(parsed.fieldErrors);

    const saved = await this.deps.warnings().setWarning(id, parsed.data.minutes);
    return { id: saved.id, status: "PENDING", holdWarningMinutes: saved.holdWarningMinutes };
  }
}
