import request from "supertest";
import { describe, it, expect } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";
import { FakeBookingRepository } from "../support/fakeBookingRepository";
import { FakeEventReader, anEvent } from "../support/fakeEventReader";
import { FakeRoleReader, FakeVenueReader, aVenue } from "../support/fakeVenueAndRoles";

const NOW = new Date("2026-10-05T03:00:00.000Z");
const SLOT = { start: new Date("2030-11-14T01:00:00Z"), end: new Date("2030-11-14T09:00:00Z") };
const REASON = "Room under renovation until 2026-12-01";

const deps = {
  anon: { auth: { getUser: async (t: string) => ({ data: { user: t.startsWith("tok-") ? { id: t.slice(4) } : null } }) } },
  forUser: () => {
    throw new Error("ports are faked");
  },
} as unknown as SupabaseDeps;

function setup() {
  const bookings = new FakeBookingRepository(() => NOW);
  const events = new FakeEventReader([anEvent(), anEvent({ id: "event-2", assignedCoordinatorId: "coordinator-2" })]);
  const venues = new FakeVenueReader([aVenue(), aVenue({ id: "venue-2", name: "Lotus Room" })]);
  const roles = new FakeRoleReader({
    "coordinator-1": "event_coordinator",
    "coordinator-2": "event_coordinator",
    "organiser-1": "event_organiser",
    "staff-1": "venue_staff",
    "staff-2": "venue_staff",
    "tech-1": "technical_support_staff",
    "attendee-1": "attendee",
  });
  const app = createApp(deps, { now: () => NOW, ports: () => ({ bookings, events, venues, roles }) });
  const as = (user: string) => `cs_session=tok-${user}`;
  const reject = (id: string, body: unknown = { reason: REASON }, user = "staff-1") =>
    request(app).post(`/venue-bookings/${id}/reject`).set("Cookie", as(user)).send(body as object);
  const approve = (id: string, user = "staff-1") => request(app).post(`/venue-bookings/${id}/approve`).set("Cookie", as(user));
  const pending = (over: Record<string, unknown> = {}) =>
    bookings.seed({ eventId: "event-1", venueId: "venue-1", requestedBy: "coordinator-1", ...SLOT, ...over });
  return { app, bookings, events, reject, approve, pending, as };
}

describe("SCRUM-39/AC1 rejecting with a reason (39-S1)", () => {
  it("39-S1 becomes REJECTED with reason, who and when stored, and leaves the pending queue", async () => {
    const { bookings, reject, pending } = setup();
    const row = pending();
    const res = await reject(row.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: row.id,
      status: "REJECTED",
      rejectionReason: REASON,
      decidedBy: "staff-1",
      decidedAt: NOW.toISOString(),
    });
    expect(row).toMatchObject({ status: "rejected", reviewNotes: REASON, reviewedBy: "staff-1", reviewedAt: NOW });
    expect(await bookings.listPending()).toEqual([]);
  });

  it("39-S1 the reason is stored trimmed", async () => {
    const { reject, pending } = setup();
    const row = pending();
    expect((await reject(row.id, { reason: `  ${REASON}  ` })).body.rejectionReason).toBe(REASON);
    expect(row.reviewNotes).toBe(REASON);
  });

  it("39-S1 the requesting Coordinator sees the reason on the SCRUM-33 detail", async () => {
    const { app, reject, pending, as } = setup();
    const row = pending();
    await reject(row.id);
    const res = await request(app).get(`/venue-bookings/${row.id}`).set("Cookie", as("coordinator-1"));
    expect(res.body).toMatchObject({ status: "REJECTED", rejectionReason: REASON });
  });

  it("39-S1 404 for an unknown request", async () => {
    expect((await setup().reject("nope")).status).toBe(404);
  });

  it("39-S1 unknown body keys are ignored, so no suggestion is stored yet (SCRUM-40 seam)", async () => {
    const { reject, pending } = setup();
    const row = pending();
    const res = await reject(row.id, { reason: REASON, suggestion: { venueId: "venue-2" }, extra: true });
    expect(res.status).toBe(200);
    expect(row.suggestion).toBeNull();
  });
});

describe("SCRUM-39/AC2 a reason is required (39-S2)", () => {
  it.each([
    ["empty", ""],
    ["only spaces", "   "],
    ["501 characters", "x".repeat(501)],
    ["a non-string", 42],
  ])("39-S2 %s: 422 with fieldErrors.reason and the request stays PENDING", async (_name, reason) => {
    const { reject, pending } = setup();
    const row = pending();
    const res = await reject(row.id, { reason });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("VALIDATION_FAILED");
    expect(res.body.fieldErrors).toEqual({ reason: expect.any(String) });
    expect(row.status).toBe("requested");
  });

  it("39-S2 a missing body or reason is 422 too", async () => {
    const { reject, pending } = setup();
    const row = pending();
    expect((await reject(row.id, {})).status).toBe(422);
    expect((await reject(row.id, undefined)).status).toBe(422);
    expect(row.status).toBe("requested");
  });

  it.each([
    ["1 character", "x"],
    ["500 characters", "x".repeat(500)],
  ])("39-S2 %s succeeds", async (_name, reason) => {
    const { reject, pending } = setup();
    const row = pending();
    const res = await reject(row.id, { reason });
    expect(res.status).toBe(200);
    expect(row.reviewNotes).toBe(reason);
  });
});

describe("SCRUM-39/AC3 rejections are final (39-S3)", () => {
  it("39-S3 approve or reject on a REJECTED request is 409 NOT_PENDING and changes nothing", async () => {
    const { reject, approve, pending } = setup();
    const row = pending();
    await reject(row.id);
    const before = { ...row };

    const again = await reject(row.id, { reason: "Changed my mind" });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("NOT_PENDING");
    const approved = await approve(row.id);
    expect(approved.status).toBe(409);
    expect(approved.body.code).toBe("NOT_PENDING");
    expect(row).toEqual(before);
  });

  it("39-S3 the pending check comes before reason validation", async () => {
    const { reject, pending } = setup();
    const row = pending({ status: "rejected" });
    expect((await reject(row.id, { reason: "" })).status).toBe(409);
  });

  it("39-S3 amending (SCRUM-60) creates a new request and leaves the rejected one unchanged", async () => {
    const { app, bookings, reject, pending, as } = setup();
    const row = pending();
    await reject(row.id);
    const before = structuredClone(row);

    const res = await request(app)
      .post(`/venue-bookings/${row.id}/amend`)
      .set("Cookie", as("coordinator-1"))
      .send({ venueId: "venue-2", date: "2030-11-15", startTime: "09:00", endTime: "17:00" });
    expect(res.status).toBe(201);
    expect(res.body.id).not.toBe(row.id);
    expect(bookings.rows).toHaveLength(2);
    expect(row).toEqual(before);
  });
});

describe("SCRUM-39/AC4 the slot is released on rejection (39-S4, in memory)", () => {
  it("39-S4 another Coordinator can then request the same venue and period", async () => {
    const { app, reject, pending, as } = setup();
    const row = pending();
    const body = { eventId: "event-2", venueId: "venue-1", date: "2030-11-14", startTime: "09:00", endTime: "17:00" };
    expect((await request(app).post("/venue-bookings").set("Cookie", as("coordinator-2")).send(body)).status).toBe(409);

    await reject(row.id);
    expect((await request(app).post("/venue-bookings").set("Cookie", as("coordinator-2")).send(body)).status).toBe(201);
  });
});

describe("SCRUM-39/AC5 only pending requests can be rejected (39-S5)", () => {
  it.each(["approved", "withdrawn"])("39-S5 %s: 409 NOT_PENDING and keeps its status", async (status) => {
    const { reject, pending } = setup();
    const row = pending({ status });
    const res = await reject(row.id);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: "NOT_PENDING", error: "This request is no longer pending." });
    expect(row.status).toBe(status);
    expect(row.reviewNotes).toBeNull();
  });

  it("39-S5 reject + reject in parallel: exactly one succeeds, the other is NOT_PENDING", async () => {
    const { reject, pending } = setup();
    const row = pending();
    const results = await Promise.all([reject(row.id, { reason: "One" }, "staff-1"), reject(row.id, { reason: "Two" }, "staff-2")]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)?.body.code).toBe("NOT_PENDING");
  });

  it("39-S5 reject + approve in parallel: exactly one wins", async () => {
    const { reject, approve, pending } = setup();
    const row = pending();
    const results = await Promise.all([reject(row.id), approve(row.id, "staff-2")]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(["approved", "rejected"]).toContain(row.status);
  });

  it("39-S5 a decision landing between the pre-check and the update is NOT_PENDING", async () => {
    const { bookings, reject, pending } = setup();
    const row = pending();
    const real = bookings.decide.bind(bookings);
    let first = true;
    bookings.decide = async (...args) => {
      if (first) {
        first = false;
        await real(row.id, { outcome: "approved" }, "staff-2", NOW);
      }
      return real(...args);
    };
    const res = await reject(row.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NOT_PENDING");
    expect(row.status).toBe("approved");
  });
});

describe("SCRUM-39/AC6 the event is not changed (39-S6)", () => {
  it("39-S6 event status and fields are unchanged after a rejection", async () => {
    const { events, reject, pending } = setup();
    const before = structuredClone(await events.getById("event-1"));
    await reject(pending().id);
    expect(await events.getById("event-1")).toEqual(before);
  });
});

describe("SCRUM-39/AC7 only Venue Staff may reject, and who sees the reason (39-S7)", () => {
  it.each(["coordinator-1", "coordinator-2", "organiser-1", "tech-1", "attendee-1", "ghost"])(
    "39-S7 %s gets 403 (even with an invalid body) and the request stays PENDING",
    async (user) => {
      const { reject, pending } = setup();
      const row = pending();
      const res = await reject(row.id, { reason: "" }, user);
      expect(res.status).toBe(403);
      expect(Object.keys(res.body).sort()).toEqual(["code", "error"]);
      expect(row.status).toBe("requested");
    },
  );

  it("39-S7 no session is 401", async () => {
    const { app, pending } = setup();
    const row = pending();
    expect((await request(app).post(`/venue-bookings/${row.id}/reject`).send({ reason: REASON })).status).toBe(401);
    expect(row.status).toBe("requested");
  });

  it("39-S7 the Event Organiser cannot read the request or its reason", async () => {
    const { app, reject, pending, as } = setup();
    const row = pending();
    await reject(row.id);
    const res = await request(app).get(`/venue-bookings/${row.id}`).set("Cookie", as("organiser-1"));
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain(REASON);
  });
});
