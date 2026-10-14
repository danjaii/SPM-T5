import { canRequestVenue, exceedsCapacity, isHoldingDbStatus, parseVenueBookingInput, periodsOverlap, utcToSgt, type Role } from "@spm-t5/shared";
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

/** A new booking, and whether more people are expected than its venue holds (SCRUM-98/AC2: a warning only). */
export interface SubmittedBooking {
  booking: BookingRecord;
  exceedsCapacity: boolean;
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

  /** The rejected request this caller may amend or accept a suggestion on (DR2, 60-S4, 60-S7). */
  private async loadRejectedFor(caller: Caller, id: string): Promise<BookingRecord> {
    const { bookings, events } = this.deps;
    if (caller.role !== "event_coordinator") throw forbidden();
    const original = await bookings.getById(id);
    if (!original) throw notFound("Venue booking request not found.");
    const event = await events.getById(original.eventId);
    if (!event || event.assignedCoordinatorId !== caller.id) throw forbidden();
    if (original.status !== "rejected") throw bookingError("NOT_REJECTED");
    return original;
  }

  /**
   * SCRUM-60: a new PENDING request for another venue, date or time that refers to a rejected one.
   * The rejected request is never written. Every other rule is submit()'s, so nothing is duplicated.
   */
  async amend(caller: Caller, id: string, body: unknown): Promise<SubmittedBooking> {
    const original = await this.loadRejectedFor(caller, id);
    const fields = typeof body === "object" && body !== null ? body : {};
    return this.submit(caller, { ...fields, eventId: original.eventId }, { amendsBookingId: original.id });
  }

  /**
   * SCRUM-59: one action to take the exact venue, date and time Venue Staff suggested. It goes through
   * the same amend path as SCRUM-60, so every submit rule applies and nothing is duplicated.
   * The suggestion's "used" state is the new request itself (from_suggestion = true); the unique index
   * in migration 06 makes a second accept fail even if two race past the pre-check (59-S3).
   */
  async acceptSuggestion(caller: Caller, id: string): Promise<SubmittedBooking> {
    const original = await this.loadRejectedFor(caller, id);
    if (!original.suggestion) throw bookingError("NO_SUGGESTION");

    const history = await this.deps.bookings.listByEvent(original.eventId);
    if (history.some((b) => b.fromSuggestion && b.amendsBookingId === original.id)) {
      throw bookingError("SUGGESTION_ALREADY_USED");
    }

    const start = utcToSgt(original.suggestion.start);
    const body = {
      eventId: original.eventId,
      venueId: original.suggestion.venueId,
      date: start.date,
      startTime: start.time,
      endTime: utcToSgt(original.suggestion.end).time,
    };
    return this.submit(caller, body, { amendsBookingId: original.id, fromSuggestion: true });
  }

  async submit(caller: Caller, body: unknown, options: SubmitOptions = {}): Promise<SubmittedBooking> {
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

    // SCRUM-98 dropped DR6: an event may hold several bookings at once. What stays (60-S5, 98-S20) is that
    // one rejected booking has at most one pending or approved replacement.
    const history = await bookings.listByEvent(event.id);
    const replacementExists = history.some(
      (b) => options.amendsBookingId !== undefined && b.amendsBookingId === options.amendsBookingId && isHoldingDbStatus(b.status),
    );
    if (replacementExists) throw bookingError("ACTIVE_REQUEST_EXISTS");

    // 32-S7 (DR7).
    const repeatsRejected = history.some(
      (b) =>
        b.status === "rejected" &&
        b.venueId === input.venueId &&
        b.start.getTime() === input.start.getTime() &&
        b.end.getTime() === input.end.getTime(),
    );
    if (repeatsRejected) throw bookingError("REPEAT_OF_REJECTED");

    // 98-S13, 98-S14: this event already holds the same venue for an overlapping period. Checked before the
    // slot check, which would refuse it too but with a message that points at someone else.
    const ownOverlap = history.some(
      (b) => b.venueId === input.venueId && isHoldingDbStatus(b.status) && periodsOverlap(b, input),
    );
    if (ownOverlap) throw bookingError("DUPLICATE_VENUE");

    // 32-S8: friendly pre-check; the database constraint stays the authority (36-S4).
    await this.slotRule.check(input.venueId, input.start, input.end);

    // 32-S10: the snapshot is copied now and never updated (DR8). 98-S6, 98-S7: the booking's own attendance and
    // requirements if it has them, the event's if not.
    const expectedAttendance = input.expectedAttendance ?? event.expectedAttendance;
    const booking = await bookings.insert({
      eventId: event.id,
      venueId: input.venueId,
      start: input.start,
      end: input.end,
      requestedBy: caller.id,
      snapshot: {
        eventName: event.name,
        expectedAttendance,
        venueRequirements: input.venueRequirements ?? event.venueRequirements,
        accessibilityNeeds: event.accessibilityNeeds,
      },
      amendsBookingId: options.amendsBookingId ?? null,
      fromSuggestion: options.fromSuggestion ?? false,
    });

    // 32-S9, 98-S10: more people than the venue holds is flagged, never refused.
    return { booking, exceedsCapacity: exceedsCapacity(expectedAttendance, venue.maxCapacity) };
  }
}
