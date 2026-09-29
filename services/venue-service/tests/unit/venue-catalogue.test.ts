import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";

// ---------------------------------------------------------------------------
// Fake Supabase (in memory) so tests never touch the real database
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;

function createFake() {
  const sessions = new Map<string, string>(); // login token -> user id
  const tables: Record<string, Row[]> = { users: [], venues: [] };

  const query = (table: string) => {
    const filters: [string, unknown][] = [];
    // copies, like a real database sends
    const run = () => tables[table].filter((r) => filters.every(([col, val]) => r[col] === val)).map((r) => ({ ...r }));
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => { filters.push([col, val]); return builder; },
      order: () => builder,
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      // awaiting the query without maybeSingle() gives every matching row
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve({ data: run(), error: null }).then(resolve, reject),
    };
    return builder;
  };

  const deps = {
    anon: {
      auth: {
        getUser: async (token: string) => {
          const id = sessions.get(token);
          return id ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: "bad token" } };
        },
      },
    },
    forUser: () => ({ from: (table: string) => query(table) }),
  } as unknown as SupabaseDeps;

  /** Pretends a user with this role is logged in; returns the cookie their browser would send. */
  const signIn = (role: string) => {
    const id = crypto.randomUUID();
    tables.users.push({ id, role, full_name: "Test User", is_active: true });
    sessions.set(`token-${id}`, id);
    return { id, cookie: `cs_session=token-${id}` };
  };

  return { deps, tables, signIn };
}
// end of fake Supabase

// ---------------------------------------------------------------------------
// SCRUM-29 — Browse the venue catalogue
// ---------------------------------------------------------------------------
describe("SCRUM-29 — Browse the venue catalogue", () => {
  // AC1 (Scenario 1): each venue is listed with its name, location and maximum capacity
  // check if we can fetch venues 
  it("lists every venue with its name, location and maximum capacity", async () => {
    const fake = createFake();
    const coordinator = fake.signIn("event_coordinator");
    fake.tables.venues.push(
      { id: "v1", name: "Marina Bayview Hall A", address: "10 Bayfront Ave", max_capacity: 300, description: "Ballroom" },
      { id: "v2", name: "Orchard Suite 1", address: "391A Orchard Road", max_capacity: 40, description: "Boardroom" },
    );

    const res = await request(createApp(fake.deps)).get("/venues").set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: "v1", name: "Marina Bayview Hall A", address: "10 Bayfront Ave", max_capacity: 300 },
      { id: "v2", name: "Orchard Suite 1", address: "391A Orchard Road", max_capacity: 40 },
    ]);
  });
  // end of AC1

  // AC2 (Scenario 2): the detail view shows all of a venue's characteristics
  // ask for one venue, and check if we can get a 200 response and includes all characteristics such as capacity, location, layouts etc
  it("shows a venue's capacity, location, layouts, accessibility and facilities", async () => {
    const fake = createFake();
    const coordinator = fake.signIn("event_coordinator");
    // Stored the way Supabase returns a venue fetched together with its layouts and facilities (nested)
    fake.tables.venues.push({
      id: "orchid",
      name: "Orchid Hall",
      address: "Level 3, East Wing",
      max_capacity: 150,
      is_accessible: true,
      accessibility_notes: "Step-free access, Hearing loop",
      venue_supported_layouts: [
        { max_capacity_for_layout: 150, room_layouts: { name: "Theatre" } },
        { max_capacity_for_layout: 80, room_layouts: { name: "Classroom" } },
        { max_capacity_for_layout: 100, room_layouts: { name: "Banquet" } },
      ],
      venue_facilities: [
        { facilities: { name: "Projector" } },
        { facilities: { name: "PA system" } },
        { facilities: { name: "Video conferencing" } },
      ],
    });

    const res = await request(createApp(fake.deps)).get("/venues/orchid").set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: "Orchid Hall",
      max_capacity: 150,
      address: "Level 3, East Wing",
      layouts: [
        { name: "Theatre", max_capacity: 150 },
        { name: "Classroom", max_capacity: 80 },
        { name: "Banquet", max_capacity: 100 },
      ],
      is_accessible: true,
      accessibility_notes: "Step-free access, Hearing loop",
      facilities: ["Projector", "PA system", "Video conferencing"],
    });
  });
  // end of AC2

  // AC3 (Scenario 3): Venue Staff can use the list and detail views too
  // turns green means venus staff can access the data 
  it("gives Venue Staff the same list and detail views", async () => {
    const fake = createFake();
    const venueStaff = fake.signIn("venue_staff");
    fake.tables.venues.push({ id: "v1", name: "Orchid Hall", address: "Level 3, East Wing", max_capacity: 150 });
    const app = createApp(fake.deps);

    const list = await request(app).get("/venues").set("Cookie", venueStaff.cookie);
    const detail = await request(app).get("/venues/v1").set("Cookie", venueStaff.cookie);

    expect(list.status).toBe(200);
    expect(list.body).toEqual([{ id: "v1", name: "Orchid Hall", address: "Level 3, East Wing", max_capacity: 150 }]);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ name: "Orchid Hall", max_capacity: 150 });
  });
  // end of AC3

  // AC4 + AC6 + AC7 (Scenarios 4, 6, 7): organisers, attendees and technical support staff are denied
  // passing this test case means that an attendee, event org and tech support staff are unable to access the venue catalogue information
  it.each(["event_organiser", "attendee", "technical_support_staff"])("refuses a %s with 403", async (role) => {
    const fake = createFake();
    const outsider = fake.signIn(role);
    fake.tables.venues.push({ id: "v1", name: "Orchid Hall", address: "Level 3, East Wing", max_capacity: 150 });
    const app = createApp(fake.deps);

    const list = await request(app).get("/venues").set("Cookie", outsider.cookie);
    const detail = await request(app).get("/venues/v1").set("Cookie", outsider.cookie);

    expect(list.status).toBe(403);
    expect(detail.status).toBe(403);
    expect(list.body).toEqual({ error: "You are not allowed to view the venue catalogue." });
  });
  // end of AC4 + AC6 + AC7

  // AC5 (Scenario 5), backend half: an empty catalogue is an empty list, not an error
  // (the empty-state message itself is shown by the web page)
  it("returns an empty list, not an error, when there are no venues", async () => {
    const fake = createFake();
    const coordinator = fake.signIn("event_coordinator");

    const res = await request(createApp(fake.deps)).get("/venues").set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
  // end of AC5 (backend)
});
// end of SCRUM-29
