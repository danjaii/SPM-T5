import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { SearchableVenue, SearchOptions, VenueSearchReader } from "../../src/readers/venueSearchReader";
import type { SupabaseDeps } from "../../src/supabase";

// ---------------------------------------------------------------------------
// Fakes: sign-in (users table) and the search reader, so tests never touch the real database
// ---------------------------------------------------------------------------
const NOW = new Date("2026-10-06T01:00:00Z"); // 09:00 Singapore time

function fakeDeps() {
  const sessions = new Map<string, string>();
  const roles = new Map<string, string>();
  const deps = {
    anon: {
      auth: {
        getUser: async (token: string) => {
          const id = sessions.get(token);
          return id ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: "bad token" } };
        },
      },
    },
    // the role lookup the catalogue guard makes as the caller
    forUser: (token: string) => ({
      from: () => {
        const b = {
          select: () => b,
          eq: () => b,
          maybeSingle: async () => ({ data: { role: roles.get(sessions.get(token) as string) }, error: null }),
        };
        return b;
      },
    }),
  } as unknown as SupabaseDeps;
  const signIn = (role: string) => {
    const id = crypto.randomUUID();
    roles.set(id, role);
    sessions.set(`token-${id}`, id);
    return `cs_session=token-${id}`;
  };
  return { deps, signIn };
}

class FakeSearchReader implements VenueSearchReader {
  calls: { start: Date; end: Date }[] = [];
  constructor(private readonly venues: SearchableVenue[], private readonly free: string[] = venues.map((v) => v.id)) {}
  async availableVenueIds(start: Date, end: Date) {
    this.calls.push({ start, end });
    return this.free;
  }
  async activeVenues() {
    return this.venues;
  }
  async options(): Promise<SearchOptions> {
    return { layouts: [{ id: "theatre", name: "Theatre" }], facilities: [{ id: "projector", name: "Projector" }] };
  }
}

const venue = (over: Partial<SearchableVenue> & { id: string }): SearchableVenue => ({
  name: over.id,
  address: "1 Orchard Road",
  maxCapacity: 100,
  isAccessible: false,
  accessibilityNotes: null,
  layouts: [],
  facilities: [],
  ...over,
});

function setup(venues: SearchableVenue[], free?: string[]) {
  const { deps, signIn } = fakeDeps();
  const reader = new FakeSearchReader(venues, free);
  const app = createApp(deps, { now: () => NOW, venueSearch: () => reader });
  const search = (qs: string, role = "event_coordinator") =>
    request(app).get(`/venues/search?${qs}`).set("Cookie", signIn(role));
  return { app, reader, search, signIn };
}

const SLOT = "date=2026-10-15&startTime=09:00&endTime=17:00";
const ids = (res: request.Response) => res.body.venues.map((v: { id: string }) => v.id);

// ---------------------------------------------------------------------------
// SCRUM-65 Search for suitable venues
// ---------------------------------------------------------------------------
describe("SCRUM-65/AC1 only venues available for the period", () => {
  it("65-S1 returns venues the database says are free, and asks about the Singapore period in UTC", async () => {
    const { search, reader } = setup([venue({ id: "free" }), venue({ id: "held" })], ["free"]);
    const res = await search(SLOT);
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual(["free"]);
    expect(reader.calls[0].start).toEqual(new Date("2026-10-15T01:00:00Z"));
    expect(reader.calls[0].end).toEqual(new Date("2026-10-15T09:00:00Z"));
  });

  it("65-S10 needs a signed-in coordinator or venue staff: 401 without a session, 403 for an organiser", async () => {
    const { app, search } = setup([venue({ id: "a" })]);
    expect((await request(app).get(`/venues/search?${SLOT}`)).status).toBe(401);
    expect((await search(SLOT, "event_organiser")).status).toBe(403);
    expect((await search(SLOT, "venue_staff")).status).toBe(200);
  });

  it("65-S11 /venues/search is not read as a venue id", async () => {
    const { search } = setup([venue({ id: "a" })]);
    const res = await search(SLOT);
    expect(res.body).toHaveProperty("venues");
  });
});

describe("SCRUM-65/AC2 every specified criterion must be met", () => {
  const venues = [
    venue({ id: "all", address: "1 Orchard Road", isAccessible: true, layouts: [{ id: "theatre", name: "Theatre", maxCapacity: 80 }], facilities: [{ id: "projector", name: "Projector" }, { id: "mic", name: "Mic" }] }),
    venue({ id: "no-access", address: "1 Orchard Road", layouts: [{ id: "theatre", name: "Theatre", maxCapacity: 80 }], facilities: [{ id: "projector", name: "Projector" }, { id: "mic", name: "Mic" }] }),
    venue({ id: "one-facility", address: "1 Orchard Road", isAccessible: true, layouts: [{ id: "theatre", name: "Theatre", maxCapacity: 80 }], facilities: [{ id: "projector", name: "Projector" }] }),
    venue({ id: "elsewhere", address: "9 Bugis Street", isAccessible: true, layouts: [{ id: "theatre", name: "Theatre", maxCapacity: 80 }], facilities: [{ id: "projector", name: "Projector" }, { id: "mic", name: "Mic" }] }),
    venue({ id: "other-layout", address: "1 Orchard Road", isAccessible: true, layouts: [{ id: "classroom", name: "Classroom", maxCapacity: 80 }], facilities: [{ id: "projector", name: "Projector" }, { id: "mic", name: "Mic" }] }),
  ];

  it("65-S2 combines location, layout, accessibility and all facilities", async () => {
    const { search } = setup(venues);
    const res = await search(`${SLOT}&location=orchard&layoutId=theatre&accessible=true&facilityIds=projector,mic`);
    expect(ids(res)).toEqual(["all"]);
  });

  it("65-S3 each filter on its own narrows the list", async () => {
    const { search } = setup(venues);
    expect(ids(await search(`${SLOT}&location=BUGIS`))).toEqual(["elsewhere"]);
    expect(ids(await search(`${SLOT}&layoutId=classroom`))).toEqual(["other-layout"]);
    expect(ids(await search(`${SLOT}&accessible=true`))).toEqual(["all", "one-facility", "elsewhere", "other-layout"]);
    expect(ids(await search(`${SLOT}&facilityIds=mic`))).toEqual(["all", "no-access", "elsewhere", "other-layout"]);
  });

  it("65-S4 with no filters every free venue is returned", async () => {
    const { search } = setup(venues);
    expect(ids(await search(SLOT))).toHaveLength(5);
  });
});

describe("SCRUM-65/AC3 capacity at least the expected attendance", () => {
  const venues = [
    venue({ id: "small", maxCapacity: 50 }),
    venue({ id: "exact", maxCapacity: 100 }),
    venue({ id: "big", maxCapacity: 300, layouts: [{ id: "banquet", name: "Banquet", maxCapacity: 90 }] }),
  ];

  it("65-S5 keeps venues with capacity >= attendance (equal counts)", async () => {
    const { search } = setup(venues);
    expect(ids(await search(`${SLOT}&attendance=100`))).toEqual(["exact", "big"]);
  });

  it("65-S6 with a layout chosen, that layout's own capacity is what counts", async () => {
    const { search } = setup(venues);
    expect(ids(await search(`${SLOT}&attendance=100&layoutId=banquet`))).toEqual([]);
    expect(ids(await search(`${SLOT}&attendance=90&layoutId=banquet`))).toEqual(["big"]);
  });
});

describe("SCRUM-65/AC4 missing date or time", () => {
  it("65-S7 answers 422 with a prompt for each missing field", async () => {
    const { search } = setup([]);
    const res = await search("");
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { date: "Please enter a date.", startTime: "Please enter a start time.", endTime: "Please enter an end time." },
    });
  });
});

describe("SCRUM-65/AC5 past dates", () => {
  it("65-S8 answers 422 for yesterday and does not query venues", async () => {
    const { search, reader } = setup([venue({ id: "a" })]);
    const res = await search("date=2026-10-05&startTime=09:00&endTime=17:00");
    expect(res.status).toBe(422);
    expect(res.body.fieldErrors.date).toBe("The date must not be in the past.");
    expect(reader.calls).toHaveLength(0);
  });
});

describe("SCRUM-65/AC6 end before start", () => {
  it("65-S9 answers 422 for an end time before the start time", async () => {
    const { search } = setup([venue({ id: "a" })]);
    const res = await search("date=2026-10-15&startTime=17:00&endTime=09:00");
    expect(res.status).toBe(422);
    expect(res.body.fieldErrors.endTime).toBe("The end time must be after the start time.");
  });
});

describe("SCRUM-65/AC7 each result shows its details", () => {
  it("65-S12 returns name, location, capacity, accessibility, layouts and facilities", async () => {
    const { search } = setup([
      venue({
        id: "v1", name: "Orchid Hall", address: "1 Orchard Road", maxCapacity: 150, isAccessible: true, accessibilityNotes: "Step-free entrance",
        layouts: [{ id: "theatre", name: "Theatre", maxCapacity: 120 }], facilities: [{ id: "projector", name: "Projector" }],
      }),
    ]);
    const res = await search(SLOT);
    expect(res.body.venues).toEqual([
      {
        id: "v1", name: "Orchid Hall", address: "1 Orchard Road", max_capacity: 150, is_accessible: true, accessibility_notes: "Step-free entrance",
        layouts: [{ id: "theatre", name: "Theatre", max_capacity: 120 }], facilities: [{ id: "projector", name: "Projector" }],
      },
    ]);
  });

  it("65-S13 GET /venues/search-options lists the layouts and facilities to choose from", async () => {
    const { app, signIn } = setup([]);
    const res = await request(app).get("/venues/search-options").set("Cookie", signIn("event_coordinator"));
    expect(res.body).toEqual({
      layouts: [{ id: "theatre", name: "Theatre" }],
      facilities: [{ id: "projector", name: "Projector" }],
    });
  });
});

describe("SCRUM-65/AC8 no match", () => {
  it("65-S14 returns an empty list (the page says no suitable venues were found)", async () => {
    const { search } = setup([venue({ id: "a", maxCapacity: 10 })]);
    const res = await search(`${SLOT}&attendance=500`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ venues: [] });
  });
});
