import { isOpenDuring, type VenueSearchInput } from "@spm-t5/shared";
import type { SearchableVenue, VenueSearchReader } from "../readers/venueSearchReader";

/** One search result (SCRUM-65 AC7): name, location, capacity, accessibility, layouts and facilities. */
export interface VenueSearchResult {
  id: string;
  name: string;
  address: string;
  max_capacity: number;
  /** Daily opening and closing time "HH:MM" (Singapore time); null when the venue states no limit. */
  opening_time: string | null;
  closing_time: string | null;
  is_accessible: boolean;
  accessibility_notes: string | null;
  layouts: { id: string; name: string; max_capacity: number }[];
  facilities: { id: string; name: string }[];
}

/**
 * SCRUM-65: venues free for the period (AC1) that also meet every criterion the coordinator set (AC2):
 * capacity (AC3), location, accessibility, layout and every requested facility.
 */
export async function searchVenues(reader: VenueSearchReader, input: VenueSearchInput): Promise<VenueSearchResult[]> {
  const [freeIds, venues] = await Promise.all([reader.availableVenueIds(input.start, input.end), reader.activeVenues()]);
  const free = new Set(freeIds);

  return venues
    .filter((v) => free.has(v.id) && meetsCriteria(v, input))
    .map((v) => ({
      id: v.id,
      name: v.name,
      address: v.address,
      max_capacity: v.maxCapacity,
      opening_time: v.openingTime,
      closing_time: v.closingTime,
      is_accessible: v.isAccessible,
      accessibility_notes: v.accessibilityNotes,
      layouts: v.layouts.map((l) => ({ id: l.id, name: l.name, max_capacity: l.maxCapacity })),
      facilities: v.facilities,
    }));
}

function meetsCriteria(venue: SearchableVenue, input: VenueSearchInput): boolean {
  // AC1: open for the whole period (rule shared with the suitability check, SCRUM-109).
  if (!isOpenDuring(venue.openingTime, venue.closingTime, input.startTime, input.endTime)) return false;

  // AC2: location is a case-insensitive "contains" match on the venue's name or its address.
  const location = input.location?.toLowerCase();
  if (location && !venue.name.toLowerCase().includes(location) && !venue.address.toLowerCase().includes(location)) {
    return false;
  }
  if (input.accessible && !venue.isAccessible) return false;

  // AC2: the venue must support the chosen layout.
  const layout = input.layoutId ? venue.layouts.find((l) => l.id === input.layoutId) : undefined;
  if (input.layoutId && !layout) return false;

  // AC3: capacity must be at least the attendance. With a layout chosen, that layout's own capacity counts.
  if (input.attendance !== undefined) {
    const capacity = layout ? layout.maxCapacity : venue.maxCapacity;
    if (capacity < input.attendance) return false;
  }

  // AC2: every requested facility, not just one of them.
  const have = new Set(venue.facilities.map((f) => f.id));
  return input.facilityIds.every((id) => have.has(id));
}
