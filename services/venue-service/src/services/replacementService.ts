import { isHoldingDbStatus, paddedPeriod, periodsOverlap, utcToSgt, type ReplacementCandidateDto } from "@spm-t5/shared";
import { BookingError, bookingError, forbidden, notFound, validationFailed } from "../domain/errors";
import type { BookingRecord } from "../domain/types";
import type { VenueSearchReader } from "../readers/venueSearchReader";
import { BookingService, type BookingServiceDeps, type Caller, type SubmittedBooking } from "./bookingService";

export interface ReplacementDeps extends BookingServiceDeps {
  /** Which active venues are free for a period (available_venues: padded bookings and blocks), and their capacity. */
  search: VenueSearchReader;
}

/**
 * SCRUM-107 (docs/specs/replacement-venue.md): finding and requesting a replacement for a booking that a venue block made
 * unavailable. The replacement is a NEW PENDING booking linked to the original (amends_booking_id) through submit(), so every
 * normal rule applies; the original is only written when Venue Staff approve the replacement (migration 46's trigger).
 */
export class ReplacementService {
  private readonly bookingService: BookingService;

  constructor(private readonly deps: ReplacementDeps) {
    this.bookingService = new BookingService(deps);
  }

  /**
   * 107-S6, 107-S5: the checks both endpoints share, in the spec's order. Not a coordinator 403; unknown booking 404; not the
   * event's assigned coordinator 403; not holding or no open "venue unavailable" flag NOT_FLAGGED; a replacement already waiting
   * REPLACEMENT_PENDING. The flags are read as the caller, so row-level security shows a coordinator only their own events'.
   */
  private async loadFlagged(caller: Caller, id: string): Promise<{ original: BookingRecord; history: BookingRecord[] }> {
    const { bookings, events } = this.deps;
    if (caller.role !== "event_coordinator") throw forbidden();
    const original = await bookings.getById(id);
    if (!original) throw notFound("Venue booking request not found.");
    const event = await events.getById(original.eventId);
    if (!event || event.assignedCoordinatorId !== caller.id) throw forbidden();

    const flags = await bookings.flagsFor([original.id]);
    if (!isHoldingDbStatus(original.status) || !flags.some((f) => f.kind === "venue_unavailable")) throw bookingError("NOT_FLAGGED");

    const history = await bookings.listByEvent(original.eventId);
    if (history.some((b) => b.amendsBookingId === original.id && isHoldingDbStatus(b.status))) throw bookingError("REPLACEMENT_PENDING");
    return { original, history };
  }

  /**
   * 107-S1: the active venues free for the original's period (setup and turnaround and blocks included, by available_venues) that
   * hold at least its own expected attendance. Never the original's venue, a venue this event already holds for an overlapping
   * period (DUPLICATE_VENUE) or one where it has a rejected request for the same period (REPEAT_OF_REJECTED). By name.
   */
  async candidates(caller: Caller, id: string): Promise<ReplacementCandidateDto[]> {
    const { original, history } = await this.loadFlagged(caller, id);
    const { search, venues } = this.deps;

    const [freeIds, active] = await Promise.all([search.availableVenueIds(original.start, original.end), search.activeVenues()]);
    const free = new Set(freeIds);
    const attendance = original.snapshot.expectedAttendance;

    const maybe = active.filter((v) => free.has(v.id) && v.id !== original.venueId && (attendance === null || v.maxCapacity >= attendance));
    const timings = new Map((await venues.getByIds(maybe.map((v) => v.id))).map((v) => [v.id, v]));

    return maybe
      .filter((v) => {
        const timing = timings.get(v.id) ?? { setupMinutes: 0, turnaroundMinutes: 0 };
        const padded = paddedPeriod(original, timing);
        const held = history.some((b) => b.venueId === v.id && isHoldingDbStatus(b.status) && periodsOverlap(paddedPeriod(b, timing), padded));
        const rejected = history.some(
          (b) => b.venueId === v.id && b.status === "rejected" && b.start.getTime() === original.start.getTime() && b.end.getTime() === original.end.getTime(),
        );
        return !held && !rejected;
      })
      .map((v) => ({ venueId: v.id, name: v.name, address: v.address, maxCapacity: v.maxCapacity }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * 107-S2: a PENDING request for the chosen venue with every other field the original's, linked to it. `overrideReason` is the
   * replacement's own (an unsuitable venue needs it; the original's result is not inherited). The original is not written.
   */
  async replace(caller: Caller, id: string, body: unknown): Promise<SubmittedBooking> {
    const { original } = await this.loadFlagged(caller, id);
    const fields = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    if (typeof fields.venueId !== "string" || fields.venueId === "") throw validationFailed({ venueId: "Choose a venue." });

    const start = utcToSgt(original.start);
    const request = {
      eventId: original.eventId,
      venueId: fields.venueId,
      date: start.date,
      startTime: start.time,
      endTime: utcToSgt(original.end).time,
      ...(original.snapshot.expectedAttendance !== null ? { expectedAttendance: original.snapshot.expectedAttendance } : {}),
      ...(original.snapshot.venueRequirements !== null ? { venueRequirements: original.snapshot.venueRequirements } : {}),
      ...("overrideReason" in fields ? { overrideReason: fields.overrideReason } : {}),
    };
    try {
      return await this.bookingService.submit(caller, request, { replacesBookingId: original.id });
    } catch (error) {
      // two requests at the same instant: the database's one-active-replacement index settles it (107-S5)
      if (error instanceof BookingError && error.code === "ACTIVE_REQUEST_EXISTS") throw bookingError("REPLACEMENT_PENDING");
      throw error;
    }
  }
}
