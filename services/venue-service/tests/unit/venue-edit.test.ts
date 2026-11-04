import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { BookingAtVenue, VenueInput } from "@spm-t5/shared";
import { createApp } from "../../src/app";
import type { VenueCatalogueWriter } from "../../src/readers/venueCatalogueWriter";
import type { VenueEditReader } from "../../src/readers/venueEditReader";
import type { SupabaseDeps } from "../../src/supabase";

// An in-memory Supabase, as in venue-add.test.ts, so these tests never touch a database.
type Row = Record<string, unknown>;

const THEATRE = "a685c8bf-c57d-5cb4-be30-49dedce9a02b";
const CLASSROOM = "e2feef5a-7c9f-5085-a039-39a50f8d03b7";
const PROJECTOR = "8a02aa6c-e1ae-59e3-9d09-e5704315347d";
const NOW = new Date("2026-11-01T00:00:00Z");

const orchid = (): VenueInput => ({
  name: "Orchid Hall",
  address: "Level 3, 1 Raffles Place",
  description: null,
  maxCapacity: 150,
  operatingHoursStart: "08:00",
  operatingHoursEnd: "22:00",
  isAccessible: true,
  accessibilityNotes: "Step-free entrance.",
  layouts: [{ layoutId: THEATRE, maxCapacity: 150 }],
  facilityIds: [PROJECTOR],
});

const booking = (extra: Partial<BookingAtVenue> = {}): BookingAtVenue => ({
  bookingId: "b1",
  eventName: "Annual Tech Summit",
  eventStart: "2026-11-10T01:00:00Z",
  eventEnd: "2026-11-10T09:00:00Z",
  expectedAttendance: 120,
  status: "approved",
  ...extra,
});

function createFake(bookings: BookingAtVenue[] = []) {
  const sessions = new Map<string, string>();
  const tables: Record<string, Row[]> = { users: [], venues: [], venue_unavailability: [] };
  const stored = new Map<string, VenueInput>([["orchid", orchid()]]);

  const rowOf = (id: string, v: VenueInput): Row => ({
    id,
    name: v.name,
    address: v.address,
    description: v.description,
    max_capacity: v.maxCapacity,
    operating_hours_start: v.operatingHoursStart,
    operating_hours_end: v.operatingHoursEnd,
    is_accessible: v.isAccessible,
    accessibility_notes: v.accessibilityNotes,
    venue_supported_layouts: v.layouts.map((l) => ({ max_capacity_for_layout: l.maxCapacity, room_layouts: { name: l.layoutId === THEATRE ? "Theatre" : "Classroom" } })),
    venue_facilities: v.facilityIds.map(() => ({ facilities: { name: "Projector & Screen" } })),
  });
  tables.venues.push(rowOf("orchid", orchid()));

  const query = (table: string) => {
    const filters: [string, unknown][] = [];
    const run = () => tables[table].filter((r) => filters.every(([col, val]) => r[col] === val)).map((r) => ({ ...r }));
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => { filters.push([col, val]); return builder; },
      order: () => builder,
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
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

  const signIn = (role: string) => {
    const id = crypto.randomUUID();
    tables.users.push({ id, role, full_name: "Test User", is_active: true });
    sessions.set(`token-${id}`, id);
    return { id, cookie: `cs_session=token-${id}` };
  };

  /** A writer that changes the in-memory venue, the way update_venue does in the database. */
  const update = vi.fn(async (venueId: string, input: VenueInput) => {
    stored.set(venueId, input);
    tables.venues.splice(0, tables.venues.length, rowOf(venueId, input));
  });
  const writer: VenueCatalogueWriter = { create: vi.fn(), update };
  const reader: VenueEditReader = {
    forEdit: async (id) => stored.get(id) ?? null,
    bookings: async () => bookings,
  };

  return { deps, tables, signIn, update, options: { venueCatalogue: () => writer, venueEdit: () => reader, now: () => NOW } };
}

const changed = (extra: Record<string, unknown> = {}) => ({
  ...orchid(),
  name: "Orchid Hall East",
  maxCapacity: 200,
  layouts: [
    { layoutId: THEATRE, maxCapacity: 200 },
    { layoutId: CLASSROOM, maxCapacity: 120 },
  ],
  facilityIds: [],
  ...extra,
});

describe("SCRUM-58/AC1 venue staff edit a venue (58-S1)", () => {
  it("58-S1: 200 with the id, and the catalogue and the detail then show the new values", async () => {
    const fake = createFake();
    const staff = fake.signIn("venue_staff");
    const app = createApp(fake.deps, fake.options);

    const put = await request(app).put("/venues/orchid").set("Cookie", staff.cookie).send(changed({ name: "  Orchid Hall East ", maxCapacity: "200" }));

    expect(put.status).toBe(200);
    expect(put.body).toEqual({ id: "orchid" });
    expect(fake.update).toHaveBeenCalledWith("orchid", expect.objectContaining({ name: "Orchid Hall East", maxCapacity: 200, facilityIds: [] }));

    const list = await request(app).get("/venues").set("Cookie", staff.cookie);
    expect(list.body).toEqual([{ id: "orchid", name: "Orchid Hall East", address: "Level 3, 1 Raffles Place", max_capacity: 200 }]);
    const detail = await request(app).get("/venues/orchid").set("Cookie", staff.cookie);
    expect(detail.body).toMatchObject({
      name: "Orchid Hall East",
      max_capacity: 200,
      layouts: [{ name: "Theatre", max_capacity: 200 }, { name: "Classroom", max_capacity: 120 }],
      facilities: [],
    });
  });

  it("58-S1: GET /venues/:id/edit gives the form's values, with ids", async () => {
    const fake = createFake();
    const staff = fake.signIn("venue_staff");

    const res = await request(createApp(fake.deps, fake.options)).get("/venues/orchid/edit").set("Cookie", staff.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(orchid());
  });

  it("58-S1: an edit that changes nothing is saved too", async () => {
    const fake = createFake();
    const staff = fake.signIn("venue_staff");

    const res = await request(createApp(fake.deps, fake.options)).put("/venues/orchid").set("Cookie", staff.cookie).send(orchid());

    expect(res.status).toBe(200);
  });
});

describe("SCRUM-58/AC2 required fields cannot be cleared (58-S2)", () => {
  it("58-S2: clearing the required fields gives 422 naming each, and nothing is saved", async () => {
    const fake = createFake();
    const staff = fake.signIn("venue_staff");
    const app = createApp(fake.deps, fake.options);

    const res = await request(app).put("/venues/orchid").set("Cookie", staff.cookie).send({ ...orchid(), name: "", address: " ", layouts: [] });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("VALIDATION_FAILED");
    expect(Object.keys(res.body.fieldErrors).sort()).toEqual(["address", "layouts", "name"]);
    expect(fake.update).not.toHaveBeenCalled();
    const detail = await request(app).get("/venues/orchid").set("Cookie", staff.cookie);
    expect(detail.body).toMatchObject({ name: "Orchid Hall", max_capacity: 150 });
  });

  it.each([
    ["a capacity of 0", { maxCapacity: 0, layouts: [{ layoutId: THEATRE, maxCapacity: 10 }] }, ["maxCapacity"]],
    ["a layout bigger than the venue", { layouts: [{ layoutId: THEATRE, maxCapacity: 151 }] }, ["layouts"]],
    ["only one operating hour", { operatingHoursEnd: "" }, ["operatingHoursEnd"]],
  ])("58-S2: %s is rejected on the right field", async (_name, extra, fields) => {
    const fake = createFake();
    const staff = fake.signIn("venue_staff");

    const res = await request(createApp(fake.deps, fake.options)).put("/venues/orchid").set("Cookie", staff.cookie).send({ ...orchid(), ...extra });

    expect(res.status).toBe(422);
    expect(Object.keys(res.body.fieldErrors)).toEqual(fields);
    expect(fake.update).not.toHaveBeenCalled();
  });
});

describe("SCRUM-58/AC3 only venue staff can edit (58-S3)", () => {
  it("58-S3: a coordinator's PUT and GET /edit are 403, even with an invalid body, and write nothing", async () => {
    const fake = createFake();
    const coordinator = fake.signIn("event_coordinator");
    const app = createApp(fake.deps, fake.options);

    for (const body of [changed(), {}]) {
      const res = await request(app).put("/venues/orchid").set("Cookie", coordinator.cookie).send(body);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FORBIDDEN");
    }
    expect((await request(app).get("/venues/orchid/edit").set("Cookie", coordinator.cookie)).status).toBe(403);
    expect(fake.update).not.toHaveBeenCalled();
  });

  it("58-S3: someone who may not see the catalogue is refused, and a visitor is 401", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const app = createApp(fake.deps, fake.options);

    expect((await request(app).put("/venues/orchid").set("Cookie", organiser.cookie).send(changed())).status).toBe(403);
    expect((await request(app).put("/venues/orchid").send(changed())).status).toBe(401);
    expect((await request(app).get("/venues/orchid/edit")).status).toBe(401);
    expect(fake.update).not.toHaveBeenCalled();
  });

  it("58-S3: an unknown venue is 404 for venue staff, and nothing is written", async () => {
    const fake = createFake();
    const staff = fake.signIn("venue_staff");
    const app = createApp(fake.deps, fake.options);

    expect((await request(app).put("/venues/nope").set("Cookie", staff.cookie).send(changed())).status).toBe(404);
    expect((await request(app).get("/venues/nope/edit").set("Cookie", staff.cookie)).status).toBe(404);
    expect(fake.update).not.toHaveBeenCalled();
  });
});

describe("SCRUM-58/AC4 a capacity cut that leaves a booking over capacity asks first (58-S4)", () => {
  const cut = (extra: Record<string, unknown> = {}) => changed({ maxCapacity: 100, layouts: [{ layoutId: THEATRE, maxCapacity: 100 }], ...extra });

  it("58-S4: 409 CONFIRM_IMPACT lists the bookings, and nothing is saved", async () => {
    const fake = createFake([booking()]);
    const staff = fake.signIn("venue_staff");
    const app = createApp(fake.deps, fake.options);

    const res = await request(app).put("/venues/orchid").set("Cookie", staff.cookie).send(cut());

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "CONFIRM_IMPACT", affected: [booking()] });
    expect(res.body.error).toMatch(/more people/);
    expect(fake.update).not.toHaveBeenCalled();
    const detail = await request(app).get("/venues/orchid").set("Cookie", staff.cookie);
    expect(detail.body.max_capacity).toBe(150);
  });

  it("58-S4: the same body with confirmImpact: true saves", async () => {
    const fake = createFake([booking()]);
    const staff = fake.signIn("venue_staff");

    const res = await request(createApp(fake.deps, fake.options)).put("/venues/orchid").set("Cookie", staff.cookie).send(cut({ confirmImpact: true }));

    expect(res.status).toBe(200);
    expect(fake.update).toHaveBeenCalledWith("orchid", expect.objectContaining({ maxCapacity: 100 }));
    // the confirmation is not a venue field
    expect(fake.update.mock.calls[0][1]).not.toHaveProperty("confirmImpact");
  });

  it.each([
    ["a booking that fits", [booking({ expectedAttendance: 90 })]],
    ["a booking that has ended", [booking({ eventEnd: "2026-10-31T09:00:00Z" })]],
    ["a withdrawn booking", [booking({ status: "withdrawn" })]],
    ["a booking with no attendance", [booking({ expectedAttendance: null })]],
    ["no bookings at all", []],
  ])("58-S4: %s does not ask", async (_name, bookings) => {
    const fake = createFake(bookings);
    const staff = fake.signIn("venue_staff");

    const res = await request(createApp(fake.deps, fake.options)).put("/venues/orchid").set("Cookie", staff.cookie).send(cut());

    expect(res.status).toBe(200);
  });

  it("58-S4: keeping or raising the capacity never asks, even with a booking already over it", async () => {
    const fake = createFake([booking({ expectedAttendance: 400 })]);
    const staff = fake.signIn("venue_staff");
    const app = createApp(fake.deps, fake.options);

    expect((await request(app).put("/venues/orchid").set("Cookie", staff.cookie).send(orchid())).status).toBe(200);
    expect((await request(app).put("/venues/orchid").set("Cookie", staff.cookie).send(changed({ maxCapacity: 300 }))).status).toBe(200);
  });

  it("58-S4: a body that is invalid is 422, not 409, so the form's own mistakes come first", async () => {
    const fake = createFake([booking()]);
    const staff = fake.signIn("venue_staff");

    const res = await request(createApp(fake.deps, fake.options)).put("/venues/orchid").set("Cookie", staff.cookie).send(cut({ name: "" }));

    expect(res.status).toBe(422);
  });
});
