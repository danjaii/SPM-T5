import { ROLES, type Role } from "@spm-t5/shared";
import type { EquipmentInfo, EquipmentReader } from "../../src/readers/equipmentReader";
import type { EventInfo, EventReader } from "../../src/readers/eventReader";
import type { ReservationInfo, ReservationReader } from "../../src/readers/reservationReader";
import type { EquipmentRequestInfo, EquipmentRequestReader } from "../../src/readers/equipmentRequestReader";
import type { RoleReader } from "../../src/readers/roleReader";
import type { VenueBookingInfo, VenueBookingReader } from "../../src/readers/venueBookingReader";
import type { EquipmentRequestWriter, NewEquipmentRequest } from "../../src/writers/equipmentRequestWriter";
import type { NewReservation, ReservationWriter, ReserveOutcome } from "../../src/writers/reservationWriter";
import type { SupabaseDeps } from "../../src/supabase";

// ----------------------------------------------------------------------------
// Fake data for SCRUM-18: stands in for Supabase, so tests describe the data, not the database.
// ----------------------------------------------------------------------------

/** One catalogue item. Defaults to 10 working Projector Units, of type "AV". */
export const anEquipment = (overrides: Partial<EquipmentInfo> = {}): EquipmentInfo => ({
  id: "eq-projector",
  name: "Projector Unit",
  type: "AV",
  totalQuantity: 10,
  operationalStatus: "available",
  ...overrides,
});

export class FakeEquipmentReader implements EquipmentReader {
  constructor(private readonly items: EquipmentInfo[] = []) {}

  async list() {
    return [...this.items];
  }
}

/** One reservation. Defaults to 4 approved Projector Units, 15 Oct 2026, 09:00 to 17:00 Singapore time. */
export const aReservation = (overrides: Partial<ReservationInfo> = {}): ReservationInfo => ({
  equipmentId: "eq-projector",
  start: new Date("2026-10-15T01:00:00Z"),
  end: new Date("2026-10-15T09:00:00Z"),
  status: "approved",
  quantityRequested: 4,
  quantityReserved: null,
  ...overrides,
});

/** Applies the same overlap rule as the real query (half-open periods). */
export class FakeReservationReader implements ReservationReader {
  constructor(private readonly items: ReservationInfo[] = []) {}

  async overlapping(equipmentId: string, start: Date, end: Date) {
    return this.items.filter(
      (r) => r.equipmentId === equipmentId && r.start.getTime() < end.getTime() && start.getTime() < r.end.getTime(),
    );
  }
}

export class FakeRoleReader implements RoleReader {
  constructor(private readonly roles: Record<string, Role>) {}

  async roleOf(userId: string) {
    return this.roles[userId];
  }
}

/** A session cookie `tok-<userId>` belongs to `<userId>`; anything else is not signed in. */
export const fakeDeps = {
  anon: {
    auth: { getUser: async (t: string) => ({ data: { user: t.startsWith("tok-") ? { id: t.slice(4) } : null } }) },
  },
  forUser: () => {
    throw new Error("ports are faked");
  },
} as unknown as SupabaseDeps;

/**
 * tech-1 is the Technical Support Staff member most tests ask as. On top of that there is one user per role in
 * the shared ROLES list, called "<role>-user" (e.g. "venue_staff-user"), so a role added to ROLES later (such as
 * the Week 7 Event Coordinator Lead or Safety Officer) automatically gets a pretend user too.
 */
export const fakeRoles = () =>
  new FakeRoleReader({
    "tech-1": "technical_support_staff",
    // SCRUM-86: coord-1 is the default event's assigned coordinator; coord-2 is another coordinator.
    "coord-1": "event_coordinator",
    "coord-2": "event_coordinator",
    ...Object.fromEntries(ROLES.map((role) => [`${role}-user`, role])),
  });

// end of fake data

// ----------------------------------------------------------------------------
// Fake reservation writer for SCRUM-19: records every reservation it is asked to save, and answers with a set
// outcome. The real writer (a database function, migration 12) is tested against a real database in CI.
// ----------------------------------------------------------------------------

export class FakeReservationWriter implements ReservationWriter {
  /** Every reservation that was accepted and saved, in order. */
  readonly saved: NewReservation[] = [];

  /**
   * `stored` is an optional shared list of reservations. Give the same list to the FakeReservationReader and an
   * accepted reservation shows up in availability checks afterwards, as it does in the real database.
   */
  constructor(
    private readonly outcome: ReserveOutcome = { ok: true, id: "res-1", availableAfter: 6 },
    private readonly stored?: ReservationInfo[],
  ) {}

  async reserve(reservation: NewReservation): Promise<ReserveOutcome> {
    // Only a reservation the writer accepts is saved; a refused one leaves nothing behind.
    if (this.outcome.ok) {
      this.saved.push(reservation);
      // A new reservation starts as "reserved", for the quantity asked for.
      this.stored?.push({
        equipmentId: reservation.equipmentId,
        start: reservation.start,
        end: reservation.end,
        status: "reserved",
        quantityRequested: reservation.quantity,
        quantityReserved: reservation.quantity,
      });
    }
    return this.outcome;
  }
}

// end of fake reservation writer

// ----------------------------------------------------------------------------
// Fake events for SCRUM-19: the events a reservation can be made for.
// ----------------------------------------------------------------------------

/** One event. Defaults to the approved "DevOps Summit" (id "evt-devops"), 15 Oct 2026, 09:00 to 17:00 Singapore time. */
export const anEvent = (overrides: Partial<EventInfo> = {}): EventInfo => ({
  id: "evt-devops",
  name: "DevOps Summit",
  status: "approved",
  start: new Date("2026-10-15T01:00:00Z"),
  end: new Date("2026-10-15T09:00:00Z"),
  coordinatorName: "Dana Lim",
  assignedCoordinatorId: "coord-1",
  ...overrides,
});

export class FakeEventReader implements EventReader {
  constructor(private readonly items: EventInfo[] = []) {}

  async find(id: string) {
    return this.items.find((e) => e.id === id);
  }

  async list() {
    return [...this.items];
  }
}

// end of fake events

// ----------------------------------------------------------------------------
// Fakes for SCRUM-86 equipment requests: the event's venue bookings, its requests, and a writer that records what
// it saves. The real ones (migration 25's insert policy) are tested against a real database in CI.
// ----------------------------------------------------------------------------

/** One venue booking. Defaults to the approved Grand Hall booking for "evt-devops", 15 Oct 2026, 09:00 to 17:00 SGT. */
export const aVenueBooking = (overrides: Partial<VenueBookingInfo> = {}): VenueBookingInfo => ({
  id: "vb-hall",
  eventId: "evt-devops",
  venueName: "Grand Hall",
  status: "approved",
  start: new Date("2026-10-15T01:00:00Z"),
  end: new Date("2026-10-15T09:00:00Z"),
  ...overrides,
});

export class FakeVenueBookingReader implements VenueBookingReader {
  constructor(private readonly items: VenueBookingInfo[] = []) {}

  async forEvent(eventId: string) {
    return this.items.filter((b) => b.eventId === eventId);
  }
}

/** One saved request. Defaults to 2 Projector Units for "evt-devops" in the Grand Hall, Submitted. */
export const anEquipmentRequest = (overrides: Partial<EquipmentRequestInfo> = {}): EquipmentRequestInfo => ({
  id: "req-1",
  eventId: "evt-devops",
  equipmentName: "Projector Unit",
  equipmentType: "AV",
  quantity: 2,
  venueName: "Grand Hall",
  venueBookingId: "vb-hall",
  notes: null,
  status: "requested",
  venueBookingCancellationReason: null,
  createdAt: new Date("2026-10-01T01:00:00Z"),
  ...overrides,
});

export class FakeEquipmentRequestReader implements EquipmentRequestReader {
  constructor(private readonly items: EquipmentRequestInfo[] = []) {}

  async forEvent(eventId: string) {
    return this.items.filter((r) => r.eventId === eventId);
  }
}

/** Records every request it is asked to save, and answers with ids "req-new-1", "req-new-2", ... */
export class FakeEquipmentRequestWriter implements EquipmentRequestWriter {
  readonly saved: NewEquipmentRequest[] = [];

  async create(request: NewEquipmentRequest) {
    this.saved.push(request);
    return { id: `req-new-${this.saved.length}` };
  }
}

/** The SCRUM-86 ports with nothing in them, for test setups that do not use requests. */
export const noRequestPorts = () => ({
  venueBookings: new FakeVenueBookingReader(),
  requests: new FakeEquipmentRequestReader(),
  requestWriter: new FakeEquipmentRequestWriter(),
});

// end of SCRUM-86 fakes
