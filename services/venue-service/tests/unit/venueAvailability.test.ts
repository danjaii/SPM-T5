import request from "supertest";
import { describe, expect, it } from "vitest";
import { sgtToUtc } from "@spm-t5/shared";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";
import { FakeBookingRepository } from "../support/fakeBookingRepository";

// An in-memory Supabase, as in venue-catalogue.test.ts, for the venue and the caller's role.
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
    anon: { auth: { getUser: async (token: string) => { const id = sessions.get(token); return id ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: "bad token" } }; } } },
    forUser: () => ({ from: (table: string) => query(table) }),
  } as unknown as SupabaseDeps;
  const signIn = (role: string) => {
    const id = crypto.randomUUID();
    tables.users.push({ id, role, full_name: "Test User", is_active: true });
    sessions.set(`token-${id}`, id);
    return { cookie: `cs_session=token-${id}` };
  };
  return { deps, tables, signIn };
}

const DAY = "2026-11-14";
const at = (time: string, date = DAY) => sgtToUtc(date, time);

function arrange() {
  const fake = createFake();
  fake.tables.venues.push({ id: "orchid", name: "Orchid Hall", address: "x", max_capacity: 150, setup_minutes: 30, turnaround_minutes: 45 });
  const bookings = new FakeBookingRepository();
  bookings.setVenue("orchid", { name: "Orchid Hall", setupMinutes: 30, turnaroundMinutes: 45 });
  bookings.seed({ eventId: "summit-a", venueId: "orchid", start: at("10:00"), end: at("12:00"), status: "approved" });
  const app = createApp(fake.deps, { venueAvailability: () => bookings });
  return { fake, bookings, app };
}

describe("SCRUM-103/AC5 availability shows the padded period (103-S5)", () => {
  it("103-S5: the booking is occupied 09:30 to 12:45, with the event 10:00 to 12:00 set apart", async () => {
    const { fake, app } = arrange();
    const coordinator = fake.signIn("event_coordinator");

    const res = await request(app).get(`/venues/orchid/availability?date=${DAY}`).set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      venue: { id: "orchid", name: "Orchid Hall" },
      date: DAY,
      setup_minutes: 30,
      turnaround_minutes: 45,
      periods: [
        {
          status: "APPROVED",
          event_start: at("10:00").toISOString(),
          event_end: at("12:00").toISOString(),
          occupied_start: at("09:30").toISOString(),
          occupied_end: at("12:45").toISOString(),
        },
      ],
      unavailable: [], // SCRUM-105
    });
  });

  it("103-S5: a Pending booking is listed as PENDING", async () => {
    const { fake, app, bookings } = arrange();
    bookings.rows[0].status = "requested";
    const staff = fake.signIn("venue_staff");

    const res = await request(app).get(`/venues/orchid/availability?date=${DAY}`).set("Cookie", staff.cookie);

    expect(res.body.periods[0].status).toBe("PENDING");
  });

  it("103-S5: padding that reaches into the day from the evening before is shown", async () => {
    const { fake, app, bookings } = arrange();
    bookings.seed({ eventId: "late", venueId: "orchid", start: at("23:00", "2026-11-13"), end: at("23:50", "2026-11-13"), status: "approved" });
    const coordinator = fake.signIn("event_coordinator");

    const res = await request(app).get(`/venues/orchid/availability?date=${DAY}`).set("Cookie", coordinator.cookie);

    expect(res.body.periods.map((p: { occupied_end: string }) => p.occupied_end)).toContain(at("00:35").toISOString());
  });

  it("103-S5: a day with nothing booked has no periods", async () => {
    const { fake, app } = arrange();
    const coordinator = fake.signIn("event_coordinator");
    const res = await request(app).get("/venues/orchid/availability?date=2026-11-20").set("Cookie", coordinator.cookie);
    expect(res.status).toBe(200);
    expect(res.body.periods).toEqual([]);
  });

  it("103-S5: a bad or missing date is 422", async () => {
    const { fake, app } = arrange();
    const coordinator = fake.signIn("event_coordinator");
    for (const url of ["/venues/orchid/availability", "/venues/orchid/availability?date=14-11-2026", "/venues/orchid/availability?date=2026-02-30"]) {
      const res = await request(app).get(url).set("Cookie", coordinator.cookie);
      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toHaveProperty("date");
    }
  });

  it("103-S5: an unknown venue is 404, an organiser is 403, no session is 401", async () => {
    const { fake, app } = arrange();
    const coordinator = fake.signIn("event_coordinator");
    const organiser = fake.signIn("event_organiser");

    expect((await request(app).get(`/venues/nope/availability?date=${DAY}`).set("Cookie", coordinator.cookie)).status).toBe(404);
    expect((await request(app).get(`/venues/orchid/availability?date=${DAY}`).set("Cookie", organiser.cookie)).status).toBe(403);
    expect((await request(app).get(`/venues/orchid/availability?date=${DAY}`)).status).toBe(401);
  });

  it("103-S5: the answer is never cached, so a new booking shows on reload", async () => {
    const { fake, app } = arrange();
    const coordinator = fake.signIn("event_coordinator");
    const res = await request(app).get(`/venues/orchid/availability?date=${DAY}`).set("Cookie", coordinator.cookie);
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});
