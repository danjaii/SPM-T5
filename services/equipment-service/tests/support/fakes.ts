import { ROLES, type Role } from "@spm-t5/shared";
import type { EquipmentInfo, EquipmentReader } from "../../src/readers/equipmentReader";
import type { ReservationInfo, ReservationReader } from "../../src/readers/reservationReader";
import type { RoleReader } from "../../src/readers/roleReader";
import type { SupabaseDeps } from "../../src/supabase";

// ----------------------------------------------------------------------------
// Fake data for SCRUM-18: stands in for Supabase, so tests describe the data, not the database.
// ----------------------------------------------------------------------------

/** One catalogue item. Defaults to 10 working Projector Units. */
export const anEquipment = (overrides: Partial<EquipmentInfo> = {}): EquipmentInfo => ({
  id: "eq-projector",
  name: "Projector Unit",
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
    ...Object.fromEntries(ROLES.map((role) => [`${role}-user`, role])),
  });

// end of fake data
