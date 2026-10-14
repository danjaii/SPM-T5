import request from "supertest";
import { describe, it, expect } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";
import { FakeBookingRepository } from "../support/fakeBookingRepository";
import { FakeEventReader, anEvent } from "../support/fakeEventReader";
import { FakeUserReader } from "../support/fakeUserReader";
import { FakeRoleReader, FakeVenueReader, aVenue } from "../support/fakeVenueAndRoles";

// ----------------------------------------------------------------------------
// Test setup: event-1 is assigned to coordinator-1; Orchid Hall holds 150, Lotus Room 40 (docs/specs/multiple-venue-bookings.md)
// ----------------------------------------------------------------------------

const NOW = new Date("2026-10-01T00:00:00.000Z");

/** Token "tok-<userId>" belongs to that user; anything else is unknown. */
const deps = {
  anon: {
    auth: {
      getUser: async (t: string) => ({ data: { user: t.startsWith("tok-") ? { id: t.slice(4) } : null } }),
    },
  },
  forUser: () => {
    throw new Error("ports are faked");
  },
} as unknown as SupabaseDeps;

function setup() {
  const bookings = new FakeBookingRepository(() => NOW);
  const events = new FakeEventReader([anEvent(), anEvent({ id: "event-2", assignedCoordinatorId: "coordinator-2" })]);
  const venues = new FakeVenueReader([aVenue(), aVenue({ id: "venue-2", name: "Lotus Room", maxCapacity: 40 })]);
  const roles = new FakeRoleReader({
    "coordinator-1": "event_coordinator",
    "coordinator-2": "event_coordinator",
    "organiser-1": "event_organiser",
    "staff-1": "venue_staff",
    "tech-1": "technical_support_staff",
    "attendee-1": "attendee",
  });
  const app = createApp(deps, { now: () => NOW, ports: () => ({ bookings, events, venues, roles, users: new FakeUserReader() }) });
  const list = (userId: string, eventId = "event-1") =>
    request(app).get(`/events/${eventId}/venue-bookings`).set("Cookie", `cs_session=tok-${userId}`);
  // 
  return { app, bookings, list };
}

/** A booking on 14 Nov 2030; `from` and `to` are UTC hours (Singapore is 8 hours ahead). */
const on14Nov = (from: number, to: number) => ({
  start: new Date(Date.UTC(2030, 10, 14, from)),
  end: new Date(Date.UTC(2030, 10, 14, to)),
});

// end of test setup

// ----------------------------------------------------------------------------
// SCRUM-98/AC5 an event with several bookings lists each one
// ----------------------------------------------------------------------------

describe("SCRUM-98/AC5 GET /events/:eventId/venue-bookings (98-S21 to 98-S23)", () => {
  it("98-S21 lists every booking of the event with venue, date, start, end, status and the capacity warning", async () => {
    const { bookings, list } = setup();
    // Orchid Hall 9am-5pm for 100 people (fits 150); Lotus Room 9am-12pm for 60 people (holds 40)
    bookings.seed({ eventId: "event-1", venueId: "venue-1", ...on14Nov(1, 9), status: "approved", snapshot: { eventName: "Summit B", expectedAttendance: 100, venueRequirements: "Theatre", accessibilityNeeds: null } });
    bookings.seed({ eventId: "event-1", venueId: "venue-2", ...on14Nov(1, 4), snapshot: { eventName: "Summit B", expectedAttendance: 60, venueRequirements: "Breakout", accessibilityNeeds: null } });

    const res = await list("coordinator-1");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({ venueId: "venue-1", venueName: "Orchid Hall", date: "2030-11-14", startTime: "09:00", endTime: "17:00", status: "APPROVED", expectedAttendance: 100, venueRequirements: "Theatre", exceedsCapacity: false }),
      expect.objectContaining({ venueId: "venue-2", venueName: "Lotus Room", date: "2030-11-14", startTime: "09:00", endTime: "12:00", status: "PENDING", expectedAttendance: 60, venueRequirements: "Breakout", exceedsCapacity: true }),
    ]);
  });

  // a third booking, so the order is clear: earliest start first, and for the same start the one requested first
  it("98-S21 orders the bookings by start time, then by when they were requested", async () => {
    const { bookings, list } = setup();
    const evening = bookings.seed({ eventId: "event-1", venueId: "venue-1", ...on14Nov(10, 12), createdAt: new Date("2026-09-01T00:00:00Z") });
    const morningLater = bookings.seed({ eventId: "event-1", venueId: "venue-2", ...on14Nov(1, 3), createdAt: new Date("2026-09-03T00:00:00Z") });
    const morningFirst = bookings.seed({ eventId: "event-1", venueId: "venue-1", ...on14Nov(1, 3), createdAt: new Date("2026-09-02T00:00:00Z") });

    const res = await list("coordinator-1");

    expect(res.body.map((b: { id: string }) => b.id)).toEqual([morningFirst.id, morningLater.id, evening.id]);
  });

  it("98-S22 an event with no bookings gives an empty list", async () => {
    const res = await setup().list("coordinator-1");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  // rejected and withdrawn bookings stay in the list, so the coordinator sees what happened; the reason is shown for a rejection
  it("98-S23 includes rejected and withdrawn bookings, with the rejection reason", async () => {
    const { bookings, list } = setup();
    bookings.seed({ eventId: "event-1", venueId: "venue-1", ...on14Nov(1, 3), status: "rejected", reviewNotes: "Under renovation" });
    bookings.seed({ eventId: "event-1", venueId: "venue-2", ...on14Nov(4, 6), status: "withdrawn" });

    const res = await list("coordinator-1");

    expect(res.body).toEqual([
      expect.objectContaining({ status: "REJECTED", rejectionReason: "Under renovation" }),
      expect.objectContaining({ status: "WITHDRAWN", rejectionReason: null }),
    ]);
  });

  it("98-S21 shows only this event's bookings, not another event's", async () => {
    const { bookings, list } = setup();
    bookings.seed({ eventId: "event-1", venueId: "venue-1", ...on14Nov(1, 3) });
    bookings.seed({ eventId: "event-2", venueId: "venue-2", ...on14Nov(1, 3) });

    const res = await list("coordinator-1");

    expect(res.body).toHaveLength(1);
    expect(res.body[0].venueId).toBe("venue-1");
  });

  it("98-S21 is not cached, so a fresh decision shows on reload", async () => {
    const res = await setup().list("coordinator-1");

    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

// ----------------------------------------------------------------------------
// SCRUM-98/AC6 only the event's assigned coordinator sees its bookings
// ----------------------------------------------------------------------------

describe("SCRUM-98/AC6 who may list an event's bookings (98-S27, 98-S28)", () => {
  it("98-S27 a coordinator the event is not assigned to gets 403", async () => {
    const { bookings, list } = setup();
    bookings.seed({ eventId: "event-1", venueId: "venue-1", ...on14Nov(1, 3) });

    const res = await list("coordinator-2");

    expect(res.status).toBe(403);
    expect(Object.keys(res.body).sort()).toEqual(["code", "error"]); // says nothing about the bookings
  });

  it.each(["organiser-1", "staff-1", "tech-1", "attendee-1", "ghost"])("98-S28 %s gets 403", async (userId) => {
    expect((await setup().list(userId)).status).toBe(403);
  });

  it("98-S28 no session gets 401", async () => {
    const { app } = setup();

    expect((await request(app).get("/events/event-1/venue-bookings")).status).toBe(401);
  });

  it("404 for an unknown event", async () => {
    expect((await setup().list("coordinator-1", "nope")).status).toBe(404);
  });
});
// end of SCRUM-98
