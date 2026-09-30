import { canRequestVenue, isHoldingDbStatus, parseVenueBookingInput, type Role } from "@spm-t5/shared";
import { bookingError, forbidden, notFound, validationFailed } from "../domain/errors";
import type { BookingRecord } from "../domain/types";
import type { EventInfo, EventReader } from "../readers/eventReader";
import type { VenueReader } from "../readers/venueReader";
import type { BookingRepository } from "../repositories/bookingRepository";
import { SlotConflictRule } from "./slotConflictRule";

export interface Caller {
  id: string;
  /** Undefined when the user has no recognised role. */
  role: Role | undefined;
}

export interface SubmitOptions {
  /** Set by SCRUM-60 / SCRUM-59 when the request replaces a rejected one. */
  amendsBookingId?: string;
  fromSuggestion?: boolean;
}

export interface BookingServiceDeps {
  bookings: BookingRepository;
  events: EventReader;
  venues: VenueReader;
  now: () => Date;
}

/** DR2 + DR9: only the event's assigned Coordinator, and only for an eligible event. */
export function assertMayRequestFor(caller: Caller, event: EventInfo | null): EventInfo {
  if (caller.role !== "event_coordinator") throw forbidden();
  if (!event) throw notFound("Event not found.");
  if (event.assignedCoordinatorId !== caller.id) throw forbidden();
  if (!canRequestVenue(event.status)) throw bookingError("EVENT_NOT_ELIGIBLE");
  return event;
}

/** SCRUM-32: the one path that creates a venue booking request (also used by SCRUM-60 and SCRUM-59). */
export class BookingService {
  private readonly slotRule: SlotConflictRule;

  constructor(private readonly deps: BookingServiceDeps) {
    this.slotRule = new SlotConflictRule(deps.bookings);
  }

  /**
   * SCRUM-35: withdraw a PENDING request. Only the event's assigned Coordinator may (35-S3), and only
   * while it is PENDING (35-S2). The pre-check gives a clear refusal; the conditional update inside
   * withdraw() is what settles a race with a decision (35-S5).
   */
  async withdraw(caller: Caller, id: string): Promise<BookingRecord> {
    const { bookings, events, now } = this.deps;
    if (caller.role !== "event_coordinator") throw forbidden();
    const booking = await bookings.getById(id);
    if (!booking) throw notFound("Venue booking request not found.");
    const event = await events.getById(booking.eventId);
    if (!event || event.assignedCoordinatorId !== caller.id) throw forbidden();
    if (booking.status !== "requested") throw bookingError("NOT_PENDING");

    const withdrawn = await bookings.withdraw(id, caller.id, now());
    if (!withdrawn) throw bookingError("NOT_PENDING");
    return withdrawn;
  }

  async submit(caller: Caller, body: unknown, options: SubmitOptions = {}): Promise<BookingRecord> {
    const { bookings, events, venues, now } = this.deps;

    // 32-S4: the role check comes before anything else, so it reveals nothing about the body or event.
    if (caller.role !== "event_coordinator") throw forbidden();

    // 32-S5: validation (same schema as the web form).
    const eventId = (body as { eventId?: unknown } | null)?.eventId;
    const parsed = parseVenueBookingInput(body, now());
    const fieldErrors: Record<string, string> = parsed.ok ? {} : parsed.fieldErrors;
    if (typeof eventId !== "string" || eventId === "") fieldErrors.eventId = "Choose an event.";
    if (Object.keys(fieldErrors).length > 0 || !parsed.ok || typeof eventId !== "string") {
      throw validationFailed(fieldErrors);
    }
    const input = parsed.data;

    // 32-S4, 32-S3: assigned Coordinator of an eligible event.
    const event = assertMayRequestFor(caller, await events.getById(eventId));

    // 32-S5: unknown or retired venue.
    const venue = await venues.getById(input.venueId);
    if (!venue || !venue.isActive) throw notFound("Venue not found.");

    // 32-S6 (DR6) and 32-S7 (DR7).
    const history = await bookings.listByEvent(event.id);
    if (history.some((b) => isHoldingDbStatus(b.status))) {
      throw bookingError("ACTIVE_REQUEST_EXISTS");
    }
    const repeatsRejected = history.some(
      (b) =>
        b.status === "rejected" &&
        b.venueId === input.venueId &&
        b.start.getTime() === input.start.getTime() &&
        b.end.getTime() === input.end.getTime(),
    );
    if (repeatsRejected) throw bookingError("REPEAT_OF_REJECTED");

    // 32-S8: friendly pre-check; the database constraint stays the authority (36-S4).
    await this.slotRule.check(input.venueId, input.start, input.end);

    // 32-S9: no capacity check. 32-S10: the snapshot is copied now and never updated (DR8).
    return bookings.insert({
      eventId: event.id,
      venueId: input.venueId,
      start: input.start,
      end: input.end,
      requestedBy: caller.id,
      snapshot: {
        eventName: event.name,
        expectedAttendance: event.expectedAttendance,
        venueRequirements: event.venueRequirements,
        accessibilityNeeds: event.accessibilityNeeds,
      },
      amendsBookingId: options.amendsBookingId ?? null,
      fromSuggestion: options.fromSuggestion ?? false,
    });
  }
}
