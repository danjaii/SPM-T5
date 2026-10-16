import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";
import { FakeBookingRepository } from "../support/fakeBookingRepository";
import { FakeEventReader, anEvent } from "../support/fakeEventReader";
import { FakeUserReader } from "../support/fakeUserReader";
import { FakeRoleReader, FakeVenueReader, aVenue } from "../support/fakeVenueAndRoles";

/**
 * SCRUM-113/AC3: a venue booking sent back for review after an important event change (migration 39) shows Venue Staff
 * what changed, and the coordinator sees it is waiting for review again (docs/specs/send-back-affected-arrangements.md).
 * The database stores the note and clears it on the next decision (event-service tests/integration/sendBackDb.test.ts);
 * these cover how venue-service shows it.
 */

// ----------------------------------------------------------------------------
// Test setup: event-1 is assigned to coordinator-1; Orchid Hall; the room layouts Theatre and Banquet
// ----------------------------------------------------------------------------

const deps = {
  anon: { auth: { getUser: async (t: string) => ({ data: { user: t.startsWith("tok-") ? { id: t.slice(4) } : null } }) } },
  forUser: () => {
    throw new Error("ports are faked");
  },
} as unknown as SupabaseDeps;

const NOW = new Date("2030-10-01T00:00:00.000Z");
const SENT_BACK_AT = new Date("2030-10-02T03:00:00.000Z");
const slot = { start: new Date("2030-11-14T02:00:00Z"), end: new Date("2030-11-14T04:00:00Z") };

/** The note migration 39 stores: attendance 480 to 600, the layout Theatre to Banquet, and the name (not shown). */
const NOTE = {
  name: { from: "Summit", to: "Summit 2030" },
  expected_attendance: { from: 480, to: 600 },
  preferred_room_layout_id: { from: "layout-theatre", to: "layout-banquet" },
};

function setup() {
  const bookings = new FakeBookingRepository(() => NOW);
  const events = new FakeEventReader([anEvent()]);
  const venues = new FakeVenueReader([aVenue()], { "layout-theatre": "Theatre", "layout-banquet": "Banquet" });
  const roles = new FakeRoleReader({ "staff-1": "venue_staff", "coordinator-1": "event_coordinator" });
  const app = createApp(deps, { now: () => NOW, ports: () => ({ bookings, events, venues, roles, users: new FakeUserReader() }) });
  const get = (path: string, user = "staff-1") => request(app).get(path).set("Cookie", `cs_session=tok-${user}`);
  const sentBack = () =>
    bookings.seed({ eventId: "event-1", venueId: "venue-1", ...slot, sentBackChanges: NOTE, sentBackAt: SENT_BACK_AT });
  const notSentBack = () => bookings.seed({ eventId: "event-1", venueId: "venue-1", start: slot.end, end: new Date("2030-11-14T06:00:00Z") });
  return { get, sentBack, notSentBack };
}

/** What Venue Staff are shown: the important changes only, the layout by name. */
const SHOWN = {
  sentBackAt: SENT_BACK_AT.toISOString(),
  changes: [
    { field: "expected_attendance", label: "Expected attendance", from: 480, to: 600 },
    { field: "preferred_room_layout_id", label: "Room layout", from: "Theatre", to: "Banquet" },
  ],
};

// end of test setup

describe("SCRUM-113/AC3 Venue Staff see what changed on a venue booking sent back for review", () => {
  it("113-S7: the queue item carries what changed and when", async () => {
    const { get, sentBack, notSentBack } = setup();
    sentBack();
    notSentBack();

    const res = await get("/booking-queue");

    expect(res.status).toBe(200);
    expect(res.body[0].sentBack).toEqual(SHOWN);
    expect(res.body[1].sentBack).toBeNull();
  });

  it("113-S7: the request's own page carries it too", async () => {
    const { get, sentBack } = setup();
    const booking = sentBack();

    const res = await get(`/booking-queue/${booking.id}`);

    expect(res.status).toBe(200);
    expect(res.body.sentBack).toEqual(SHOWN);
  });
});

describe("SCRUM-113/AC1 the coordinator sees a venue booking waiting for review again (113-S14)", () => {
  it("113-S14: the event's venue bookings mark the one sent back", async () => {
    const { get, sentBack, notSentBack } = setup();
    sentBack();
    notSentBack();

    const res = await get("/events/event-1/venue-bookings", "coordinator-1");

    expect(res.status).toBe(200);
    expect(res.body.map((b: { sentBackForReview: boolean }) => b.sentBackForReview)).toEqual([true, false]);
  });
});
