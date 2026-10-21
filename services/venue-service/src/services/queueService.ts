import { layoutIdsIn, type FlagDto } from "@spm-t5/shared";
import { forbidden, notFound } from "../domain/errors";
import { toFlagDto } from "../domain/dto";
import { toQueueDetail, toQueueItem, type QueueDetail, type QueueItem } from "../domain/queueDto";
import type { BookingRecord } from "../domain/types";
import type { UserReader } from "../readers/userReader";
import type { VenueInfo, VenueReader } from "../readers/venueReader";
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

  private async venuesOf(bookings: BookingRecord[]): Promise<Map<string, VenueInfo>> {
    const venues = await this.deps.venues.getByIds([...new Set(bookings.map((b) => b.venueId))]);
    return new Map(venues.map((v) => [v.id, v]));
  }

  /** SCRUM-113: the names of the room layouts that sent-back notes mention. */
  private layoutNames(bookings: BookingRecord[]): Promise<Map<string, string>> {
    return this.deps.venues.layoutNames([...new Set(bookings.flatMap((b) => layoutIdsIn(b.sentBackChanges)))]);
  }

  /**
   * SCRUM-104: the open flags of these bookings for Venue Staff, by booking id. Staff may read every booking, so each flag
   * also carries the other booking's event name (read here from its snapshot, never stored with the flag).
   */
  private async flagDtos(bookings: BookingRecord[]): Promise<Map<string, FlagDto[]>> {
    const flags = await this.deps.bookings.flagsFor(bookings.map((b) => b.id));
    const others = new Map<string, string | null>();
    for (const id of new Set(flags.flatMap((f) => (f.otherBookingId ? [f.otherBookingId] : [])))) {
      others.set(id, (await this.deps.bookings.getById(id))?.snapshot.eventName || null);
    }
    const byBooking = new Map<string, FlagDto[]>();
    for (const f of flags) {
      const dto = toFlagDto(f, { otherEventName: f.otherBookingId ? (others.get(f.otherBookingId) ?? null) : null });
      byBooking.set(f.bookingId, [...(byBooking.get(f.bookingId) ?? []), dto]);
    }
    return byBooking;
  }

  /** 37-S1 to S5: every PENDING request for every venue (DR14), earliest submission first. */
  async list(caller: Caller): Promise<QueueItem[]> {
    this.requireVenueStaff(caller);
    const pending = await this.deps.bookings.listPending();
    const venues = await this.venuesOf(pending);
    const people = await this.deps.users.namesOf([...new Set(pending.flatMap((b) => (b.requestedBy ? [b.requestedBy] : [])))]);
    const flags = await this.flagDtos(pending);
    const layouts = await this.layoutNames(pending);
    return pending.map((b) => {
      const venue = venues.get(b.venueId);
      return toQueueItem(b, venue?.name ?? "Unknown venue", (b.requestedBy && people.get(b.requestedBy)) || null, flags.get(b.id), layouts, venue);
    });
  }

  /** 37-S6: one request in any status, with who decided it and when. */
  async detail(caller: Caller, id: string): Promise<QueueDetail> {
    this.requireVenueStaff(caller);
    const booking = await this.deps.bookings.getById(id);
    if (!booking) throw notFound("Venue booking request not found.");
    const venue = (await this.venuesOf([booking])).get(booking.venueId);
    const ids = [booking.requestedBy, booking.reviewedBy].filter((x): x is string => Boolean(x));
    const people = await this.deps.users.namesOf(ids);
    return toQueueDetail(
      booking,
      venue?.name ?? "Unknown venue",
      people,
      (await this.flagDtos([booking])).get(booking.id),
      await this.layoutNames([booking]),
      venue,
    );
  }
}
