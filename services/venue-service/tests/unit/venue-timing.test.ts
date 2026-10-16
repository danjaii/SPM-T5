import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import type { VenueTimingWriter } from "../../src/readers/venueTimingWriter";
import type { SupabaseDeps } from "../../src/supabase";

// An in-memory Supabase, as in venue-catalogue.test.ts, so these tests never touch a database.
type Row = Record<string, unknown>;

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

  /** A writer that updates the in-memory venue, like set_venue_timing does in the database. */
  const writer = () => {
    const set = vi.fn(async (venueId: string, setup: number, turnaround: number) => {
      const venue = tables.venues.find((v) => v.id === venueId)!;
      venue.setup_minutes = setup;
      venue.turnaround_minutes = turnaround;
      return []; // SCRUM-104: no existing booking is affected
    });
    const timing: VenueTimingWriter = { set };
    return { set, factory: () => timing };
  };

  return { deps, tables, signIn, writer };
}

const orchid = (extra: Row = {}) => ({ id: "orchid", name: "Orchid Hall", address: "Level 3", max_capacity: 150, ...extra });

describe("SCRUM-101/AC1 venue staff set the setup and turnaround times (101-S1)", () => {
  it("101-S1: saves both values and the detail view then shows them", async () => {
    const fake = createFake();
    const staff = fake.signIn("venue_staff");
    fake.tables.venues.push(orchid({ setup_minutes: 0, turnaround_minutes: 0 }));
    const writer = fake.writer();
    const app = createApp(fake.deps, { venueTiming: writer.factory });

    const put = await request(app).put("/venues/orchid/timing").set("Cookie", staff.cookie).send({ setupMinutes: 30, turnaroundMinutes: 45 });

    expect(put.status).toBe(200);
    // SCRUM-104 adds `affected` and `message` to the SCRUM-101 body, so the old fields are matched, not the whole body
    expect(put.body).toMatchObject({ setup_minutes: 30, turnaround_minutes: 45 });
    expect(put.body).toMatchObject({ affected: [], message: "No existing bookings are affected." });
    expect(writer.set).toHaveBeenCalledWith("orchid", 30, 45);

    const get = await request(app).get("/venues/orchid").set("Cookie", staff.cookie);
    expect(get.body).toMatchObject({ setup_minutes: 30, turnaround_minutes: 45, can_edit_timing: true });
  });

  it("101-S1: accepts numeric strings, as a form sends them", async () => {
    const fake = createFake();
    const staff = fake.signIn("venue_staff");
    fake.tables.venues.push(orchid());
    const writer = fake.writer();

    const res = await request(createApp(fake.deps, { venueTiming: writer.factory }))
      .put("/venues/orchid/timing").set("Cookie", staff.cookie).send({ setupMinutes: "30", turnaroundMinutes: "45" });

    expect(res.status).toBe(200);
    expect(writer.set).toHaveBeenCalledWith("orchid", 30, 45);
  });
});

describe("SCRUM-101/AC2 venues default to zero (101-S2)", () => {
  it("101-S2: a venue never given times shows 0 and 0", async () => {
    const fake = createFake();
    const coordinator = fake.signIn("event_coordinator");
    fake.tables.venues.push(orchid({ id: "lotus", name: "Lotus Room" })); // no timing columns set

    const res = await request(createApp(fake.deps)).get("/venues/lotus").set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ setup_minutes: 0, turnaround_minutes: 0 });
  });
});

describe("SCRUM-101/AC3 invalid values are rejected and the old ones kept (101-S3)", () => {
  it.each([
    ["a negative setup time", { setupMinutes: -15, turnaroundMinutes: 45 }, ["setupMinutes"]],
    ["a decimal turnaround time", { setupMinutes: 30, turnaroundMinutes: 12.5 }, ["turnaroundMinutes"]],
    ["text in both", { setupMinutes: "abc", turnaroundMinutes: "" }, ["setupMinutes", "turnaroundMinutes"]],
  ])("101-S3: %s gives 422 and nothing is written", async (_name, body, fields) => {
    const fake = createFake();
    const staff = fake.signIn("venue_staff");
    fake.tables.venues.push(orchid({ setup_minutes: 30, turnaround_minutes: 45 }));
    const writer = fake.writer();
    const app = createApp(fake.deps, { venueTiming: writer.factory });

    const res = await request(app).put("/venues/orchid/timing").set("Cookie", staff.cookie).send(body);

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("VALIDATION_FAILED");
    expect(Object.keys(res.body.fieldErrors)).toEqual(fields);
    expect(writer.set).not.toHaveBeenCalled();
    const get = await request(app).get("/venues/orchid").set("Cookie", staff.cookie);
    expect(get.body).toMatchObject({ setup_minutes: 30, turnaround_minutes: 45 });
  });
});

describe("SCRUM-101/AC4 only venue staff can edit (101-S4)", () => {
  it("101-S4: a coordinator sees the times and cannot edit", async () => {
    const fake = createFake();
    const coordinator = fake.signIn("event_coordinator");
    fake.tables.venues.push(orchid({ setup_minutes: 30, turnaround_minutes: 45 }));

    const res = await request(createApp(fake.deps)).get("/venues/orchid").set("Cookie", coordinator.cookie);

    expect(res.body).toMatchObject({ setup_minutes: 30, turnaround_minutes: 45, can_edit_timing: false });
  });

  it("101-S4: a coordinator's PUT is 403, even with an invalid body, and writes nothing", async () => {
    const fake = createFake();
    const coordinator = fake.signIn("event_coordinator");
    fake.tables.venues.push(orchid());
    const writer = fake.writer();
    const app = createApp(fake.deps, { venueTiming: writer.factory });

    for (const body of [{ setupMinutes: 10, turnaroundMinutes: 10 }, { setupMinutes: -1 }]) {
      const res = await request(app).put("/venues/orchid/timing").set("Cookie", coordinator.cookie).send(body);
      expect(res.status).toBe(403);
    }
    expect(writer.set).not.toHaveBeenCalled();
  });

  it("101-S4: someone who may not see the catalogue is refused, and a visitor is 401", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    fake.tables.venues.push(orchid());
    const app = createApp(fake.deps, { venueTiming: fake.writer().factory });

    const body = { setupMinutes: 1, turnaroundMinutes: 1 };
    expect((await request(app).put("/venues/orchid/timing").set("Cookie", organiser.cookie).send(body)).status).toBe(403);
    expect((await request(app).put("/venues/orchid/timing").send(body)).status).toBe(401);
  });

  it("101-S4: an unknown venue is 404", async () => {
    const fake = createFake();
    const staff = fake.signIn("venue_staff");
    const writer = fake.writer();

    const res = await request(createApp(fake.deps, { venueTiming: writer.factory }))
      .put("/venues/nope/timing").set("Cookie", staff.cookie).send({ setupMinutes: 1, turnaroundMinutes: 1 });

    expect(res.status).toBe(404);
    expect(writer.set).not.toHaveBeenCalled();
  });
});
