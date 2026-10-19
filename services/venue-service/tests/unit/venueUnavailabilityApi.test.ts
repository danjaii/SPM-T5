import request from "supertest";
import { describe, expect, it } from "vitest";
import { sgtToUtc } from "@spm-t5/shared";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";
import { FakeBookingRepository } from "../support/fakeBookingRepository";
import { FakeVenueUnavailabilityStore } from "../support/fakeVenueUnavailabilityStore";

// SCRUM-105 (docs/specs/venue-unavailability.md): the endpoints. An in-memory Supabase, as in venue-timing.test.ts, for the
// venue and the caller's role; the blocks come from a fake store, the way set_venue_timing is faked for SCRUM-101.
type Row = Record<string, unknown>;

const NOW = new Date("2026-10-01T00:00:00.000Z");
const BODY = { startDate: "2026-11-14", startTime: "08:00", endDate: "2026-11-16", endTime: "18:00", reason: "maintenance", notes: "Annual inspection" };

function arrange() {
  const sessions = new Map<string, string>();
  const tables: Record<string, Row[]> = { users: [], venues: [{ id: "orchid", name: "Orchid Hall", address: "Level 3", max_capacity: 150, setup_minutes: 30, turnaround_minutes: 0 }] };
  const query = (table: string) => {
    const filters: [string, unknown][] = [];
    const run = () => tables[table].filter((r) => filters.every(([col, val]) => r[col] === val)).map((r) => ({ ...r }));
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => { filters.push([col, val]); return builder; },
      order: () => builder,
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(resolve, reject),
    };
    return builder;
  };
  const deps = {
    anon: { auth: { getUser: async (token: string) => { const id = sessions.get(token); return id ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: "bad token" } }; } } },
    forUser: () => ({ from: (table: string) => query(table) }),
  } as unknown as SupabaseDeps;
  const signIn = (role: string) => {
    const id = crypto.randomUUID();
    tables.users.push({ id, role, full_name: "Test User", is_active: true });
    sessions.set(`token-${id}`, id);
    return { cookie: `cs_session=token-${id}` };
  };
  const store = new FakeVenueUnavailabilityStore();
  const bookings = new FakeBookingRepository();
  bookings.setVenue("orchid", { name: "Orchid Hall", setupMinutes: 30 });
  const app = createApp(deps, { now: () => NOW, venueUnavailability: () => store, venueAvailability: () => bookings });
  return { app, store, signIn };
}

describe("SCRUM-105/AC1 venue staff mark a venue unavailable (105-S1)", () => {
  it("105-S1: saves the block and answers 201 with it in Singapore time", async () => {
    const { app, store, signIn } = arrange();
    const staff = signIn("venue_staff");

    const res = await request(app).post("/venues/orchid/unavailability").set("Cookie", staff.cookie).send(BODY);

    expect(res.status).toBe(201);
    expect(res.body.block).toMatchObject({
      startDate: "2026-11-14",
      startTime: "08:00",
      endDate: "2026-11-16",
      endTime: "18:00",
      reason: "maintenance",
      reasonLabel: "Maintenance",
      notes: "Annual inspection",
      recordedBy: "Kenneth Wong",
    });
    expect(store.marked).toEqual([{ venueId: "orchid", input: { start: sgtToUtc("2026-11-14", "08:00"), end: sgtToUtc("2026-11-16", "18:00"), reason: "maintenance", notes: "Annual inspection" } }]);
  });

  it("105-S1: the venue's detail then lists it, with can_mark_unavailable for venue staff", async () => {
    const { app, store, signIn } = arrange();
    const staff = signIn("venue_staff");
    store.seed("orchid", sgtToUtc("2026-11-14", "08:00"), sgtToUtc("2026-11-16", "18:00"), "safety", "Fire door repair");

    const res = await request(app).get("/venues/orchid").set("Cookie", staff.cookie);

    expect(res.status).toBe(200);
    expect(res.body.can_mark_unavailable).toBe(true);
    expect(res.body.unavailability).toHaveLength(1);
    expect(res.body.unavailability[0]).toMatchObject({ startDate: "2026-11-14", startTime: "08:00", endDate: "2026-11-16", endTime: "18:00", reason: "safety", reasonLabel: "Safety concern", notes: "Fire door repair", recordedBy: "Kenneth Wong" });
  });

  it("105-S1: only blocks that have not ended are listed, earliest first", async () => {
    const { app, store, signIn } = arrange();
    const staff = signIn("venue_staff");
    store.seed("orchid", sgtToUtc("2026-12-01", "08:00"), sgtToUtc("2026-12-02", "08:00"));
    store.seed("orchid", sgtToUtc("2026-09-01", "08:00"), sgtToUtc("2026-09-02", "08:00")); // over before NOW
    store.seed("orchid", sgtToUtc("2026-11-14", "08:00"), sgtToUtc("2026-11-16", "18:00"));

    const res = await request(app).get("/venues/orchid").set("Cookie", staff.cookie);

    expect(res.body.unavailability.map((b: { startDate: string }) => b.startDate)).toEqual(["2026-11-14", "2026-12-01"]);
  });

  it("105-S1: a venue with no blocks lists none", async () => {
    const { app, signIn } = arrange();
    const staff = signIn("venue_staff");
    expect((await request(app).get("/venues/orchid").set("Cookie", staff.cookie)).body.unavailability).toEqual([]);
  });
});

describe("SCRUM-105/AC2 a reason is required (105-S2)", () => {
  it.each([
    ["no reason", { reason: undefined }],
    ["a blank reason", { reason: "  " }],
    ["internal_activity", { reason: "internal_activity" }],
    ["an unknown reason", { reason: "party" }],
  ])("105-S2: %s is 422 on reason and nothing is saved", async (_name, change) => {
    const { app, store, signIn } = arrange();
    const staff = signIn("venue_staff");

    const res = await request(app).post("/venues/orchid/unavailability").set("Cookie", staff.cookie).send({ ...BODY, ...change });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("VALIDATION_FAILED");
    expect(Object.keys(res.body.fieldErrors)).toEqual(["reason"]);
    expect(store.marked).toEqual([]);
  });

  it.each(["maintenance", "equipment_failure", "renovation", "safety"])("105-S2: %s is accepted", async (reason) => {
    const { app, signIn } = arrange();
    const staff = signIn("venue_staff");
    expect((await request(app).post("/venues/orchid/unavailability").set("Cookie", staff.cookie).send({ ...BODY, reason })).status).toBe(201);
  });

  it("105-S2: Other needs notes [PROPOSED]", async () => {
    const { app, store, signIn } = arrange();
    const staff = signIn("venue_staff");

    const without = await request(app).post("/venues/orchid/unavailability").set("Cookie", staff.cookie).send({ ...BODY, reason: "other", notes: "" });
    expect(without.status).toBe(422);
    expect(Object.keys(without.body.fieldErrors)).toEqual(["notes"]);
    expect(store.marked).toEqual([]);

    expect((await request(app).post("/venues/orchid/unavailability").set("Cookie", staff.cookie).send({ ...BODY, reason: "other", notes: "Wedding photoshoot" })).status).toBe(201);
  });
});

describe("SCRUM-105/AC3 the end must follow the start (105-S3)", () => {
  it.each([
    ["equal to the start", { endDate: "2026-11-14", endTime: "08:00" }, "endTime"],
    ["before the start", { endDate: "2026-11-13", endTime: "18:00" }, "endTime"],
    ["a day that does not exist", { startDate: "2026-02-31" }, "startDate"],
    ["a malformed time", { endTime: "6pm" }, "endTime"],
  ])("105-S3: an end %s is 422 and nothing is saved", async (_name, change, field) => {
    const { app, store, signIn } = arrange();
    const staff = signIn("venue_staff");

    const res = await request(app).post("/venues/orchid/unavailability").set("Cookie", staff.cookie).send({ ...BODY, ...change });

    expect(res.status).toBe(422);
    expect(res.body.fieldErrors[field]).toBeTruthy();
    expect(store.marked).toEqual([]);
  });
});

describe("SCRUM-105/AC6 only venue staff can mark a venue unavailable (105-S6)", () => {
  it("105-S6: a coordinator's detail view has no action and no notes or recorder", async () => {
    const { app, store, signIn } = arrange();
    const coordinator = signIn("event_coordinator");
    store.seed("orchid", sgtToUtc("2026-11-14", "08:00"), sgtToUtc("2026-11-16", "18:00"), "safety", "Fire door repair");

    const res = await request(app).get("/venues/orchid").set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body.can_mark_unavailable).toBe(false);
    expect(res.body.unavailability).toHaveLength(1);
    expect(res.body.unavailability[0]).toMatchObject({ reasonLabel: "Safety concern", startDate: "2026-11-14" });
    expect(res.body.unavailability[0]).not.toHaveProperty("notes");
    expect(res.body.unavailability[0]).not.toHaveProperty("recordedBy");
    expect(store.listedWithRecorder).toEqual([false]);
  });

  it("105-S6: a coordinator's POST is 403, even with an invalid body, and nothing is saved", async () => {
    const { app, store, signIn } = arrange();
    const coordinator = signIn("event_coordinator");

    for (const body of [BODY, {}]) {
      const res = await request(app).post("/venues/orchid/unavailability").set("Cookie", coordinator.cookie).send(body);
      expect(res.status).toBe(403);
    }
    expect(store.marked).toEqual([]);
  });

  it("105-S6: an organiser and an attendee get 403 from the venue pages, and no session is 401", async () => {
    const { app, signIn } = arrange();
    for (const role of ["event_organiser", "attendee"]) {
      const user = signIn(role);
      expect((await request(app).get("/venues/orchid").set("Cookie", user.cookie)).status).toBe(403);
      expect((await request(app).post("/venues/orchid/unavailability").set("Cookie", user.cookie).send(BODY)).status).toBe(403);
    }
    expect((await request(app).post("/venues/orchid/unavailability").send(BODY)).status).toBe(401);
  });

  it("105-S6: an unknown venue is 404", async () => {
    const { app, store, signIn } = arrange();
    const staff = signIn("venue_staff");
    const res = await request(app).post("/venues/nowhere/unavailability").set("Cookie", staff.cookie).send(BODY);
    expect(res.status).toBe(404);
    expect(store.marked).toEqual([]);
  });
});

describe("SCRUM-105/AC1 the availability view draws the blocks (105-S1)", () => {
  it("105-S1: the day's blocks are listed under unavailable, the other days' are not", async () => {
    const { app, store, signIn } = arrange();
    const coordinator = signIn("event_coordinator");
    store.seed("orchid", sgtToUtc("2026-11-14", "08:00"), sgtToUtc("2026-11-16", "18:00"), "maintenance");
    store.seed("orchid", sgtToUtc("2026-12-01", "08:00"), sgtToUtc("2026-12-02", "08:00"), "renovation");

    const during = await request(app).get("/venues/orchid/availability?date=2026-11-15").set("Cookie", coordinator.cookie);
    const touching = await request(app).get("/venues/orchid/availability?date=2026-11-16").set("Cookie", coordinator.cookie);
    const after = await request(app).get("/venues/orchid/availability?date=2026-11-17").set("Cookie", coordinator.cookie);

    expect(during.body.unavailable).toHaveLength(1);
    expect(during.body.unavailable[0]).toMatchObject({ startTime: "08:00", endTime: "18:00", reasonLabel: "Maintenance" });
    expect(during.body.unavailable[0]).not.toHaveProperty("notes");
    expect(touching.body.unavailable).toHaveLength(1); // the block ends 18:00 that day
    expect(after.body.unavailable).toEqual([]);
  });
});
