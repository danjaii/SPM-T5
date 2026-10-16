import { forbidden, notFound } from "../domain/errors";
import {
  rejectionReasonOf,
  toBookingListItem,
  type BookingDetail,
  type BookingListItem,
  type ChainItem,
  type EventBookingItem,
} from "../domain/dto";
import type { BookingRecord } from "../domain/types";
import { exceedsCapacity, utcToSgt } from "@spm-t5/shared";
import type { EventReader } from "../readers/eventReader";
import type { VenueReader } from "../readers/venueReader";
import type { BookingRepository } from "../repositories/bookingRepository";
import type { Caller } from "./bookingService";

export interface TrackingDeps {
  bookings: BookingRepository;
  events: EventReader;
  venues: VenueReader;
}

/** The request and every request linked to it by amendment, root first (33-S5). */
export function amendmentChain(target: BookingRecord, sameEvent: BookingRecord[]): BookingRecord[] {
  const byId = new Map(sameEvent.map((b) => [b.id, b]));
  const chain: BookingRecord[] = [];
  const seen = new Set<string>();
  // Walk back to the root...
  let root = target;
  while (root.amendsBookingId && byId.has(root.amendsBookingId) && !seen.has(root.id)) {
    seen.add(root.id);
    root = byId.get(root.amendsBookingId)!;
  }
  // ...then collect the descendants in submission order.
  const ids = new Set([root.id]);
  chain.push(root);
  for (const b of [...sameEvent].sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())) {
    if (b.amendsBookingId && ids.has(b.amendsBookingId) && !ids.has(b.id)) {
      ids.add(b.id);
      chain.push(b);
    }
  }
  return chain;
}

/** SCRUM-33: a Coordinator follows the outcome of requests for the events assigned to them. */
export class TrackingService {
  constructor(private readonly deps: TrackingDeps) {}

  private requireCoordinator(caller: Caller) {
    if (caller.role !== "event_coordinator") throw forbidden();
  }

  private async venueNames(bookings: BookingRecord[]): Promise<Map<string, string>> {
    const ids = new Set<string>();
    for (const b of bookings) {
      ids.add(b.venueId);
      if (b.suggestion) ids.add(b.suggestion.venueId);
    }
    const venues = await this.deps.venues.getByIds([...ids]);
    return new Map(venues.map((v) => [v.id, v.name]));
  }

  /** 33-S1, S3, S4: my events' requests, newest first. Cancelled ones are listed too (102-S25). */
  async list(caller: Caller): Promise<BookingListItem[]> {
    this.requireCoordinator(caller);
    const eventIds = await this.deps.events.listIdsAssignedTo(caller.id);
    const bookings = await this.deps.bookings.listByEvents(eventIds);
    const names = await this.venueNames(bookings);
    return bookings.map((b) => toBookingListItem(b, names.get(b.venueId) ?? "Unknown venue"));
  }

  /**
   * SCRUM-98/AC5 (98-S21 to S23): every booking of one event, earliest start first (then the one requested first),
   * including rejected and withdrawn ones. Only the event's assigned Coordinator may see them (98-S27, 98-S28).
   */
  async forEvent(caller: Caller, eventId: string): Promise<EventBookingItem[]> {
    this.requireCoordinator(caller);
    const event = await this.deps.events.getById(eventId);
    if (!event) throw notFound("Event not found.");
    if (event.assignedCoordinatorId !== caller.id) throw forbidden();

    // 102-S25: cancelled ones are listed too, with their reason
    const bookings = (await this.deps.bookings.listByEvent(eventId)).sort((a, b) => a.start.getTime() - b.start.getTime() || a.createdAt.getTime() - b.createdAt.getTime());
    const venues = new Map((await this.deps.venues.getByIds([...new Set(bookings.map((b) => b.venueId))])).map((v) => [v.id, v]));

    return bookings.map((b) => {
      const venue = venues.get(b.venueId);
      return {
        ...toBookingListItem(b, venue?.name ?? "Unknown venue"),
        expectedAttendance: b.snapshot.expectedAttendance,
        venueRequirements: b.snapshot.venueRequirements,
        rejectionReason: rejectionReasonOf(b),
        cancellationReason: b.cancellationReason, // only a cancelled one has a reason
        exceedsCapacity: exceedsCapacity(b.snapshot.expectedAttendance, venue?.maxCapacity),
        sentBackForReview: b.sentBackAt !== null,
      };
    });
  }

  /** 33-S2, S5: one request with its reason, suggestion and amendment chain. */
  async detail(caller: Caller, id: string): Promise<BookingDetail> {
    this.requireCoordinator(caller);
    const booking = await this.deps.bookings.getById(id);
    if (!booking) throw notFound("Venue booking request not found.");
    const event = await this.deps.events.getById(booking.eventId);
    if (!event || event.assignedCoordinatorId !== caller.id) throw forbidden();

    const chain = amendmentChain(booking, await this.deps.bookings.listByEvent(booking.eventId));
    const names = await this.venueNames([booking, ...chain]);
    const nameOf = (venueId: string) => names.get(venueId) ?? "Unknown venue";
    const item = (b: BookingRecord) => toBookingListItem(b, nameOf(b.venueId));
    const chainItems: ChainItem[] = chain.map((b) => ({ ...item(b), rejectionReason: rejectionReasonOf(b) }));

    const s = booking.suggestion;
    return {
      ...item(booking),
      expectedAttendance: booking.snapshot.expectedAttendance,
      venueRequirements: booking.snapshot.venueRequirements,
      accessibilityNeeds: booking.snapshot.accessibilityNeeds,
      submittedBy: booking.requestedBy,
      rejectionReason: rejectionReasonOf(booking),
      suggestion: s
        ? {
            venueId: s.venueId,
            venueName: nameOf(s.venueId),
            date: utcToSgt(s.start).date,
            startTime: utcToSgt(s.start).time,
            endTime: utcToSgt(s.end).time,
          }
        : null,
      amendsRequestId: booking.amendsBookingId,
      chain: chainItems,
    };
  }
}
