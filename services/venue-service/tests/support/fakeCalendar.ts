import type { Role } from "@spm-t5/shared";
import type { CalendarBlock, CalendarBooking, CalendarVenue, VenueCalendarReader } from "../../src/readers/venueCalendarReader";
import type { SupabaseDeps } from "../../src/supabase";

type Row = Record<string, unknown>;

/**
 * SCRUM-84: an in-memory Supabase (sessions and the users table only) and an in-memory VenueCalendarReader.
 * `reads` counts every call to the reader, so a test can prove a refused request read nothing.
 */
export function createFakeSession() {
  const sessions = new Map<string, string>();
  const users: Row[] = [];
  const deps = {
    anon: {
      auth: {
        getUser: async (token: string) => {
          const id = sessions.get(token);
          return id ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: "bad token" } };
        },
      },
    },
    forUser: () => ({
      from: () => {
        const filters: [string, unknown][] = [];
        const run = () => users.filter((r) => filters.every(([c, v]) => r[c] === v));
        const builder = {
          select: () => builder,
          eq: (c: string, v: unknown) => (filters.push([c, v]), builder),
          maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        };
        return builder;
      },
    }),
  } as unknown as SupabaseDeps;
  const signIn = (role: Role) => {
    const id = crypto.randomUUID();
    users.push({ id, role });
    sessions.set(`token-${id}`, id);
    return { cookie: `cs_session=token-${id}` };
  };
  return { deps, signIn };
}

export const aCalendarVenue = (overrides: Partial<CalendarVenue> = {}): CalendarVenue => ({
  id: "orchid",
  name: "Orchid Hall",
  address: "1 Marina Boulevard",
  maxCapacity: 150,
  operatingStart: null,
  operatingEnd: null,
  setupMinutes: 0,
  turnaroundMinutes: 0,
  ...overrides,
});

export class FakeVenueCalendarReader implements VenueCalendarReader {
  reads = 0;
  bookings: CalendarBooking[] = [];
  blocks: CalendarBlock[] = [];
  constructor(public venues: CalendarVenue[] = []) {}

  /** Like the database function: the occupied period is the event plus the venue's CURRENT setup and turnaround. */
  hold(venueId: string, status: CalendarBooking["status"], eventStart: Date, eventEnd: Date) {
    const v = this.venues.find((x) => x.id === venueId)!;
    this.bookings.push({
      venueId,
      status,
      eventStart,
      eventEnd,
      occupiedStart: new Date(eventStart.getTime() - v.setupMinutes * 60_000),
      occupiedEnd: new Date(eventEnd.getTime() + v.turnaroundMinutes * 60_000),
      setupMinutes: v.setupMinutes,
      turnaroundMinutes: v.turnaroundMinutes,
    });
  }

  block(venueId: string, start: Date, end: Date, reason = "maintenance") {
    this.blocks.push({ venueId, start, end, reason });
  }

  async entries(from: Date, to: Date) {
    this.reads += 1;
    return {
      bookings: this.bookings.filter((b) => b.occupiedStart < to && b.occupiedEnd > from),
      blocks: this.blocks.filter((b) => b.start < to && b.end > from),
    };
  }

  async venueList() {
    this.reads += 1;
    return this.venues.filter((v) => v.isActive !== false);
  }
}
