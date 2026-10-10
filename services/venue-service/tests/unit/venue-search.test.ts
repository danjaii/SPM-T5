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
  openingTime: null,
  closingTime: null,
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

const SLOT = "startDate=2026-10-15&startTime=09:00&endDate=2026-10-15&endTime=17:00";
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

  it("65-S17 location matches the venue's name as well as its address, ignoring case", async () => {
    const { search } = setup([
      venue({ id: "marina", name: "Marina Bayview Hall A", address: "10 Bayfront Ave, Singapore 018956" }),
      venue({ id: "riverside", name: "Riverside Meeting Room", address: "80 Bras Basah Road" }),
    ]);
    expect(ids(await search(`${SLOT}&location=MARINA`))).toEqual(["marina"]);
    expect(ids(await search(`${SLOT}&location=bras basah`))).toEqual(["riverside"]);
    expect(ids(await search(`${SLOT}&location=nowhere`))).toEqual([]);
  });
});

describe("SCRUM-65/AC1 venues must be open for the period", () => {
  const venues = [
    venue({ id: "no-hours" }),
    venue({ id: "office", openingTime: "08:00", closingTime: "20:00" }),
    venue({ id: "late-opener", openingTime: "10:00", closingTime: "20:00" }),
    venue({ id: "early-closer", openingTime: "08:00", closingTime: "16:00" }),
    venue({ id: "midnight", openingTime: "06:00", closingTime: "00:00" }),
  ];

  it("65-S15 leaves out a venue that opens after the start or closes before the end", async () => {
    const { search } = setup(venues);
    expect(ids(await search(SLOT))).toEqual(["no-hours", "office", "midnight"]);
  });

  it("65-S15 keeps a venue with no stated hours, and treats a 00:00 closing time as midnight", async () => {
    const { search } = setup(venues);
    const late = "startDate=2026-10-15&startTime=19:00&endDate=2026-10-15&endTime=23:30";
    expect(ids(await search(late))).toEqual(["no-hours", "midnight"]);
  });

  it("65-S15 allows a period that ends exactly at closing time and starts exactly at opening", async () => {
    const { search } = setup(venues);
    const exact = "startDate=2026-10-15&startTime=08:00&endDate=2026-10-15&endTime=16:00";
    expect(ids(await search(exact))).toEqual(["no-hours", "office", "early-closer", "midnight"]);
  });

  it("65-S15 shows each venue's opening hours in the result", async () => {
    const { search } = setup([venues[1], venues[0]]);
    const res = await search(SLOT);
    expect(res.body.venues.map((v: { opening_time: string | null; closing_time: string | null }) => [v.opening_time, v.closing_time])).toEqual([
      ["08:00", "20:00"],
      [null, null],
    ]);
  });
});

describe("SCRUM-65/AC1 a period that spans several days", () => {
  it("65-S16 asks the database about the whole Singapore range in UTC", async () => {
    const { search, reader } = setup([venue({ id: "a" })]);
    const res = await search("startDate=2026-10-15&startTime=09:00&endDate=2026-10-17&endTime=17:00");
    expect(res.status).toBe(200);
    expect(reader.calls[0].start).toEqual(new Date("2026-10-15T01:00:00Z"));
    expect(reader.calls[0].end).toEqual(new Date("2026-10-17T09:00:00Z"));
  });

  it("65-S16 accepts an end time earlier than the start time when the end is on a later day", async () => {
    const { search } = setup([venue({ id: "a" })]);
    const res = await search("startDate=2026-10-15&startTime=18:00&endDate=2026-10-16&endTime=09:00");
    expect(res.status).toBe(200);
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
      fieldErrors: {
        startDate: "Please enter a start date.",
        startTime: "Please enter a start time.",
        endDate: "Please enter an end date.",
        endTime: "Please enter an end time.",
      },
    });
  });
});

describe("SCRUM-65/AC5 past dates", () => {
  it("65-S8 answers 422 for yesterday and does not query venues", async () => {
    const { search, reader } = setup([venue({ id: "a" })]);
    const res = await search("startDate=2026-10-05&startTime=09:00&endDate=2026-10-05&endTime=17:00");
    expect(res.status).toBe(422);
    expect(res.body.fieldErrors.startDate).toBe("The start date must not be in the past.");
    expect(reader.calls).toHaveLength(0);
  });
});

describe("SCRUM-65/AC6 end before start", () => {
  it("65-S9 answers 422 for an end time before the start time", async () => {
    const { search } = setup([venue({ id: "a" })]);
    const res = await search("startDate=2026-10-15&startTime=17:00&endDate=2026-10-15&endTime=09:00");
    expect(res.status).toBe(422);
    expect(res.body.fieldErrors.endTime).toBe("The end time must be after the start time.");
  });

  it("65-S9 answers 422 for an end date before the start date", async () => {
    const { search } = setup([venue({ id: "a" })]);
    const res = await search("startDate=2026-10-15&startTime=09:00&endDate=2026-10-14&endTime=17:00");
    expect(res.status).toBe(422);
    expect(res.body.fieldErrors.endDate).toBe("The end date must not be before the start date.");
  });
});

describe("SCRUM-65/AC7 each result shows its details", () => {
  it("65-S12 returns name, location, capacity, accessibility, layouts and facilities", async () => {
    const { search } = setup([
      venue({
        id: "v1", name: "Orchid Hall", address: "1 Orchard Road", maxCapacity: 150, openingTime: "08:00", closingTime: "20:00",
        isAccessible: true, accessibilityNotes: "Step-free entrance",
        layouts: [{ id: "theatre", name: "Theatre", maxCapacity: 120 }], facilities: [{ id: "projector", name: "Projector" }],
      }),
    ]);
    const res = await search(SLOT);
    expect(res.body.venues).toEqual([
      {
        id: "v1", name: "Orchid Hall", address: "1 Orchard Road", max_capacity: 150, opening_time: "08:00", closing_time: "20:00",
        is_accessible: true, accessibility_notes: "Step-free entrance",
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
