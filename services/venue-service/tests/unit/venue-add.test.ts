import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { VenueInput } from "@spm-t5/shared";
import { createApp } from "../../src/app";
import type { VenueCatalogueWriter } from "../../src/readers/venueCatalogueWriter";
import type { SupabaseDeps } from "../../src/supabase";

// An in-memory Supabase, as in venue-timing.test.ts, so these tests never touch a database.
type Row = Record<string, unknown>;

const LAYOUT_THEATRE = "a685c8bf-c57d-5cb4-be30-49dedce9a02b";
const FACILITY_PROJECTOR = "8a02aa6c-e1ae-59e3-9d09-e5704315347d";
const LAYOUT_NAMES: Record<string, string> = { [LAYOUT_THEATRE]: "Theatre" };
const FACILITY_NAMES: Record<string, string> = { [FACILITY_PROJECTOR]: "Projector & Screen" };

function createFake() {
  const sessions = new Map<string, string>();
  const tables: Record<string, Row[]> = { users: [], venues: [], venue_unavailability: [] };

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

  /** A writer that adds the venue to the in-memory tables, the way create_venue does in the database. */
  const writer = () => {
    const create = vi.fn(async (input: VenueInput) => {
      const id = `venue-${tables.venues.length + 1}`;
      tables.venues.push({
        id,
        name: input.name,
        address: input.address,
        description: input.description,
        max_capacity: input.maxCapacity,
        operating_hours_start: input.operatingHoursStart,
        operating_hours_end: input.operatingHoursEnd,
        is_accessible: input.isAccessible,
        accessibility_notes: input.accessibilityNotes,
        venue_supported_layouts: input.layouts.map((l) => ({ max_capacity_for_layout: l.maxCapacity, room_layouts: { name: LAYOUT_NAMES[l.layoutId] } })),
        venue_facilities: input.facilityIds.map((f) => ({ facilities: { name: FACILITY_NAMES[f] } })),
      });
      return { id };
    });
    const catalogue: VenueCatalogueWriter = { create, update: vi.fn() };
    return { create, factory: () => catalogue };
  };

  return { deps, tables, signIn, writer };
}

const complete = (extra: Record<string, unknown> = {}) => ({
  name: "Orchid Hall",
  address: "Level 3, 1 Raffles Place",
  description: "A hall for talks.",
  maxCapacity: 150,
  operatingHoursStart: "08:00",
  operatingHoursEnd: "22:00",
  isAccessible: true,
  accessibilityNotes: "Step-free entrance.",
  layouts: [{ layoutId: LAYOUT_THEATRE, maxCapacity: 150 }],
  facilityIds: [FACILITY_PROJECTOR],
  ...extra,
});

describe("SCRUM-57/AC1 venue staff add a venue (57-S1)", () => {
  it("57-S1: 201 with the new id, and the venue then appears in the catalogue and its detail", async () => {
    const fake = createFake();
    const staff = fake.signIn("venue_staff");
    const writer = fake.writer();
    const app = createApp(fake.deps, { venueCatalogue: writer.factory });

    const post = await request(app).post("/venues").set("Cookie", staff.cookie).send(complete({ name: "  Orchid Hall  ", maxCapacity: "150" }));

    expect(post.status).toBe(201);
    expect(post.body).toEqual({ id: "venue-1" });
    // the writer gets the cleaned values the shared parser produced
    expect(writer.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Orchid Hall", maxCapacity: 150, layouts: [{ layoutId: LAYOUT_THEATRE, maxCapacity: 150 }], facilityIds: [FACILITY_PROJECTOR] }),
    );

    const list = await request(app).get("/venues").set("Cookie", staff.cookie);
    expect(list.body).toEqual([{ id: "venue-1", name: "Orchid Hall", address: "Level 3, 1 Raffles Place", max_capacity: 150 }]);

    const detail = await request(app).get("/venues/venue-1").set("Cookie", staff.cookie);
    expect(detail.body).toMatchObject({
      name: "Orchid Hall",
      is_accessible: true,
      accessibility_notes: "Step-free entrance.",
      layouts: [{ name: "Theatre", max_capacity: 150 }],
      facilities: ["Projector & Screen"],
      setup_minutes: 0,
      turnaround_minutes: 0,
    });
  });

  it("57-S1: a venue with the same name as an existing one is added too", async () => {
    const fake = createFake();
    const staff = fake.signIn("venue_staff");
    const writer = fake.writer();
    const app = createApp(fake.deps, { venueCatalogue: writer.factory });

    const first = await request(app).post("/venues").set("Cookie", staff.cookie).send(complete());
    const second = await request(app).post("/venues").set("Cookie", staff.cookie).send(complete({ address: "Level 9, East Wing" }));

    expect([first.status, second.status]).toEqual([201, 201]);
    expect(writer.create).toHaveBeenCalledTimes(2);
  });

  it("57-S1: only the required fields are enough", async () => {
    const fake = createFake();
    const staff = fake.signIn("venue_staff");
    const writer = fake.writer();

    const res = await request(createApp(fake.deps, { venueCatalogue: writer.factory }))
      .post("/venues").set("Cookie", staff.cookie)
      .send({ name: "Lotus Room", address: "Level 1", maxCapacity: 40, layouts: [{ layoutId: LAYOUT_THEATRE, maxCapacity: 40 }] });

    expect(res.status).toBe(201);
    expect(writer.create).toHaveBeenCalledWith(
      expect.objectContaining({ description: null, operatingHoursStart: null, isAccessible: false, facilityIds: [] }),
    );
  });
});

describe("SCRUM-57/AC2 required fields (57-S2)", () => {
  it("57-S2: an empty body gives 422 naming every required field, and nothing is created", async () => {
    const fake = createFake();
    const staff = fake.signIn("venue_staff");
    const writer = fake.writer();

    const res = await request(createApp(fake.deps, { venueCatalogue: writer.factory })).post("/venues").set("Cookie", staff.cookie).send({});

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("VALIDATION_FAILED");
    expect(Object.keys(res.body.fieldErrors).sort()).toEqual(["address", "layouts", "maxCapacity", "name"]);
    expect(writer.create).not.toHaveBeenCalled();
    expect(fake.tables.venues).toHaveLength(0);
  });

  it.each([
    ["a layout bigger than the venue", complete({ layouts: [{ layoutId: LAYOUT_THEATRE, maxCapacity: 151 }] }), ["layouts"]],
    ["only one operating hour", complete({ operatingHoursEnd: "" }), ["operatingHoursEnd"]],
    ["a zero capacity", complete({ maxCapacity: 0, layouts: [{ layoutId: LAYOUT_THEATRE, maxCapacity: 10 }] }), ["maxCapacity"]],
  ])("57-S2: %s is rejected on the right field", async (_name, body, fields) => {
    const fake = createFake();
    const staff = fake.signIn("venue_staff");
    const writer = fake.writer();

    const res = await request(createApp(fake.deps, { venueCatalogue: writer.factory })).post("/venues").set("Cookie", staff.cookie).send(body);

    expect(res.status).toBe(422);
    expect(Object.keys(res.body.fieldErrors)).toEqual(fields);
    expect(writer.create).not.toHaveBeenCalled();
  });
});

describe("SCRUM-57/AC3 only venue staff can add (57-S3)", () => {
  it("57-S3: a coordinator's POST is 403, even with an invalid body, and writes nothing", async () => {
    const fake = createFake();
    const coordinator = fake.signIn("event_coordinator");
    const writer = fake.writer();
    const app = createApp(fake.deps, { venueCatalogue: writer.factory });

    for (const body of [complete(), {}]) {
      const res = await request(app).post("/venues").set("Cookie", coordinator.cookie).send(body);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FORBIDDEN");
    }
    expect(writer.create).not.toHaveBeenCalled();
  });

  it("57-S3: someone who may not see the catalogue is refused, and a visitor is 401", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const writer = fake.writer();
    const app = createApp(fake.deps, { venueCatalogue: writer.factory });

    expect((await request(app).post("/venues").set("Cookie", organiser.cookie).send(complete())).status).toBe(403);
    expect((await request(app).post("/venues").send(complete())).status).toBe(401);
    expect(writer.create).not.toHaveBeenCalled();
  });

  it("57-S3: the catalogue tells venue staff, and no one else, that they can add a venue", async () => {
    const fake = createFake();
    const staff = fake.signIn("venue_staff");
    const coordinator = fake.signIn("event_coordinator");
    fake.tables.venues.push({ id: "orchid", name: "Orchid Hall", address: "Level 3", max_capacity: 150 });
    const app = createApp(fake.deps);

    const asStaff = await request(app).get("/venues/orchid").set("Cookie", staff.cookie);
    const asCoordinator = await request(app).get("/venues/orchid").set("Cookie", coordinator.cookie);

    expect(asStaff.body.can_manage_catalogue).toBe(true);
    expect(asCoordinator.body.can_manage_catalogue).toBe(false);
  });
});
