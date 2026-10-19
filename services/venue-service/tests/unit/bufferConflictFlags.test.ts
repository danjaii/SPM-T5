import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";
import { FakeBookingRepository } from "../support/fakeBookingRepository";
import { FakeEventReader, anEvent } from "../support/fakeEventReader";
import { FakeUserReader } from "../support/fakeUserReader";
import { FakeRoleReader, FakeVenueReader, aVenue } from "../support/fakeVenueAndRoles";

/**
 * SCRUM-104 (docs/specs/venue-buffer-conflicts.md): the whole flow through the app with in-memory ports. The fake repository
 * does what migration 36 does (reconcile on a timing save, resolve when a booking closes or moves, refuse a flagged approval),
 * so these tests cover the service and the HTTP contract; the SQL itself is covered by tests/integration/bufferConflicts.test.ts.
 */

const NOW = new Date("2026-10-05T03:00:00.000Z");
// Singapore 2030-11-14: Summit A 10:00-12:00 and Summit B 12:30-14:00
const A = { start: new Date("2030-11-14T02:00:00Z"), end: new Date("2030-11-14T04:00:00Z") };
const B = { start: new Date("2030-11-14T04:30:00Z"), end: new Date("2030-11-14T06:00:00Z") };

type Row = Record<string, unknown>;

function setup() {
  const bookings = new FakeBookingRepository(() => NOW);
  bookings.setVenue("venue-1", { name: "Orchid Hall" });
  const events = new FakeEventReader([
    anEvent({ id: "event-a", name: "Summit A", assignedCoordinatorId: "coordinator-2" }),
    anEvent({ id: "event-b", name: "Summit B", assignedCoordinatorId: "coordinator-1" }),
  ]);
  const venues = new FakeVenueReader([aVenue()]);
  const roles = new FakeRoleReader({
    "coordinator-1": "event_coordinator",
    "coordinator-2": "event_coordinator",
    "organiser-1": "event_organiser",
    "staff-1": "venue_staff",
  });
  const users = new FakeUserReader({ "coordinator-1": "Casey", "coordinator-2": "Cam" });

  // The venue routes read the caller's role and the venue row through deps.forUser(); a tiny in-memory table store is enough.
  const tables: Record<string, Row[]> = {
    users: [
      { id: "staff-1", role: "venue_staff" },
      { id: "coordinator-1", role: "event_coordinator" },
    ],
    venues: [{ id: "venue-1", name: "Orchid Hall" }],
  };
  const query = (table: string) => {
    const filters: [string, unknown][] = [];
    const run = () => tables[table].filter((r) => filters.every(([c, v]) => r[c] === v));
    const builder = {
      select: () => builder,
      eq: (c: string, v: unknown) => (filters.push([c, v]), builder),
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    };
    return builder;
  };
  const deps = {
    anon: { auth: { getUser: async (t: string) => ({ data: { user: t.startsWith("tok-") ? { id: t.slice(4) } : null } }) } },
    forUser: () => ({ from: (t: string) => query(t) }),
  } as unknown as SupabaseDeps;

  const app = createApp(deps, {
    now: () => NOW,
    ports: () => ({ bookings, events, venues, roles, users }),
    venueTiming: () => bookings.timingWriter(),
  });
  const as = (user: string) => `cs_session=tok-${user}`;
  const saveTiming = (setupMinutes: number, turnaroundMinutes: number) =>
    request(app).put("/venues/venue-1/timing").set("Cookie", as("staff-1")).send({ setupMinutes, turnaroundMinutes });
  const get = (path: string, user: string) => request(app).get(path).set("Cookie", as(user));

  const summitA = bookings.seed({
    eventId: "event-a",
    venueId: "venue-1",
    ...A,
    status: "approved",
    snapshot: { eventName: "Summit A", expectedAttendance: 10, venueRequirements: null, accessibilityNeeds: null },
  });
  const summitB = bookings.seed({
    eventId: "event-b",
    venueId: "venue-1",
    ...B,
    status: "approved",
    snapshot: { eventName: "Summit B", expectedAttendance: 10, venueRequirements: null, accessibilityNeeds: null },
  });
  return { app, bookings, events, saveTiming, get, as, summitA, summitB };
}

describe("SCRUM-104/AC1 saving new times flags the bookings that now clash (104-S1)", () => {
  it("104-S1: setup 30 and turnaround 45 tell staff Summit A now conflicts with Summit B, and flag both, each naming the other", async () => {
    const { saveTiming, bookings, summitA, summitB } = setup();

    const res = await saveTiming(30, 45);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ setup_minutes: 30, turnaround_minutes: 45, message: "1 pair of bookings is flagged." });
    expect(res.body.affected).toHaveLength(1);
    expect(res.body.affected[0].summary).toBe("Summit A (occupies until 12:45) now conflicts with Summit B (occupies from 12:00)");
    expect(res.body.affected[0]).toMatchObject({
      first: { bookingId: summitA.id, eventName: "Summit A", date: "2030-11-14", startTime: "10:00", endTime: "12:00" },
      second: { bookingId: summitB.id, eventName: "Summit B", date: "2030-11-14", startTime: "12:30", endTime: "14:00" },
    });
    expect(bookings.openFlags(summitA.id).map((f) => f.otherBookingId)).toEqual([summitB.id]);
    expect(bookings.openFlags(summitB.id).map((f) => f.otherBookingId)).toEqual([summitA.id]);
  });
});

describe("SCRUM-104/AC2 nothing is removed (104-S2)", () => {
  it("104-S2: both stay approved, neither is withdrawn or cancelled, and the events are untouched", async () => {
    const { saveTiming, bookings, events, summitA, summitB } = setup();
    const eventsBefore = JSON.stringify([await events.getById("event-a"), await events.getById("event-b")]);

    await saveTiming(30, 45);

    for (const row of [summitA, summitB]) {
      expect(row).toMatchObject({ status: "approved", withdrawnAt: null, cancelledAt: null, reviewedBy: null });
    }
    expect(bookings.rows).toHaveLength(2);
    expect(JSON.stringify([await events.getById("event-a"), await events.getById("event-b")])).toBe(eventsBefore);
  });
});

describe("SCRUM-104/AC3 the assigned coordinator sees the flag (104-S3)", () => {
  it("104-S3: Summit B's list, detail and event list carry the flag and Summit A's period, never its name", async () => {
    const { saveTiming, get, summitB } = setup();
    await saveTiming(30, 45);

    const list = await get("/venue-bookings", "coordinator-1");
    const detail = await get(`/venue-bookings/${summitB.id}`, "coordinator-1");
    const forEvent = await get("/events/event-b/venue-bookings", "coordinator-1");

    const expected = [
      {
        kind: "buffer_conflict",
        label: "Buffer conflict",
        otherPeriod: { date: "2030-11-14", startTime: "10:00", endTime: "12:00" },
      },
    ];
    for (const item of [list.body[0], detail.body, forEvent.body[0]]) {
      expect(item.flags).toMatchObject(expected);
      expect(item.flags[0]).not.toHaveProperty("otherEventName");
    }
    expect(JSON.stringify([list.body, detail.body, forEvent.body])).not.toContain("Summit A");
    expect(detail.body.chain[0].flags).toMatchObject(expected);
  });

  it("104-S3: a booking with no flag has an empty flags list", async () => {
    const { get } = setup();
    expect((await get("/venue-bookings", "coordinator-1")).body[0].flags).toEqual([]);
  });

  it("104-S3: another coordinator is still refused another's booking, and the organiser sees nothing", async () => {
    const { saveTiming, get, summitB } = setup();
    await saveTiming(30, 45);

    expect((await get(`/venue-bookings/${summitB.id}`, "coordinator-2")).status).toBe(403);
    expect((await get("/venue-bookings", "organiser-1")).status).toBe(403);
  });
});

describe("SCRUM-104/AC4 a flagged Pending request cannot be approved (104-S4)", () => {
  async function flaggedPending() {
    const ctx = setup();
    // a Pending request for 12:30-14:00 on another day clashes with an approved booking only after padding
    const pending = ctx.bookings.seed({
      eventId: "event-b",
      venueId: "venue-1",
      start: new Date("2030-11-15T04:30:00Z"),
      end: new Date("2030-11-15T06:00:00Z"),
      snapshot: { eventName: "Summit B", expectedAttendance: 10, venueRequirements: null, accessibilityNeeds: null },
    });
    ctx.bookings.seed({
      eventId: "event-a",
      venueId: "venue-1",
      start: new Date("2030-11-15T02:00:00Z"),
      end: new Date("2030-11-15T04:00:00Z"),
      status: "approved",
      snapshot: { eventName: "Summit A", expectedAttendance: 10, venueRequirements: null, accessibilityNeeds: null },
    });
    await ctx.saveTiming(30, 45);
    return { ...ctx, pending };
  }

  it("104-S4: approve is refused with 409 BOOKING_FLAGGED and the request stays pending", async () => {
    const { app, as, pending } = await flaggedPending();

    const res = await request(app).post(`/venue-bookings/${pending.id}/approve`).set("Cookie", as("staff-1"));

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      code: "BOOKING_FLAGGED",
      error: "This request is flagged and cannot be approved until the conflict is resolved. You can still reject it.",
    });
    expect(pending).toMatchObject({ status: "requested", reviewedBy: null });
  });

  it("104-S4: reject still works on the flagged request, and its flags clear (the booking is closed)", async () => {
    const { app, as, pending, bookings } = await flaggedPending();

    const res = await request(app).post(`/venue-bookings/${pending.id}/reject`).set("Cookie", as("staff-1")).send({ reason: "Cannot fit" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "REJECTED" });
    expect(bookings.openFlags(pending.id)).toEqual([]);
  });

  it("104-S4: the queue shows the flag to staff with the other booking's event name", async () => {
    const { get, pending } = await flaggedPending();

    const queue = await get("/booking-queue", "staff-1");
    const detail = await get(`/booking-queue/${pending.id}`, "staff-1");

    for (const item of [queue.body[0], detail.body]) {
      expect(item.flags).toMatchObject([
        { kind: "buffer_conflict", label: "Buffer conflict", otherEventName: "Summit A", otherPeriod: { date: "2030-11-15", startTime: "10:00", endTime: "12:00" } },
      ]);
    }
  });

  it("104-S4: if the flag appears after the service check, the database guard (CS104) is what refuses, as BOOKING_FLAGGED", async () => {
    const { bookings, pending } = await flaggedPending();
    await expect(bookings.decide(pending.id, { outcome: "approved" }, "staff-1", NOW)).rejects.toMatchObject({ code: "BOOKING_FLAGGED", httpStatus: 409 });
  });
});

describe("SCRUM-104/AC5 the flag clears when the conflict no longer exists (104-S5)", () => {
  it("104-S5: saving 15 and 15 resolves both flags and says nothing is affected", async () => {
    const { saveTiming, bookings } = setup();
    await saveTiming(30, 45);

    const res = await saveTiming(15, 15);

    expect(res.body.affected).toEqual([]);
    expect(res.body.message).toBe("No existing bookings are affected.");
    expect(bookings.openFlags()).toEqual([]);
    expect(bookings.flagRows.map((f) => f.resolvedReason)).toEqual(["no_longer_conflicts", "no_longer_conflicts"]);
  });

  it("104-S5: the request then approves normally", async () => {
    const { saveTiming, app, as, bookings } = setup();
    const pending = bookings.seed({ eventId: "event-b", venueId: "venue-1", start: new Date("2030-11-16T07:00:00Z"), end: new Date("2030-11-16T08:00:00Z") });
    bookings.seed({ eventId: "event-a", venueId: "venue-1", start: new Date("2030-11-16T06:30:00Z"), end: new Date("2030-11-16T06:45:00Z"), status: "approved" });
    await saveTiming(30, 45);
    expect(bookings.openFlags(pending.id)).toHaveLength(1);
    await saveTiming(0, 0);

    const res = await request(app).post(`/venue-bookings/${pending.id}/approve`).set("Cookie", as("staff-1"));

    expect(res.status).toBe(200);
  });
});

describe("SCRUM-104/AC6 no conflicts, no flags (104-S6)", () => {
  it("104-S6: times that clash with nothing flag nothing and say so", async () => {
    const { saveTiming, bookings } = setup();

    const res = await saveTiming(10, 10); // A occupies until 12:10, B from 12:20

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ affected: [], message: "No existing bookings are affected." });
    expect(bookings.flagRows).toEqual([]);
  });

  it("104-S6: a venue with no bookings at all is the same", async () => {
    const { saveTiming, bookings } = setup();
    bookings.rows.length = 0;
    expect((await saveTiming(60, 60)).body.message).toBe("No existing bookings are affected.");
  });
});

describe("SCRUM-104/AC1, AC5 which bookings can be flagged (104-S7, 104-S8)", () => {
  it("104-S7: touching padded periods (12:15 and 12:15) are not flagged", async () => {
    const { saveTiming, bookings } = setup();
    await saveTiming(15, 15);
    expect(bookings.flagRows).toEqual([]);
  });

  it("104-S7: a booking that already ended, and a rejected, withdrawn or cancelled one, is never flagged or a partner", async () => {
    const { saveTiming, bookings, summitB } = setup();
    for (const status of ["rejected", "withdrawn", "cancelled"]) {
      bookings.seed({ eventId: "event-a", venueId: "venue-1", ...A, status });
    }
    bookings.seed({ eventId: "event-a", venueId: "venue-1", start: new Date("2026-09-01T02:00:00Z"), end: new Date("2026-09-01T04:00:00Z"), status: "approved" });
    bookings.seed({ eventId: "event-a", venueId: "venue-1", start: new Date("2026-09-01T04:30:00Z"), end: new Date("2026-09-01T06:00:00Z"), status: "approved" });
    bookings.rows.splice(bookings.rows.indexOf(summitB), 1); // leave only the first approved Summit A of the future

    const res = await saveTiming(30, 45);

    expect(res.body.affected).toEqual([]);
    expect(bookings.flagRows).toEqual([]);
  });

  it("104-S8: cancelling a flagged booking resolves its flag and its partner's", async () => {
    const { saveTiming, bookings, summitA } = setup();
    await saveTiming(30, 45);

    await bookings.cancel(summitA.id, "coordinator-2", NOW, "Not needed");

    expect(bookings.openFlags()).toEqual([]);
    expect(bookings.flagRows.map((f) => f.resolvedReason)).toEqual(["booking_closed", "booking_closed"]);
  });

  it("104-S8: moving a flagged booking clear of the other resolves both", async () => {
    const { saveTiming, bookings, summitA } = setup();
    await saveTiming(30, 45);

    await bookings.change(summitA.id, { start: new Date("2030-11-14T00:00:00Z"), end: new Date("2030-11-14T01:00:00Z"), expectedAttendance: 10, venueRequirements: null }, NOW);

    expect(bookings.openFlags()).toEqual([]);
    expect(bookings.flagRows.every((f) => f.resolvedReason === "no_longer_conflicts")).toBe(true);
  });
});
