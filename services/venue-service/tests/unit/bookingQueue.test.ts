import request from "supertest";
import { describe, it, expect } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";
import { FakeBookingRepository } from "../support/fakeBookingRepository";
import { FakeEventReader, anEvent } from "../support/fakeEventReader";
import { FakeUserReader } from "../support/fakeUserReader";
import { FakeRoleReader, FakeVenueReader, aVenue } from "../support/fakeVenueAndRoles";

const deps = {
  anon: { auth: { getUser: async (t: string) => ({ data: { user: t.startsWith("tok-") ? { id: t.slice(4) } : null } }) } },
  forUser: () => {
    throw new Error("ports are faked");
  },
} as unknown as SupabaseDeps;

const at = (hour: number) => new Date(Date.UTC(2026, 9, 1, hour)); // submission times on 1 Oct 2026
const slot = (day: number) => ({ start: new Date(`2030-11-${day}T01:00:00Z`), end: new Date(`2030-11-${day}T09:00:00Z`) });

function setup() {
  let clock = at(0);
  const bookings = new FakeBookingRepository(() => clock);
  const events = new FakeEventReader([anEvent({ id: "event-1" })]);
  const venues = new FakeVenueReader([aVenue(), aVenue({ id: "venue-2", name: "Lotus Room" })]);
  const roles = new FakeRoleReader({
    "staff-1": "venue_staff",
    "coordinator-1": "event_coordinator",
    "organiser-1": "event_organiser",
    "tech-1": "technical_support_staff",
    "attendee-1": "attendee",
  });
  const users = new FakeUserReader({ "coordinator-1": "Casey Coordinator", "staff-1": "Sam Staff" });
  const app = createApp(deps, { ports: () => ({ bookings, events, venues, roles, users }) });
  const get = (path: string, user = "staff-1") => request(app).get(path).set("Cookie", `cs_session=tok-${user}`);
  return { bookings, get, app, setClock: (h: number) => (clock = at(h)) };
}

describe("SCRUM-37/AC1 the queue lists pending requests with their event details (37-S1)", () => {
  it("37-S1 lists all pending requests across venues with every field, from the snapshot", async () => {
    const { bookings, get, setClock } = setup();
    setClock(9);
    bookings.seed({
      eventId: "event-1",
      venueId: "venue-1",
      ...slot(14),
      requestedBy: "coordinator-1",
      snapshot: { eventName: "Summit A", expectedAttendance: 80, venueRequirements: "Projector", accessibilityNeeds: "Ramp" },
    });
    setClock(10);
    bookings.seed({ eventId: "event-2", venueId: "venue-2", ...slot(15), requestedBy: "coordinator-1" });
    setClock(11);
    bookings.seed({ eventId: "event-3", venueId: "venue-2", ...slot(16), requestedBy: "unknown-user" });

    const res = await get("/booking-queue");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toHaveLength(3);
    // The event was edited since (its name is "Summit B" now): the queue shows what was requested (DR8).
    expect(res.body[0]).toEqual({
      id: "booking-1",
      venueId: "venue-1",
      venueName: "Orchid Hall",
      date: "2030-11-14",
      startTime: "09:00",
      endTime: "17:00",
      eventName: "Summit A",
      expectedAttendance: 80,
      venueRequirements: "Projector",
      accessibilityNeeds: "Ramp",
      requestedByName: "Casey Coordinator",
      submittedAt: at(9).toISOString(),
      amendsRequestId: null,
    });
    expect(res.body.map((r: { venueName: string }) => r.venueName)).toEqual(["Orchid Hall", "Lotus Room", "Lotus Room"]);
    expect(res.body[2].requestedByName).toBeNull();
  });
});

describe("SCRUM-37/AC2 first come, first served (37-S2)", () => {
  it("37-S2 orders by submission time, and equal times by id ascending", async () => {
    const { bookings, get, setClock } = setup();
    setClock(11);
    bookings.seed({ id: "c", eventId: "event-1", venueId: "venue-1", ...slot(14) });
    setClock(9);
    bookings.seed({ id: "z", eventId: "event-2", venueId: "venue-1", ...slot(15) });
    setClock(10);
    bookings.seed({ id: "b", eventId: "event-3", venueId: "venue-1", ...slot(16) });
    bookings.seed({ id: "a", eventId: "event-4", venueId: "venue-1", ...slot(17) });

    const res = await get("/booking-queue");
    expect(res.body.map((r: { id: string }) => r.id)).toEqual(["z", "a", "b", "c"]);
  });
});

describe("SCRUM-37/AC3 decided and withdrawn requests leave the queue (37-S3)", () => {
  it("37-S3 lists only PENDING requests", async () => {
    const { bookings, get } = setup();
    for (const [i, status] of (["approved", "rejected", "withdrawn", "cancelled"] as const).entries()) {
      bookings.seed({ eventId: `event-${i}`, venueId: "venue-1", ...slot(14 + i), status });
    }
    const pending = bookings.seed({ eventId: "event-9", venueId: "venue-1", ...slot(20) });

    const res = await get("/booking-queue");
    expect(res.body.map((r: { id: string }) => r.id)).toEqual([pending.id]);
  });
});

describe("SCRUM-37/AC4 amended requests (37-S4)", () => {
  it("37-S4 lists the amendment at its own submission time and says which request it amends", async () => {
    const { bookings, get, setClock } = setup();
    setClock(9);
    const r1 = bookings.seed({ eventId: "event-1", venueId: "venue-1", ...slot(14), status: "rejected" });
    setClock(12);
    const r2 = bookings.seed({ eventId: "event-1", venueId: "venue-2", ...slot(15), amendsBookingId: r1.id });

    const res = await get("/booking-queue");
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: r2.id, amendsRequestId: r1.id, submittedAt: at(12).toISOString() });
  });
});

describe("SCRUM-37/AC5 empty queue (37-S5)", () => {
  it("37-S5 returns 200 with an empty list, not an error", async () => {
    const { get } = setup();
    const res = await get("/booking-queue");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("SCRUM-37/AC6 request detail (37-S6)", () => {
  it("37-S6 a pending request shows everything in the queue plus its status", async () => {
    const { bookings, get, setClock } = setup();
    setClock(9);
    const r1 = bookings.seed({ eventId: "event-1", venueId: "venue-1", ...slot(14), status: "rejected" });
    setClock(10);
    const r2 = bookings.seed({
      eventId: "event-1",
      venueId: "venue-2",
      ...slot(15),
      requestedBy: "coordinator-1",
      amendsBookingId: r1.id,
    });

    const res = await get(`/booking-queue/${r2.id}`);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toMatchObject({
      id: r2.id,
      venueName: "Lotus Room",
      date: "2030-11-15",
      startTime: "09:00",
      endTime: "17:00",
      eventName: "Seeded event",
      requestedByName: "Casey Coordinator",
      submittedAt: at(10).toISOString(),
      amendsRequestId: r1.id,
      status: "PENDING",
      decidedByName: null,
      decidedAt: null,
      rejectionReason: null,
      suggestion: null,
    });
  });

  it("37-S6 a decided request shows who decided, when, and the rejection reason", async () => {
    const { bookings, get } = setup();
    const decidedAt = new Date("2026-10-05T03:00:00Z");
    const rejected = bookings.seed({
      eventId: "event-1",
      venueId: "venue-1",
      ...slot(14),
      status: "rejected",
      reviewedBy: "staff-1",
      reviewedAt: decidedAt,
      reviewNotes: "Under maintenance",
    });
    const approved = bookings.seed({
      eventId: "event-2",
      venueId: "venue-1",
      ...slot(15),
      status: "approved",
      reviewedBy: "staff-1",
      reviewedAt: decidedAt,
      reviewNotes: "ignored",
    });

    expect((await get(`/booking-queue/${rejected.id}`)).body).toMatchObject({
      status: "REJECTED",
      decidedByName: "Sam Staff",
      decidedAt: decidedAt.toISOString(),
      rejectionReason: "Under maintenance",
    });
    expect((await get(`/booking-queue/${approved.id}`)).body).toMatchObject({
      status: "APPROVED",
      decidedByName: "Sam Staff",
      rejectionReason: null,
    });
  });

  it("37-S6 an unknown id returns 404", async () => {
    const { get } = setup();
    const res = await get("/booking-queue/nope");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });
});

describe("SCRUM-37/AC7 only Venue Staff may open the queue (37-S7)", () => {
  it.each(["organiser-1", "coordinator-1", "tech-1", "attendee-1"])(
    "37-S7 %s gets 403 on the queue and on a detail",
    async (user) => {
      const { bookings, get } = setup();
      const row = bookings.seed({ eventId: "event-1", venueId: "venue-1", ...slot(14) });
      expect((await get("/booking-queue", user)).status).toBe(403);
      expect((await get(`/booking-queue/${row.id}`, user)).status).toBe(403);
      // The role check comes before the lookup, so an unknown id is 403 too, not 404.
      expect((await get("/booking-queue/nope", user)).status).toBe(403);
    },
  );

  it("37-S7 a caller with no role row is refused", async () => {
    const { get } = setup();
    expect((await get("/booking-queue", "stranger")).status).toBe(403);
  });

  it("37-S7 no session is 401", async () => {
    const { app } = setup();
    expect((await request(app).get("/booking-queue")).status).toBe(401);
    expect((await request(app).get("/booking-queue/x")).status).toBe(401);
  });
});
