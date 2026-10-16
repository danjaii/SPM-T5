import type { Role } from "@spm-t5/shared";
import type { RoleReader } from "../../src/readers/roleReader";
import type { VenueInfo, VenueReader } from "../../src/readers/venueReader";

export class FakeVenueReader implements VenueReader {
  constructor(
    readonly venues: VenueInfo[] = [],
    private readonly layouts: Record<string, string> = {},
  ) {}

  async getById(venueId: string) {
    return this.venues.find((v) => v.id === venueId) ?? null;
  }

  async getByIds(venueIds: string[]) {
    return this.venues.filter((v) => venueIds.includes(v.id));
  }

  async layoutNames(layoutIds: string[]) {
    return new Map(layoutIds.flatMap((id) => (this.layouts[id] ? [[id, this.layouts[id]] as [string, string]] : [])));
  }
}

export const aVenue = (overrides: Partial<VenueInfo> = {}): VenueInfo => ({
  id: "venue-1",
  name: "Orchid Hall",
  maxCapacity: 150,
  isActive: true,
  setupMinutes: 0,
  turnaroundMinutes: 0,
  ...overrides,
});

export class FakeRoleReader implements RoleReader {
  constructor(private readonly roles: Record<string, Role>) {}

  async roleOf(userId: string) {
    return this.roles[userId];
  }
}
