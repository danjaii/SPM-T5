import type { VenueDetailsReader } from "../../src/readers/venueDetailsReader";
import type { SearchableVenue } from "../../src/readers/venueSearchReader";

/** An in-memory VenueDetailsReader for unit tests (SCRUM-109). */
export class FakeVenueDetailsReader implements VenueDetailsReader {
  constructor(private readonly venues: SearchableVenue[] = []) {}

  async getById(venueId: string) {
    return this.venues.find((v) => v.id === venueId) ?? null;
  }
}

/** Orchid Hall by default (id "venue-1", the same venue as aVenue()): 200 seats, Theatre and Classroom, open 08:00-22:00. */
export const aVenueWithDetails = (overrides: Partial<SearchableVenue> = {}): SearchableVenue => ({
  id: "venue-1",
  name: "Orchid Hall",
  address: "1 Orchard Road",
  maxCapacity: 200,
  openingTime: "08:00",
  closingTime: "22:00",
  isAccessible: true,
  accessibilityNotes: null,
  layouts: [
    { id: "layout-theatre", name: "Theatre", maxCapacity: 180 },
    { id: "layout-classroom", name: "Classroom", maxCapacity: 100 },
  ],
  facilities: [{ id: "fac-projector", name: "Projector" }],
  ...overrides,
});
