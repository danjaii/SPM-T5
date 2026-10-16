import { layoutIdsIn } from "@spm-t5/shared";
import { forbidden, notFound } from "../domain/errors";
import { toQueueDetail, toQueueItem, type QueueDetail, type QueueItem } from "../domain/queueDto";
import type { BookingRecord } from "../domain/types";
import type { UserReader } from "../readers/userReader";
import type { VenueReader } from "../readers/venueReader";
import type { BookingRepository } from "../repositories/bookingRepository";
import type { Caller } from "./bookingService";

export interface QueueDeps {
  bookings: BookingRepository;
  venues: VenueReader;
  users: UserReader;
}

/** SCRUM-37: Venue Staff review the pending requests, oldest first, with the event details attached. */
export class QueueService {
  constructor(private readonly deps: QueueDeps) {}

  private requireVenueStaff(caller: Caller) {
    if (caller.role !== "venue_staff") throw forbidden();
  }

  private async venueNames(bookings: BookingRecord[]): Promise<Map<string, string>> {
    const venues = await this.deps.venues.getByIds([...new Set(bookings.map((b) => b.venueId))]);
    return new Map(venues.map((v) => [v.id, v.name]));
  }

  /** SCRUM-113: the names of the room layouts that sent-back notes mention. */
  private layoutNames(bookings: BookingRecord[]): Promise<Map<string, string>> {
    return this.deps.venues.layoutNames([...new Set(bookings.flatMap((b) => layoutIdsIn(b.sentBackChanges)))]);
  }

  /** 37-S1 to S5: every PENDING request for every venue (DR14), earliest submission first. */
  async list(caller: Caller): Promise<QueueItem[]> {
    this.requireVenueStaff(caller);
    const pending = await this.deps.bookings.listPending();
    const venues = await this.venueNames(pending);
    const people = await this.deps.users.namesOf([...new Set(pending.flatMap((b) => (b.requestedBy ? [b.requestedBy] : [])))]);
    const layouts = await this.layoutNames(pending);
    return pending.map((b) =>
      toQueueItem(b, venues.get(b.venueId) ?? "Unknown venue", (b.requestedBy && people.get(b.requestedBy)) || null, layouts),
    );
  }

  /** 37-S6: one request in any status, with who decided it and when. */
  async detail(caller: Caller, id: string): Promise<QueueDetail> {
    this.requireVenueStaff(caller);
    const booking = await this.deps.bookings.getById(id);
    if (!booking) throw notFound("Venue booking request not found.");
    const venues = await this.venueNames([booking]);
    const ids = [booking.requestedBy, booking.reviewedBy].filter((x): x is string => Boolean(x));
    const people = await this.deps.users.namesOf(ids);
    return toQueueDetail(booking, venues.get(booking.venueId) ?? "Unknown venue", people, await this.layoutNames([booking]));
  }
}
