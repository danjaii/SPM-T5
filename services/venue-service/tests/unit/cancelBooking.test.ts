import request from "supertest";
import { describe, it, expect } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";
import { FakeBookingRepository } from "../support/fakeBookingRepository";
import { FakeEventReader, anEvent } from "../support/fakeEventReader";
import { FakeUserReader } from "../support/fakeUserReader";
import { FakeVenueDetailsReader } from "../support/fakeVenueDetails";
import { FakeRoleReader, FakeVenueReader, aVenue } from "../support/fakeVenueAndRoles";

// ----------------------------------------------------------------------------
// Test setup: event-1 (assigned to coordinator-1) has two venue bookings on 14 Nov 2030
// (docs/specs/change-cancel-venue-booking.md)
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

/** A period on 14 Nov 2030; `from` and `to` are UTC hours (Singapore is 8 hours ahead, so 1 is 9am). */
const on14Nov = (from: number, to: number) => ({
  start: new Date(Date.UTC(2030, 10, 14, from)),
  end: new Date(Date.UTC(2030, 10, 14, to)),
});

function setup() {
  const bookings = new FakeBookingRepository(() => NOW);
  const events = new FakeEventReader([anEvent()]);
  const venues = new FakeVenueReader([aVenue(), aVenue({ id: "venue-2", name: "Lotus Room" })]);
  const roles = new FakeRoleReader({
    "coordinator-1": "event_coordinator",
    "coordinator-2": "event_coordinator",
    "organiser-1": "event_organiser",
    "staff-1": "venue_staff",
    "tech-1": "technical_support_staff",
    "attendee-1": "attendee",
  });
  const app = createApp(deps, { now: () => NOW, ports: () => ({ bookings, events, venues, roles, users: new FakeUserReader(), venueDetails: FakeVenueDetailsReader.from(venues) }) });

  // Orchid Hall (venue-1) 9am-12pm and Lotus Room (venue-2) 9am-5pm, both waiting for venue staff
  const hall = bookings.seed({ eventId: "event-1", venueId: "venue-1", ...on14Nov(1, 4) });
  const room = bookings.seed({ eventId: "event-1", venueId: "venue-2", ...on14Nov(1, 9) });

  const cancel = (id: string, body: object = { reason: "Moved to a bigger room" }, userId = "coordinator-1") =>
    request(app).post(`/venue-bookings/${id}/cancel`).set("Cookie", `cs_session=tok-${userId}`).send(body);
  return { app, bookings, events, hall, room, cancel };
}

// end of test setup

// ----------------------------------------------------------------------------
// SCRUM-102/AC2 cancelling one venue booking cancels only that one
// ----------------------------------------------------------------------------

describe("SCRUM-102/AC2 cancel one venue booking (102-S11 to 102-S14)", () => {
  // a pending one, and one venue staff already approved: both can be cancelled
  // orchird hall venue booking is pending and then on approved (two runs), when we cancel it with reason, the reason is trimmed, and it can be cancelled showing who cancelled and when
  it.each(["requested", "approved"])("102-S12 cancelling a %s venue booking: 200, CANCELLED with the reason, who and when; the other is unchanged", async (status) => {
    const { cancel, hall, room } = setup();
    hall.status = status;
    const roomBefore = { ...room };

    const res = await cancel(hall.id, { reason: "  Moved to a bigger room  " });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: hall.id, status: "CANCELLED", cancellationReason: "Moved to a bigger room", cancelledBy: "coordinator-1", cancelledAt: NOW.toISOString() });
    expect(hall).toMatchObject({ status: "cancelled", cancellationReason: "Moved to a bigger room", cancelledBy: "coordinator-1", cancelledAt: NOW });
    expect(room).toEqual(roomBefore);
  });
  // cancelling orchied hall with no reason, or with only spaces, orwith more than 500 characters are rejected 
  it.each([
    ["no reason", {}, "Enter a reason for cancelling."],
    ["only spaces", { reason: "   " }, "Enter a reason for cancelling."],
    ["501 characters", { reason: "x".repeat(501) }, "The reason must be 500 characters or fewer."],
  ])("102-S13 cancelling with %s: 422 on reason, and nothing changes", async (_name, body, message) => {
    const { cancel, hall } = setup();
    const before = { ...hall };

    const res = await cancel(hall.id, body);

    expect(res.status).toBe(422);
    expect(res.body.fieldErrors).toEqual({ reason: message });
    expect(hall).toEqual(before);
  });

  // once cancelled, Orchid Hall 9am-12pm is free again: the event can ask for it afresh
  // after orchird hall is 9am to 12pm is cancelled, the coord rebooks the same thing again, and is approved 
  it("102-S14 after cancelling, a new request for that venue and period is accepted: 201", async () => {
    const { app, cancel, hall } = setup();
    await cancel(hall.id);

    const res = await request(app)
      .post("/venue-bookings")
      .set("Cookie", "cs_session=tok-coordinator-1")
      .send({ eventId: "event-1", venueId: "venue-1", date: "2030-11-14", startTime: "09:00", endTime: "12:00" });

    expect(res.status).toBe(201);
  });
  // orchied halls' venue booking is rejected, withdrawn or already cancelled. we cant cancel the venue booking 
  // a rejected, withdrawn or already cancelled venue booking is finished
  it.each(["rejected", "withdrawn", "cancelled"])("102-S11 cancelling a %s venue booking: 409 NOT_ACTIVE, and nothing changes", async (status) => {
    const { cancel, hall } = setup();
    hall.status = status;
    const before = { ...hall };

    const res = await cancel(hall.id);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NOT_ACTIVE");
    expect(hall).toEqual(before);
  });
  // we cannot cancel a venue booking that does not exist 
  // the status is checked before the reason, so the coordinator is told the real problem first
  it("102-S11 cancelling an already cancelled venue booking with no reason: NOT_ACTIVE, not a reason error", async () => {
    const { cancel, hall } = setup();
    hall.status = "cancelled";

    const res = await cancel(hall.id, {});

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NOT_ACTIVE");
  });

  it("a venue booking that does not exist: 404", async () => {
    expect((await setup().cancel("nope")).status).toBe(404);
  });
});
// end of SCRUM-102/AC2

// ----------------------------------------------------------------------------
// SCRUM-102/AC5 cancelling the last venue booking does not cancel the event
// ----------------------------------------------------------------------------
// the coord cancels lotus room and then cancels orchird hall, so event 1 has no active venue bookings
describe("SCRUM-102/AC5 the event itself is not cancelled (102-S20)", () => {
  // Orchid Hall and Lotus Room are both cancelled; event-1 must still be approved
  it("102-S20 cancelling the event's last remaining venue booking leaves the event's status as it was", async () => {
    const { cancel, events, hall, room } = setup();
    await cancel(room.id);

    const res = await cancel(hall.id);

    expect(res.status).toBe(200);
    expect((await events.getById("event-1"))?.status).toBe("approved");
  });
});
// end of SCRUM-102/AC5

// ----------------------------------------------------------------------------
// SCRUM-102/AC6 only the event's current assigned coordinator, while the event can still have venues
// ----------------------------------------------------------------------------
// coord 2 who is not assigned the event will not be able to cancel the venue 
describe("SCRUM-102/AC6 who may cancel a venue booking, and when (102-S21 to 102-S24)", () => {
  it("102-S21 a coordinator the event is not assigned to cannot cancel its venue booking: 403, and nothing changes", async () => {
    const { cancel, hall } = setup();
    const before = { ...hall };

    const res = await cancel(hall.id, undefined, "coordinator-2");

    expect(res.status).toBe(403);
    expect(Object.keys(res.body).sort()).toEqual(["code", "error"]);
    expect(hall).toEqual(before);
  });
  // an organiser, venue staff, tech sp, attendee and a user with no role cannot cancel a venue booking 
  it.each(["organiser-1", "staff-1", "tech-1", "attendee-1", "ghost"])("102-S22 %s cannot cancel a venue booking: 403", async (userId) => {
    const { cancel, hall } = setup();

    expect((await cancel(hall.id, undefined, userId)).status).toBe(403);
    expect(hall.status).toBe("requested");
  });
  //  venue staff try to cancel a venue booking that does not exist, and they get status 403
  // the role is checked first, so someone who may never cancel venue bookings learns nothing, not even whether one exists
  it("102-S22 venue staff cancelling a venue booking that does not exist: 403, not 404", async () => {
    expect((await setup().cancel("nope", undefined, "staff-1")).status).toBe(403);
  });
  // someone not signed in tries to access the cancel service but gets status 401
  it("102-S22 someone not signed in: 401", async () => {
    const { app, hall } = setup();

    expect((await request(app).post(`/venue-bookings/${hall.id}/cancel`).send({ reason: "x" })).status).toBe(401);
  });
  // event is confirmed, completed, cancelled, or submitted. we cannot cancel the venue booking 
  it.each(["confirmed", "completed", "cancelled", "submitted"])("102-S23 the event is %s: 409 EVENT_NOT_ELIGIBLE, and nothing changes", async (status) => {
    const { cancel, events, hall } = setup();
    events.add(anEvent({ status }));

    const res = await cancel(hall.id);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EVENT_NOT_ELIGIBLE");
    expect(hall.status).toBe("requested");
  });
  // event was moved to coord 2 instead, coord 2 can cancel the venue booking 
  // the Lead moved the event from coordinator-1 to coordinator-2 (SCRUM-79); Orchid Hall was requested by coordinator-1
  it("102-S24 the coordinator who took over the event can cancel a venue booking their predecessor made: 200", async () => {
    const { cancel, events, hall } = setup();
    hall.requestedBy = "coordinator-1";
    events.add(anEvent({ assignedCoordinatorId: "coordinator-2" }));

    const res = await cancel(hall.id, undefined, "coordinator-2");

    expect(res.status).toBe(200);
    expect(hall).toMatchObject({ status: "cancelled", cancelledBy: "coordinator-2" });
  });
  // coord 1 who is no longer assigned the event, cannot cancel venue booking 
  it("102-S21 the coordinator the event was moved away from cannot cancel the venue booking they made: 403", async () => {
    const { cancel, events, hall } = setup();
    hall.requestedBy = "coordinator-1";
    events.add(anEvent({ assignedCoordinatorId: "coordinator-2" }));

    expect((await cancel(hall.id)).status).toBe(403);
    expect(hall.status).toBe("requested");
  });
});
// end of SCRUM-102/AC6
