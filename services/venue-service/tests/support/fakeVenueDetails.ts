import type { VenueInfo } from "../../src/readers/venueReader";
import type { VenueDetailsReader } from "../../src/readers/venueDetailsReader";
import type { SearchableVenue } from "../../src/readers/venueSearchReader";

/** An in-memory VenueDetailsReader for unit tests (SCRUM-109). */
export class FakeVenueDetailsReader implements VenueDetailsReader {
  constructor(private readonly venues: SearchableVenue[] = []) {}

  async getById(venueId: string) {
    return this.venues.find((v) => v.id === venueId) ?? null;
  }

  /** Details for plain VenueInfo records: no opening limits, and Theatre, Banquet and Boardroom layouts as big as the venue. */
  static from(venues: { venues: VenueInfo[] }): FakeVenueDetailsReader {
    return new FakeVenueDetailsReader(
      venues.venues.map((v) =>
        aVenueWithDetails({
          id: v.id,
          name: v.name,
          maxCapacity: v.maxCapacity,
          openingTime: null,
          closingTime: null,
          layouts: ["Theatre", "Banquet", "Boardroom"].map((name) => ({ id: `layout-${name}`, name, maxCapacity: v.maxCapacity })),
        }),
      ),
    );
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
