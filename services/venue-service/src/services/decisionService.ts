import { parseRejectionInput, utcToSgt } from "@spm-t5/shared";
import { bookingError, forbidden, notFound, validationFailed } from "../domain/errors";
import type { BookingRecord } from "../domain/types";
import type { EventReader } from "../readers/eventReader";
import type { VenueReader } from "../readers/venueReader";
import type { BookingRepository } from "../repositories/bookingRepository";
import type { Caller } from "./bookingService";

export interface DecisionDeps {
  bookings: BookingRepository;
  events: EventReader;
  venues: VenueReader;
  now: () => Date;
}

/** An event's approved venue booking, as the Coordinator sees it (38-S4). */
export interface EventVenueBooking {
  venueName: string;
  date: string;
  startTime: string;
  endTime: string;
}

/** SCRUM-38 / SCRUM-39: Venue Staff decide pending venue booking requests. */
export class DecisionService {
  constructor(private readonly deps: DecisionDeps) {}

  /** The pending request this caller may decide, checked in the spec's order: role, existence, status. */
  private async loadPending(caller: Caller, id: string): Promise<BookingRecord> {
    if (caller.role !== "venue_staff") throw forbidden();
    const booking = await this.deps.bookings.getById(id);
    if (!booking) throw notFound("Venue booking request not found.");
    if (booking.status !== "requested") throw bookingError("NOT_PENDING");
    return booking;
  }

  /**
   * 38-S1: approve a PENDING request. The pre-checks give clear refusals; the conditional update inside
   * decide() settles a race with another decision (38-S3). There is no capacity or suitability check
   * (38-S7), and the event is not touched (DR10).
   */
  async approve(caller: Caller, id: string): Promise<BookingRecord> {
    const { bookings, now } = this.deps;
    const booking = await this.loadPending(caller, id);
    // 38-S8: the check uses the injected clock, so tests decide what "now" is.
    if (booking.start.getTime() < now().getTime()) throw bookingError("SLOT_IN_PAST");
    // 104-S4: a flagged request cannot be approved until the conflict is gone; rejecting stays allowed. The database trigger
    // (migration 36, CS104) is the authority; this check gives the clear refusal first.
    if ((await bookings.flagsFor([id])).length > 0) throw bookingError("BOOKING_FLAGGED");

    const approved = await bookings.decide(id, { outcome: "approved" }, caller.id, now());
    if (!approved) throw bookingError("NOT_PENDING");
    return approved;
  }

  /**
   * 39-S1: reject a PENDING request with a reason. Same order as approve, with the reason checked after
   * the status (39-S2, 39-S5). A rejection is final (39-S3) and releases the slot (39-S4); the event is
   * not touched (39-S6). Any suggestion in the body is ignored until SCRUM-40.
   */
  async reject(caller: Caller, id: string, body: unknown): Promise<BookingRecord> {
    const { bookings, now } = this.deps;
    await this.loadPending(caller, id);
    const parsed = parseRejectionInput(body);
    if (!parsed.ok) throw validationFailed(parsed.fieldErrors);

    const rejected = await bookings.decide(id, { outcome: "rejected", reason: parsed.data.reason }, caller.id, now());
    if (!rejected) throw bookingError("NOT_PENDING");
    return rejected;
  }

  /** 38-S4: the event's APPROVED request with its venue name, or null. Only the assigned Coordinator may ask. */
  async approvedBookingFor(caller: Caller, eventId: string): Promise<EventVenueBooking | null> {
    const { bookings, events, venues } = this.deps;
    if (caller.role !== "event_coordinator") throw forbidden();
    const event = await events.getById(eventId);
    if (!event) throw notFound("Event not found.");
    if (event.assignedCoordinatorId !== caller.id) throw forbidden();

    // Legacy holding statuses (tentative, confirmed) also read as APPROVED (DR4).
    const approved = (await bookings.listByEvent(eventId)).find((b) =>
      ["approved", "tentative", "confirmed"].includes(b.status),
    );
    if (!approved) return null;

    const start = utcToSgt(approved.start);
    return {
      venueName: (await venues.getById(approved.venueId))?.name ?? "Unknown venue",
      date: start.date,
      startTime: start.time,
      endTime: utcToSgt(approved.end).time,
    };
  }
}
