import request from "supertest";
import { describe, it, expect } from "vitest";
import type { Role } from "@spm-t5/shared";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";
import { FakeBookingRepository } from "../support/fakeBookingRepository";
import { FakeEventReader, anEvent } from "../support/fakeEventReader";
import { FakeRoleReader, FakeVenueReader, aVenue } from "../support/fakeVenueAndRoles";

const NOW = new Date("2026-10-01T00:00:00.000Z");
const SLOT = { venueId: "venue-1", date: "2030-11-14", startTime: "09:00", endTime: "17:00" };

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

function setup(options: { events?: FakeEventReader; venues?: FakeVenueReader } = {}) {
  const bookings = new FakeBookingRepository(() => NOW);
  const events = options.events ?? new FakeEventReader([anEvent()]);
  const venues = options.venues ?? new FakeVenueReader([aVenue(), aVenue({ id: "venue-2", name: "Lotus Room" })]);
  const roles = new FakeRoleReader({
    "coordinator-1": "event_coordinator",
    "coordinator-2": "event_coordinator",
    "organiser-1": "event_organiser",
    "staff-1": "venue_staff",
    "tech-1": "technical_support_staff",
    "attendee-1": "attendee",
  });
  const app = createApp(deps, { now: () => NOW, ports: () => ({ bookings, events, venues, roles }) });
  const as = (userId: string) => ({
    post: (body: unknown) => request(app).post("/venue-bookings").set("Cookie", `cs_session=tok-${userId}`).send(body as object),
    get: (path: string) => request(app).get(path).set("Cookie", `cs_session=tok-${userId}`),
  });
  return { app, bookings, events, as, coordinator: as("coordinator-1") };
}

const submit = (body: object = {}) => ({ eventId: "event-1", ...SLOT, ...body });

describe("SCRUM-32/AC1 successful submission (32-S1)", () => {
  it("32-S1 creates a PENDING request carrying the event snapshot, submitter and time", async () => {
    const { coordinator, bookings } = setup();
    const res = await coordinator.post(submit());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: "PENDING",
      eventName: "Summit B",
      date: "2030-11-14",
      startTime: "09:00",
      endTime: "17:00",
      expectedAttendance: 50,
      venueRequirements: "Theatre",
      accessibilityNeeds: null,
      submittedBy: "coordinator-1",
      submittedAt: NOW.toISOString(),
    });
    expect(bookings.rows).toHaveLength(1);
    expect(bookings.rows[0]).toMatchObject({ status: "requested", venueId: "venue-1" });
  });

  it("401 without a session", async () => {
    const { app, bookings } = setup();
    expect((await request(app).post("/venue-bookings").send(submit())).status).toBe(401);
    expect(bookings.rows).toHaveLength(0);
  });
});

describe("SCRUM-32/AC2 event details carried onto the form (32-S2)", () => {
  it("32-S2 pre-fills date, times and attendance from the event and does not change the event", async () => {
    const { coordinator, events } = setup();
    const res = await coordinator.get("/events/event-1/venue-booking-form");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      eventId: "event-1",
      eventName: "Summit B",
      date: "2030-11-14",
      startTime: "09:00",
      endTime: "17:00",
      expectedAttendance: 50,
      venueRequirements: "Theatre",
      accessibilityNeeds: null,
    });
    await coordinator.post(submit({ date: "2030-11-15", startTime: "10:00", endTime: "12:00" }));
    expect((await events.getById("event-1"))?.proposedStart).toEqual(new Date("2030-11-14T01:00:00.000Z"));
  });

  it("32-S2 leaves the date and times empty when the event has none", async () => {
    const events = new FakeEventReader([anEvent({ proposedStart: null, proposedEnd: null })]);
    const res = await setup({ events }).coordinator.get("/events/event-1/venue-booking-form");
    expect(res.body).toMatchObject({ date: null, startTime: null, endTime: null });
  });

  it("32-S2 applies the same access rules as submitting", async () => {
    const { as } = setup();
    expect((await as("coordinator-2").get("/events/event-1/venue-booking-form")).status).toBe(403);
    expect((await as("coordinator-1").get("/events/nope/venue-booking-form")).status).toBe(404);
  });

  it("lists active venues for the picker", async () => {
    const venues = new FakeVenueReader([aVenue(), aVenue({ id: "old", isActive: false })]);
    const res = await setup({ venues }).coordinator.get("/venues");
    expect(res.body.map((v: { id: string }) => v.id)).toEqual(["venue-1"]);
  });
});

describe("SCRUM-32/AC3 only some event statuses allow a venue request (32-S3)", () => {
  const eligible = ["approved", "planning", "awaiting_arrangements"];
  const ineligible = ["draft", "submitted", "under_review", "returned", "rejected", "confirmed", "completed", "cancelled"];

  it.each(eligible)("32-S3 %s: 201", async (status) => {
    const events = new FakeEventReader([anEvent({ status })]);
    expect((await setup({ events }).coordinator.post(submit())).status).toBe(201);
  });

  it.each(ineligible)("32-S3 %s: 409 EVENT_NOT_ELIGIBLE and no row", async (status) => {
    const events = new FakeEventReader([anEvent({ status })]);
    const { coordinator, bookings } = setup({ events });
    const res = await coordinator.post(submit());
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      code: "EVENT_NOT_ELIGIBLE",
      error: "The event must be approved before a venue can be requested.",
    });
    expect(bookings.rows).toHaveLength(0);
  });
});

describe("SCRUM-32/AC4 only the assigned Coordinator may raise the request (32-S4)", () => {
  it.each<[string, Role]>([
    ["coordinator-2", "event_coordinator"],
    ["organiser-1", "event_organiser"],
    ["staff-1", "venue_staff"],
    ["tech-1", "technical_support_staff"],
    ["attendee-1", "attendee"],
  ])("32-S4 %s (%s) gets 403 and no row is created", async (userId) => {
    const { as, bookings } = setup();
    const res = await as(userId).post(submit());
    expect(res.status).toBe(403);
    expect(Object.keys(res.body).sort()).toEqual(["code", "error"]);
    expect(bookings.rows).toHaveLength(0);
  });

  it("32-S4 a user with no recognised role gets 403", async () => {
    const { as } = setup();
    expect((await as("ghost").post(submit())).status).toBe(403);
  });

  it("404 for an unknown event", async () => {
    expect((await setup().coordinator.post(submit({ eventId: "nope" }))).status).toBe(404);
  });
});

describe("SCRUM-32/AC5 invalid requested times or venue (32-S5)", () => {
  it.each([
    ["end before start", { startTime: "17:00", endTime: "09:00" }, "endTime"],
    ["end equal to start", { startTime: "09:00", endTime: "09:00" }, "endTime"],
    ["start in the past", { date: "2026-09-30" }, "startTime"],
    ["no venue", { venueId: "" }, "venueId"],
    ["no event", { eventId: "" }, "eventId"],
  ])("32-S5 %s: 422 with a field error and no row", async (_name, patch, field) => {
    const { coordinator, bookings } = setup();
    const res = await coordinator.post(submit(patch));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("VALIDATION_FAILED");
    expect(res.body.fieldErrors).toHaveProperty(field);
    expect(bookings.rows).toHaveLength(0);
  });

  it("32-S5 an empty body is a validation failure, not a crash", async () => {
    const res = await setup().as("coordinator-1").post(undefined);
    expect(res.status).toBe(422);
    expect(res.body.fieldErrors).toHaveProperty("eventId");
  });

  it("32-S5 an unknown or inactive venue is 404", async () => {
    const venues = new FakeVenueReader([aVenue({ id: "closed", isActive: false })]);
    const { coordinator, bookings } = setup({ venues });
    expect((await coordinator.post(submit({ venueId: "closed" }))).status).toBe(404);
    expect((await coordinator.post(submit({ venueId: "nope" }))).status).toBe(404);
    expect(bookings.rows).toHaveLength(0);
  });
});

describe("SCRUM-32/AC6 one active request per event (32-S6)", () => {
  it.each(["requested", "approved"])("32-S6 a second submit while %s is 409 ACTIVE_REQUEST_EXISTS", async (status) => {
    const { coordinator, bookings } = setup();
    bookings.seed({ eventId: "event-1", venueId: "venue-2", status, start: new Date("2030-12-01T01:00:00Z"), end: new Date("2030-12-01T02:00:00Z") });
    const res = await coordinator.post(submit());
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ACTIVE_REQUEST_EXISTS");
    expect(bookings.rows).toHaveLength(1);
  });

  it.each(["rejected", "withdrawn"])("32-S6 after the earlier one is %s, submit is 201", async (status) => {
    const { coordinator, bookings } = setup();
    bookings.seed({ eventId: "event-1", venueId: "venue-2", status, start: new Date("2030-12-01T01:00:00Z"), end: new Date("2030-12-01T02:00:00Z") });
    expect((await coordinator.post(submit())).status).toBe(201);
  });
});

describe("SCRUM-32/AC7 a rejected slot cannot simply be requested again (32-S7)", () => {
  const rejected = { eventId: "event-1", venueId: "venue-1", status: "rejected", start: new Date("2030-11-14T01:00:00Z"), end: new Date("2030-11-14T09:00:00Z") };

  it("32-S7 the identical venue, date and times is 409 REPEAT_OF_REJECTED", async () => {
    const { coordinator, bookings } = setup();
    bookings.seed(rejected);
    const res = await coordinator.post(submit());
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("REPEAT_OF_REJECTED");
  });

  it.each([
    ["venue", { venueId: "venue-2" }],
    ["date", { date: "2030-11-15" }],
    ["start", { startTime: "10:00" }],
    ["end", { endTime: "16:00" }],
  ])("32-S7 changing only the %s is accepted", async (_name, patch) => {
    const { coordinator, bookings } = setup();
    bookings.seed(rejected);
    expect((await coordinator.post(submit(patch))).status).toBe(201);
  });

  it("32-S7 also holds against an earlier rejection, not just the latest", async () => {
    const { coordinator, bookings } = setup();
    bookings.seed(rejected);
    bookings.seed({ ...rejected, venueId: "venue-2" });
    expect((await coordinator.post(submit())).body.code).toBe("REPEAT_OF_REJECTED");
  });
});

describe("SCRUM-32/AC8 the slot is already held (32-S8)", () => {
  it("32-S8 another event holding the venue is 409 SLOT_CONFLICT and no row", async () => {
    const { coordinator, bookings } = setup();
    bookings.seed({ eventId: "other-event", venueId: "venue-1", start: new Date("2030-11-14T03:00:00Z"), end: new Date("2030-11-14T05:00:00Z") });
    const res = await coordinator.post(submit());
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: "SLOT_CONFLICT", error: "This venue is already held for part of that period." });
    expect(bookings.rows).toHaveLength(1);
  });
});

describe("SCRUM-32/AC9 attendance above capacity is not blocked (32-S9)", () => {
  it("32-S9 attendance 200 at a 150-seat venue is still PENDING", async () => {
    const events = new FakeEventReader([anEvent({ expectedAttendance: 200 })]);
    const res = await setup({ events }).coordinator.post(submit());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "PENDING", expectedAttendance: 200 });
  });
});

describe("SCRUM-32/AC10 event details on the request do not change afterwards (32-S10)", () => {
  it("32-S10 the stored snapshot keeps 120 after the event moves to 150", async () => {
    const events = new FakeEventReader([anEvent({ expectedAttendance: 120 })]);
    const { coordinator, bookings } = setup({ events });
    await coordinator.post(submit());
    events.add(anEvent({ expectedAttendance: 150, name: "Renamed" }));
    expect(bookings.rows[0].snapshot).toMatchObject({ expectedAttendance: 120, eventName: "Summit B" });
  });
});
