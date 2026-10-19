import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { EventInfo } from "../../src/readers/eventReader";
import {
  FakeEquipmentReader,
  FakeEquipmentRequestReader,
  FakeEquipmentRequestReviewer,
  FakeEquipmentRequestWriter,
  FakeEventReader,
  FakeReservationReader,
  FakeReservationWriter,
  FakeVenueBookingReader,
  aVenueBooking,
  anEvent,
  fakeDeps,
  fakeRoles,
} from "../support/fakes";
import { FakeTechnicalAssignmentStore, anAssignment } from "../support/fakeTechnicalAssignments";

/**
 * SCRUM-20: the event's coordinator assigns, changes and cancels on-site technical support
 * (docs/specs/technical-assignment-notifications.md). The database functions check it all again and write the
 * technician's notifications (migration 41; tests/integration/technicalAssignments.test.ts); these cover the routes.
 */

// ----------------------------------------------------------------------------
// Test setup: coord-1 coordinates "DevOps Summit" (evt-devops), which has two approved venue bookings (Grand Hall and
// Lotus Room), a Pending one, and Aaron Koh assigned to the Grand Hall on 15 Oct 2026, 08:00 to 17:00 Singapore time.
// ----------------------------------------------------------------------------

function setup({ events = [anEvent()] as EventInfo[], rows = [anAssignment()] } = {}) {
  const store = new FakeTechnicalAssignmentStore(rows);
  const app = createApp(fakeDeps, {
    ports: () => ({
      events: new FakeEventReader(events),
      equipment: new FakeEquipmentReader(),
      reservations: new FakeReservationReader(),
      roles: fakeRoles(),
      writer: new FakeReservationWriter(),
      venueBookings: new FakeVenueBookingReader([
        aVenueBooking(),
        aVenueBooking({ id: "vb-lotus", venueName: "Lotus Room", start: new Date("2026-10-15T05:00:00Z") }),
        aVenueBooking({ id: "vb-pending", venueName: "Orchid Hall", status: "requested" }),
        aVenueBooking({ id: "vb-other", eventId: "evt-other", venueName: "Other Hall" }),
      ]),
      requests: new FakeEquipmentRequestReader(),
      requestWriter: new FakeEquipmentRequestWriter(),
      reviewer: new FakeEquipmentRequestReviewer(),
    }),
    assignments: () => store,
  });
  const as = (user: string | null, req: request.Test) => (user ? req.set("Cookie", `cs_session=tok-${user}`) : req);
  return {
    store,
    list: (user: string | null = "coord-1", eventId = "evt-devops") =>
      as(user, request(app).get(`/events/${eventId}/technical-assignments`)),
    assign: (body: object, user: string | null = "coord-1", eventId = "evt-devops") =>
      as(user, request(app).post(`/events/${eventId}/technical-assignments`).send(body)),
    change: (body: object, id = "asg-1", user: string | null = "coord-1") =>
      as(user, request(app).patch(`/technical-assignments/${id}`).send(body)),
    cancel: (body: object, id = "asg-1", user: string | null = "coord-1") =>
      as(user, request(app).post(`/technical-assignments/${id}/cancel`).send(body)),
  };
}

/** The assign form filled in: Vanessa Lee in the Lotus Room, 15 Oct 2026, 12:00 to 18:00. */
const form = {
  staffId: "tech-2",
  venueBookingId: "vb-lotus",
  startDate: "2026-10-15",
  startTime: "12:00",
  endDate: "2026-10-15",
  endTime: "18:00",
  note: "Mic checks",
};

/** Aaron Koh's assignment as the API returns it. */
const AARON = {
  id: "asg-1",
  staffId: "tech-1",
  staffName: "Aaron Koh",
  venueBookingId: "vb-hall",
  venueName: "Grand Hall",
  startDate: "2026-10-15",
  startTime: "08:00",
  endDate: "2026-10-15",
  endTime: "17:00",
  note: "Livestream desk",
  status: "ASSIGNED",
  statusLabel: "Assigned",
  acknowledgedAt: null,
  cancelledAt: null,
  cancellationReason: null,
};

// end of test setup

describe("SCRUM-20/AC5 GET /events/:id/technical-assignments (20-S10, 20-S12)", () => {
  it("20-S10: lists the event's assignments, the technicians to choose from and the approved venue bookings", async () => {
    const res = await setup().list();

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({
      assignments: [AARON],
      canAssign: true,
      staff: [
        { id: "tech-1", name: "Aaron Koh" },
        { id: "tech-2", name: "Vanessa Lee" },
      ],
      venues: [
        { id: "vb-hall", venueName: "Grand Hall", date: "2026-10-15", startTime: "09:00", endTime: "17:00" },
        { id: "vb-lotus", venueName: "Lotus Room", date: "2026-10-15", startTime: "13:00", endTime: "17:00" },
      ],
    });
  });

  it("20-S10: an acknowledged one says when; a cancelled one says why", async () => {
    const rows = [
      anAssignment({ acknowledgedAt: new Date("2026-10-14T03:00:00Z") }),
      anAssignment({ id: "asg-2", cancelledAt: new Date("2026-10-14T04:00:00Z"), cancellationReason: "Moved online" }),
    ];

    const res = await setup({ rows }).list();

    expect(res.body.assignments[0]).toMatchObject({ status: "ACKNOWLEDGED", statusLabel: "Acknowledged", acknowledgedAt: "2026-10-14T03:00:00.000Z" });
    expect(res.body.assignments[1]).toMatchObject({
      status: "CANCELLED",
      statusLabel: "Cancelled",
      cancelledAt: "2026-10-14T04:00:00.000Z",
      cancellationReason: "Moved online",
    });
  });

  it("20-S2: only the event's assigned coordinator; anyone else 403, an unknown event 404, no session 401", async () => {
    const s = setup();
    expect((await s.list("coord-2")).status).toBe(403);
    expect((await s.list("tech-1")).status).toBe(403);
    expect((await s.list("coord-1", "evt-missing")).status).toBe(404);
    expect((await s.list(null)).status).toBe(401);
  });

  it("20-S2: someone recorded as the event's coordinator whose role is no longer Event Coordinator is refused", async () => {
    // for example a coordinator promoted to Lead, still named on the event
    const s = setup({ events: [anEvent({ assignedCoordinatorId: "event_coordinator_lead-user" })] });

    expect((await s.list("event_coordinator_lead-user")).status).toBe(403);
    expect((await s.assign(form, "event_coordinator_lead-user")).status).toBe(403);
    expect(s.store.writes).toEqual([]);
  });

  it("20-S2: a completed event still lists its assignments but cannot take new ones", async () => {
    const res = await setup({ events: [anEvent({ status: "completed" })] }).list();

    expect(res.body.canAssign).toBe(false);
    expect(res.body.assignments).toHaveLength(1);
  });
});

describe("SCRUM-20/AC1 POST /events/:id/technical-assignments (20-S1, 20-S2, 20-S3)", () => {
  it("20-S1: assigns the technician to the venue booking for the period, and returns the assignment", async () => {
    const { assign, store } = setup();

    const res = await assign(form);

    expect(res.status).toBe(201);
    expect(store.writes).toEqual([
      {
        op: "assign",
        args: [
          "evt-devops",
          { staffId: "tech-2", venueBookingId: "vb-lotus", start: "2026-10-15T04:00:00.000Z", end: "2026-10-15T10:00:00.000Z", note: "Mic checks" },
        ],
      },
    ]);
    expect(res.body).toMatchObject({ staffName: "Vanessa Lee", venueName: "Lotus Room", startTime: "12:00", endTime: "18:00", status: "ASSIGNED" });
  });

  it("20-S12: missing or badly written fields are 422 with a message for each, and nothing is saved", async () => {
    const { assign, store } = setup();

    const res = await assign({ ...form, staffId: "", endTime: "11:00" });

    expect(res.status).toBe(422);
    expect(Object.keys(res.body.fieldErrors)).toEqual(["staffId"]);
    expect(store.writes).toEqual([]);
  });

  it("20-S2: someone not on the technician list, or a venue booking that is Pending or another event's, is 422", async () => {
    const { assign, store } = setup();

    expect((await assign({ ...form, staffId: "coord-2" })).body.fieldErrors).toHaveProperty("staffId");
    expect((await assign({ ...form, venueBookingId: "vb-pending" })).body.fieldErrors).toHaveProperty("venueBookingId");
    expect((await assign({ ...form, venueBookingId: "vb-other" })).body.fieldErrors).toHaveProperty("venueBookingId");
    expect(store.writes).toEqual([]);
  });

  it("20-S2: another coordinator is 403 and a completed event 409 EVENT_LOCKED, before anything is saved", async () => {
    expect((await setup().assign(form, "coord-2")).status).toBe(403);
    const locked = setup({ events: [anEvent({ status: "completed" })] });
    const res = await locked.assign(form);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EVENT_LOCKED");
    expect(locked.store.writes).toEqual([]);
  });

  it("20-S3: the database's refusals come back as clear answers", async () => {
    const cases: [string, number, string][] = [
      ["23505", 409, "ALREADY_ASSIGNED"],
      ["42501", 403, "FORBIDDEN"],
      ["CS112", 409, "EVENT_LOCKED"],
      ["22023", 422, "VALIDATION_FAILED"],
    ];
    for (const [code, status, apiCode] of cases) {
      const s = setup();
      s.store.refuse = { code, message: "refused" };
      const res = await s.assign(form);
      expect([res.status, res.body.code]).toEqual([status, apiCode]);
    }
  });

  it("20-S3: an unexpected database error is a plain 500", async () => {
    const s = setup();
    s.store.refuse = { code: "XX000", message: "boom" };
    expect((await s.assign(form)).status).toBe(500);
  });
});

describe("SCRUM-20/AC2 PATCH /technical-assignments/:id (20-S4, 20-S7)", () => {
  it("20-S4: changes the venue booking, times and note, keeping the technician", async () => {
    const { change, store } = setup();

    const res = await change({ ...form, staffId: "tech-2" });

    expect(res.status).toBe(200);
    expect(store.writes).toEqual([
      {
        op: "change",
        args: ["asg-1", { venueBookingId: "vb-lotus", start: "2026-10-15T04:00:00.000Z", end: "2026-10-15T10:00:00.000Z", note: "Mic checks" }],
      },
    ]);
    expect(res.body).toMatchObject({ staffName: "Aaron Koh", venueName: "Lotus Room", startTime: "12:00" });
  });

  it("20-S7: a cancelled assignment is 409 ASSIGNMENT_CANCELLED, and nothing is saved", async () => {
    const s = setup({ rows: [anAssignment({ cancelledAt: new Date(), cancellationReason: "x" })] });

    const res = await s.change(form);

    expect([res.status, res.body.code]).toEqual([409, "ASSIGNMENT_CANCELLED"]);
    expect(s.store.writes).toEqual([]);
  });

  it("20-S4: an unknown assignment 404, another coordinator 403, bad fields 422", async () => {
    const s = setup();
    expect((await s.change(form, "asg-missing")).status).toBe(404);
    expect((await s.change(form, "asg-1", "coord-2")).status).toBe(403);
    expect((await s.change({ ...form, venueBookingId: "vb-pending" })).status).toBe(422);
    expect(s.store.writes).toEqual([]);
  });
});

describe("SCRUM-20/AC3 POST /technical-assignments/:id/cancel (20-S6, 20-S7)", () => {
  it("20-S6: cancels with the reason and returns it Cancelled", async () => {
    const { cancel, store } = setup();

    const res = await cancel({ reason: "  Event moved online " });

    expect(res.status).toBe(200);
    expect(store.writes).toEqual([{ op: "cancel", args: ["asg-1", "Event moved online"] }]);
    expect(res.body).toMatchObject({ status: "CANCELLED", cancellationReason: "Event moved online" });
  });

  it("20-S6: no reason is 422; already cancelled is 409; another coordinator 403; nothing saved", async () => {
    const s = setup();
    expect((await s.cancel({ reason: " " })).body.fieldErrors).toHaveProperty("reason");
    expect((await s.cancel({ reason: "x" }, "asg-1", "coord-2")).status).toBe(403);
    expect(s.store.writes).toEqual([]);
    const cancelled = setup({ rows: [anAssignment({ cancelledAt: new Date() })] });
    expect((await cancelled.cancel({ reason: "x" })).body.code).toBe("ASSIGNMENT_CANCELLED");
  });

  it("20-S7: losing a race to another cancel (CS020) is also 409 ASSIGNMENT_CANCELLED", async () => {
    const s = setup();
    s.store.refuse = { code: "CS020", message: "ASSIGNMENT_CANCELLED" };

    expect((await s.cancel({ reason: "x" })).body.code).toBe("ASSIGNMENT_CANCELLED");
  });
});
