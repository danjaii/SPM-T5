import { EQUIPMENT_REQUEST_REVIEW_MESSAGES, ROLES } from "@spm-t5/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { EquipmentRequestInfo } from "../../src/readers/equipmentRequestReader";
import type { EventInfo } from "../../src/readers/eventReader";
import type { ReviewOutcome } from "../../src/writers/equipmentRequestWriter";
import {
  FakeEquipmentReader,
  FakeEquipmentRequestReader,
  FakeEquipmentRequestReviewer,
  FakeEquipmentRequestWriter,
  FakeEventReader,
  FakeReservationReader,
  FakeReservationWriter,
  FakeVenueBookingReader,
  anEquipmentRequest,
  anEvent,
  fakeDeps,
  fakeRoles,
} from "../support/fakes";

// ----------------------------------------------------------------------------
// Test setup: the app with fake data. tech-1 is Technical Support Staff; coord-1 is the assigned coordinator of
// "evt-devops" (see fakes.ts). `stored` is shared by the reader and the reviewer, so a saved change shows up.
// ----------------------------------------------------------------------------

function setup({
  stored = [anEquipmentRequest()],
  events = [anEvent()],
  outcome,
}: { stored?: EquipmentRequestInfo[]; events?: EventInfo[]; outcome?: ReviewOutcome } = {}) {
  const reviewer = new FakeEquipmentRequestReviewer(outcome, stored);
  const app = createApp(fakeDeps, {
    ports: () => ({
      events: new FakeEventReader(events),
      equipment: new FakeEquipmentReader(),
      reservations: new FakeReservationReader(),
      roles: fakeRoles(),
      writer: new FakeReservationWriter(),
      venueBookings: new FakeVenueBookingReader(),
      requests: new FakeEquipmentRequestReader(stored),
      requestWriter: new FakeEquipmentRequestWriter(),
      reviewer,
    }),
  });
  const as = (user: string | null, req: request.Test) => (user ? req.set("Cookie", `cs_session=tok-${user}`) : req);
  return {
    reviewer,
    queue: (user: string | null = "tech-1") => as(user, request(app).get("/equipment-requests")),
    detail: (id = "req-1", user: string | null = "tech-1") => as(user, request(app).get(`/equipment-requests/${id}`)),
    review: (body: Record<string, unknown>, id = "req-1", user: string | null = "tech-1") =>
      as(user, request(app).patch(`/equipment-requests/${id}`).send(body)),
    eventRequests: (user = "coord-1") => as(user, request(app).get("/events/evt-devops/equipment-requests")),
  };
}

// end of test setup

describe("SCRUM-87/AC1 see the list of requests", () => {
  it("lists Submitted and Under Review requests with event, date, venue, equipment, quantity and status", async () => {
    const res = await setup().queue();
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: "req-1",
        eventId: "evt-devops",
        eventName: "DevOps Summit",
        eventDate: "2026-10-15",
        venueName: "Grand Hall",
        equipment: "AV: Projector Unit",
        quantity: 2,
        status: "SUBMITTED",
        statusLabel: "Submitted",
      },
    ]);
  });

  it("puts the soonest event first, then the oldest request", async () => {
    const { queue } = setup({
      stored: [
        anEquipmentRequest({ id: "later-event", eventStart: new Date("2026-11-01T01:00:00Z") }),
        anEquipmentRequest({ id: "same-day-newer", createdAt: new Date("2026-10-05T00:00:00Z") }),
        anEquipmentRequest({ id: "same-day-older", status: "under_review", createdAt: new Date("2026-10-02T00:00:00Z") }),
        // An event with no date yet is placed by the request's own period (15 Oct 2026 here).
        anEquipmentRequest({ id: "no-event-date", eventStart: null, createdAt: new Date("2026-10-09T00:00:00Z") }),
      ],
    });
    const res = await queue();
    expect(res.body.map((r: { id: string }) => r.id)).toEqual(["same-day-older", "same-day-newer", "no-event-date", "later-event"]);
    expect(res.body[0].statusLabel).toBe("Under Review");
  });

  it("leaves out Arranged, Cannot Fulfil and cancelled requests", async () => {
    const { queue } = setup({
      stored: ["approved", "reserved", "rejected", "cancelled"].map((status, i) => anEquipmentRequest({ id: `r${i}`, status })),
    });
    expect((await queue()).body).toEqual([]);
  });

  it("decision: leaves out requests for a completed, cancelled or rejected event", async () => {
    const { queue } = setup({
      stored: ["completed", "cancelled", "rejected", "planning"].map((eventStatus) => anEquipmentRequest({ id: eventStatus, eventStatus })),
    });
    expect((await queue()).body.map((r: { id: string }) => r.id)).toEqual(["planning"]);
  });

  it("shows a request with no venue as such", async () => {
    const res = await setup({ stored: [anEquipmentRequest({ venueName: null })] }).queue();
    expect(res.body[0].venueName).toBeNull();
  });
});

describe("SCRUM-87/AC2 empty list", () => {
  it("answers an empty list when nothing is waiting (the page shows the spec's message)", async () => {
    const res = await setup({ stored: [] }).queue();
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(EQUIPMENT_REQUEST_REVIEW_MESSAGES.queueEmpty).toBe("No requests waiting for action");
  });
});

describe("SCRUM-87/AC3 see request details", () => {
  it("shows event name, event date, start and end time, venue, equipment, quantity, notes and status", async () => {
    const res = await setup({ stored: [anEquipmentRequest({ notes: "Two on stage" })] }).detail();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: "req-1",
      eventId: "evt-devops",
      eventName: "DevOps Summit",
      eventDate: "2026-10-15",
      venueName: "Grand Hall",
      equipment: "AV: Projector Unit",
      quantity: 2,
      status: "SUBMITTED",
      statusLabel: "Submitted",
      startTime: "09:00",
      endTime: "17:00",
      notes: "Two on stage",
      reason: null,
      canReview: true,
    });
  });

  it("opens a request that is no longer waiting, which can then not be changed", async () => {
    const res = await setup({ stored: [anEquipmentRequest({ status: "rejected", reviewReason: "All out on loan" })] }).detail();
    expect(res.body).toMatchObject({ statusLabel: "Cannot Fulfil", reason: "All out on loan", canReview: false });
  });

  it("a request for a finished event cannot be changed", async () => {
    const res = await setup({ stored: [anEquipmentRequest({ eventStatus: "completed" })] }).detail();
    expect(res.body.canReview).toBe(false);
  });

  it("a request that does not exist, or was cancelled, is a 404", async () => {
    const { detail } = setup({ stored: [anEquipmentRequest({ id: "gone", status: "cancelled" })] });
    expect((await detail("missing")).status).toBe(404);
    expect((await detail("gone")).status).toBe(404);
  });
});

describe("SCRUM-87/AC4 update the status", () => {
  it.each([
    ["UNDER_REVIEW", "under_review", "Under Review"],
    ["ARRANGED", "approved", "Arranged"],
  ])("saves %s and answers with the updated request", async (status, dbStatus, label) => {
    const { review, reviewer } = setup();
    const res = await review({ status, reason: "ignored unless Cannot Fulfil" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "req-1", statusLabel: label, reason: null });
    expect(reviewer.reviewed).toEqual([{ requestId: "req-1", dbStatus, reason: null }]);
  });

  it("an Under Review request can be changed again", async () => {
    const { review } = setup({ stored: [anEquipmentRequest({ status: "under_review" })] });
    expect((await review({ status: "ARRANGED" })).body.statusLabel).toBe("Arranged");
  });

  it("the coordinator sees the new status on the event", async () => {
    const { review, eventRequests } = setup();
    await review({ status: "UNDER_REVIEW" });
    expect((await eventRequests()).body.requests[0].statusLabel).toBe("Under Review");
  });

  it("refuses a status that is not one of the three choices (422)", async () => {
    const { review, reviewer } = setup();
    for (const status of [undefined, "", "SUBMITTED", "approved"]) {
      const res = await review({ status });
      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ status: EQUIPMENT_REQUEST_REVIEW_MESSAGES.statusMissing });
    }
    expect(reviewer.reviewed).toEqual([]);
  });

  it("refuses a request that is already Arranged or Cannot Fulfil (409), and changes nothing", async () => {
    const { review, reviewer } = setup({ stored: [anEquipmentRequest({ status: "approved" })] });
    const res = await review({ status: "UNDER_REVIEW" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: "NOT_WAITING", error: EQUIPMENT_REQUEST_REVIEW_MESSAGES.notWaiting });
    expect(reviewer.reviewed).toEqual([]);
  });

  it("decision: refuses a request for a finished event (409)", async () => {
    const { review } = setup({ stored: [anEquipmentRequest({ eventStatus: "cancelled" })] });
    const res = await review({ status: "ARRANGED" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EVENT_LOCKED");
  });

  it("a request that does not exist is a 404", async () => {
    expect((await setup().review({ status: "ARRANGED" }, "missing")).status).toBe(404);
  });

  it.each([
    [{ outcome: "not_found" }, 404, "NOT_FOUND"],
    [{ outcome: "not_reviewable" }, 409, "NOT_WAITING"],
    [{ outcome: "event_locked" }, 409, "EVENT_LOCKED"],
  ] as const)("passes on the database's refusal %j (someone else saved first)", async (outcome, status, code) => {
    const res = await setup({ outcome }).review({ status: "UNDER_REVIEW" });
    expect(res.status).toBe(status);
    expect(res.body.code).toBe(code);
  });
});

describe("SCRUM-87 decision: Arranged only when enough units are free", () => {
  it("refuses Arranged with how many are free, and the request stays as it was", async () => {
    const { review, detail } = setup({ outcome: { outcome: "insufficient", available: 1 } });
    const res = await review({ status: "ARRANGED" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      code: "INSUFFICIENT",
      error: "Only 1 available for that period, but this request needs 2. It has not been marked Arranged.",
      available: 1,
    });
    expect((await detail()).body.statusLabel).toBe("Submitted");
  });
});

describe("SCRUM-87/AC5 give a reason for Cannot Fulfil", () => {
  it("does not change the status without a reason, and asks for one", async () => {
    const { review, reviewer } = setup();
    for (const reason of [undefined, "", "   "]) {
      const res = await review({ status: "CANNOT_FULFIL", reason });
      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ reason: EQUIPMENT_REQUEST_REVIEW_MESSAGES.reasonMissing });
    }
    expect(reviewer.reviewed).toEqual([]);
  });

  it("saves the trimmed reason, and the coordinator can read it on the event", async () => {
    const { review, eventRequests, reviewer } = setup();
    const res = await review({ status: "CANNOT_FULFIL", reason: "  All out on loan that week " });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ statusLabel: "Cannot Fulfil", reason: "All out on loan that week", canReview: false });
    expect(reviewer.reviewed).toEqual([{ requestId: "req-1", dbStatus: "rejected", reason: "All out on loan that week" }]);
    expect((await eventRequests()).body.requests[0]).toMatchObject({ statusLabel: "Cannot Fulfil", reason: "All out on loan that week" });
  });

  it("refuses a reason over 500 characters", async () => {
    const res = await setup().review({ status: "CANNOT_FULFIL", reason: "x".repeat(501) });
    expect(res.status).toBe(422);
    expect(res.body.fieldErrors).toEqual({ reason: EQUIPMENT_REQUEST_REVIEW_MESSAGES.reasonTooLong });
  });
});

describe("SCRUM-87/AC6 equipment ready for the event", () => {
  const withStatuses = (...statuses: string[]) =>
    setup({ stored: statuses.map((status, i) => anEquipmentRequest({ id: `r${i}`, status })) }).eventRequests();

  it("is Complete when every request is Arranged", async () => {
    expect((await withStatuses("approved", "reserved")).body).toMatchObject({ readiness: "COMPLETE", readinessLabel: "Complete" });
  });

  it.each(["requested", "under_review", "rejected"])("is Incomplete when any request is %s", async (status) => {
    expect((await withStatuses("approved", status)).body).toMatchObject({ readiness: "INCOMPLETE", readinessLabel: "Incomplete" });
  });

  it("ignores cancelled requests", async () => {
    expect((await withStatuses("approved", "cancelled")).body.readiness).toBe("COMPLETE");
  });

  it("says nothing when no equipment was requested", async () => {
    expect((await withStatuses()).body).toMatchObject({ readiness: null, readinessLabel: null });
    expect((await withStatuses("cancelled")).body).toMatchObject({ readiness: null, readinessLabel: null });
  });
});

describe("SCRUM-87/AC7 only Technical Support Staff", () => {
  const others = [...ROLES.filter((r) => r !== "technical_support_staff").map((r) => `${r}-user`), "coord-1"];

  it.each(others)("%s cannot change a request's status, and it stays the same", async (user) => {
    const { review, reviewer, detail } = setup();
    const res = await review({ status: "ARRANGED" }, "req-1", user);
    expect(res.status).toBe(403);
    expect(reviewer.reviewed).toEqual([]);
    expect((await detail()).body.statusLabel).toBe("Submitted");
  });

  it.each(others)("%s cannot see the queue or a request", async (user) => {
    const { queue, detail } = setup();
    expect((await queue(user)).status).toBe(403);
    expect((await detail("req-1", user)).status).toBe(403);
  });

  it("someone not signed in is a 401", async () => {
    const { queue, detail, review } = setup();
    expect((await queue(null)).status).toBe(401);
    expect((await detail("req-1", null)).status).toBe(401);
    expect((await review({ status: "ARRANGED" }, "req-1", null)).status).toBe(401);
  });
});
