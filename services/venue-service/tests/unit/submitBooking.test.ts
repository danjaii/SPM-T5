import request from "supertest";
import { describe, it, expect } from "vitest";
import type { Role } from "@spm-t5/shared";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";
import { FakeBookingRepository } from "../support/fakeBookingRepository";
import { FakeEventReader, anEvent } from "../support/fakeEventReader";
import { FakeUserReader } from "../support/fakeUserReader";
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
    "safety-1": "safety_officer",
  });
  const app = createApp(deps, { now: () => NOW, ports: () => ({ bookings, events, venues, roles, users: new FakeUserReader() }) });
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

// SCRUM-98 replaces SCRUM-32's "one active request per event" rule (32-S6, DR6): an event can now hold several bookings.
describe("SCRUM-98/AC1 another venue for the same event is a separate booking (98-S1, 98-S2)", () => {
  // venue-2 is already requested or approved for this event at the very same time as the new request for venue-1
  it.each(["requested", "approved"])("98-S1/S2 a second venue while the first is %s: 201 and two bookings on the event", async (status) => {
    const { coordinator, bookings } = setup();
    bookings.seed({ eventId: "event-1", venueId: "venue-2", status, start: new Date("2030-11-14T01:00:00Z"), end: new Date("2030-11-14T09:00:00Z") });

    const res = await coordinator.post(submit());

    expect(res.status).toBe(201);
    // if code is working, we expect response 201, which means succeed with something created 
    // it works if for one event, we can book 2 venues 
    expect(res.body).toMatchObject({ status: "PENDING" });
    expect(bookings.rows).toHaveLength(2);
    expect(bookings.rows.map((b) => b.venueId).sort()).toEqual(["venue-1", "venue-2"]);
    expect(bookings.rows.every((b) => b.eventId === "event-1")).toBe(true);
  });

  // the same hall in the morning and again in the evening is two bookings, not a clash
  it("98-S4 the same venue again for a later period that does not overlap: 201", async () => {
    const { coordinator, bookings } = setup();
    bookings.seed({ eventId: "event-1", venueId: "venue-1", start: new Date("2030-11-14T01:00:00Z"), end: new Date("2030-11-14T03:00:00Z") }); // 9am-11am SGT

    const res = await coordinator.post(submit({ startTime: "14:00", endTime: "17:00" }));

    expect(res.status).toBe(201);
    expect(bookings.rows).toHaveLength(2);
  });

  it("98-S5 the same venue back to back (one ends at 12:00, the next starts at 12:00): 201", async () => {
    const { coordinator, bookings } = setup();
    bookings.seed({ eventId: "event-1", venueId: "venue-1", start: new Date("2030-11-14T01:00:00Z"), end: new Date("2030-11-14T04:00:00Z") }); // 9am-12pm SGT

    expect((await coordinator.post(submit({ startTime: "12:00", endTime: "17:00" }))).status).toBe(201);
  });
});

describe("SCRUM-98/AC3 the same venue for an overlapping period is not allowed (98-S13 to 98-S15)", () => {
  // this event already holds venue-1 from 10am to 12pm; the new request is venue-1 from 9am to 5pm, which overlaps it
  const ownHold = { eventId: "event-1", venueId: "venue-1", start: new Date("2030-11-14T02:00:00Z"), end: new Date("2030-11-14T04:00:00Z") };

  it.each([
    ["98-S13", "requested"],
    ["98-S14", "approved"],
  ])("%s overlapping this event's own %s booking at the same venue: 409 DUPLICATE_VENUE and no row", async (_id, status) => {
    const { coordinator, bookings } = setup();
    bookings.seed({ ...ownHold, status });

    const res = await coordinator.post(submit());

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: "DUPLICATE_VENUE", error: "This event already holds this venue for part of that period." });
    expect(bookings.rows).toHaveLength(1);
  });

  // a rejected or withdrawn booking no longer holds the venue, so it does not count
  it.each(["rejected", "withdrawn"])("98-S15 overlapping this event's own %s booking at the same venue: 201", async (status) => {
    const { coordinator, bookings } = setup();
    bookings.seed({ ...ownHold, status });

    expect((await coordinator.post(submit())).status).toBe(201);
  });

  // another event holding the venue is still SLOT_CONFLICT (32-S8), not DUPLICATE_VENUE
  it("98-S13 another event's booking at the same venue is still SLOT_CONFLICT", async () => {
    const { coordinator, bookings } = setup();
    bookings.seed({ ...ownHold, eventId: "other-event" });

    expect((await coordinator.post(submit())).body.code).toBe("SLOT_CONFLICT");
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
    // SCRUM-103: the refusal names the occupied period (the held request is 11:00-13:00 in Singapore time)
    expect(res.body).toEqual({ code: "SLOT_CONFLICT", error: "venue-1 is occupied from 11:00 to 13:00" });
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

// ----------------------------------------------------------------------------
// SCRUM-98/AC2 each booking is checked with its own details (the event is 50 people, "Theatre"; venue-1 holds 150)
// ----------------------------------------------------------------------------

describe("SCRUM-98/AC2 each booking has its own attendance and requirements (98-S6 to 98-S8)", () => {
  // books with 80 people and banquet
  it("98-S6 a booking with its own attendance and requirements stores those, not the event's", async () => {
    const { coordinator, bookings } = setup();

    const res = await coordinator.post(submit({ expectedAttendance: 80, venueRequirements: "Banquet" }));
    // coordinator books 80 expected attendance and banquet

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ expectedAttendance: 80, venueRequirements: "Banquet" });
    expect(bookings.rows[0].snapshot).toMatchObject({ expectedAttendance: 80, venueRequirements: "Banquet" });
  });

  it("98-S7 a booking without them stores the event's", async () => {
    const { coordinator, bookings } = setup();

    await coordinator.post(submit());

    expect(bookings.rows[0].snapshot).toMatchObject({ expectedAttendance: 50, venueRequirements: "Theatre" });
  });
  //  books venue 1 with expected 120, venue 2 with expected 30
  // two bookings on one event, each with its own numbers
  it("98-S6 two bookings on the same event keep their own attendance", async () => {
    const { coordinator, bookings } = setup();

    await coordinator.post(submit({ expectedAttendance: 120 }));
    await coordinator.post(submit({ venueId: "venue-2", expectedAttendance: 30 }));

    expect(bookings.rows.map((b) => b.snapshot.expectedAttendance)).toEqual([120, 30]);
  });
  // we book a venue, we say expected is 80 attendance, we change event attendance and we dont expect venue expected of 80 to change

  it("98-S8 the booking's own attendance is kept after the event's changes", async () => {
    const events = new FakeEventReader([anEvent()]);
    const { coordinator, bookings } = setup({ events });
    await coordinator.post(submit({ expectedAttendance: 80 }));

    events.add(anEvent({ expectedAttendance: 300 }));

    expect(bookings.rows[0].snapshot.expectedAttendance).toBe(80);
  });
  // book with -5 people, but we get a 422 response 
  it("98-S12 an invalid attendance is 422 with a field error and no row", async () => {
    const { coordinator, bookings } = setup();

    const res = await coordinator.post(submit({ expectedAttendance: -5 }));

    expect(res.status).toBe(422);
    expect(res.body.fieldErrors).toHaveProperty("expectedAttendance");
    expect(bookings.rows).toHaveLength(0);
  });
});
// 200 people at the 150 person venue, we should see exceed capacity to to be true 
describe("SCRUM-98/AC2 more people than the venue holds is a warning, not a refusal (98-S10, 98-S11)", () => {
  it("98-S10 attendance 200 at a venue for 150: 201 PENDING, flagged exceedsCapacity", async () => {
    const { coordinator, bookings } = setup();

    const res = await coordinator.post(submit({ expectedAttendance: 200 }));

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "PENDING", expectedAttendance: 200, exceedsCapacity: true });
    expect(bookings.rows).toHaveLength(1);
  });
  // the event expects 200 and the booking gives no number, so we take event's number of 200, and exceed capacity becomes true 
  it("98-S10 the event's own attendance is used when the booking has none (200 at a venue for 150)", async () => {
    const events = new FakeEventReader([anEvent({ expectedAttendance: 200 })]);

    const res = await setup({ events }).coordinator.post(submit());

    expect(res.body.exceedsCapacity).toBe(true);
  });
  // if we have 100 people at the 200 max people venue, we expect exceeds capacity to become false
  it("98-S11 attendance 100 at a venue for 150: not flagged", async () => {
    const res = await setup().coordinator.post(submit({ expectedAttendance: 100 }));

    expect(res.status).toBe(201);
    expect(res.body.exceedsCapacity).toBe(false);
  });
});

// ----------------------------------------------------------------------------
// SCRUM-98/AC4 one booking failing or being rejected leaves the event's other bookings as they were
// ----------------------------------------------------------------------------
// for the scenario, we are trying to book for venue 1, but for venue 2, it has successfully been booked 
describe("SCRUM-98/AC4 bookings of one event are independent (98-S16 to 98-S19)", () => {
  /** POST to any address as the given user. */
  const postAs = (app: Parameters<typeof request>[0], userId: string, path: string, body: object = {}) =>
    request(app).post(path).set("Cookie", `cs_session=tok-${userId}`).send(body);

  /** The event already holds venue-2 on 14 Nov, 9am to 5pm, waiting for venue staff. */
  const withOneBooking = () => {
    const ctx = setup();
    const other = ctx.bookings.seed({ eventId: "event-1", venueId: "venue-2", start: new Date("2030-11-14T01:00:00Z"), end: new Date("2030-11-14T09:00:00Z") });
    return { ...ctx, other };
  };
  // the coordinator asks for venue 1, but another event already has it. the request is refused, nothing new is saved, and venue 2 is unaffected 
  it("98-S16 a request refused for a clash (another event holds venue-1) creates nothing and leaves the other booking as it was", async () => {
    const { coordinator, bookings, other } = withOneBooking();
    bookings.seed({ eventId: "other-event", venueId: "venue-1", start: new Date("2030-11-14T03:00:00Z"), end: new Date("2030-11-14T05:00:00Z") });

    const res = await coordinator.post(submit());

    expect(res.body.code).toBe("SLOT_CONFLICT");
    expect(bookings.rows.filter((b) => b.eventId === "event-1")).toEqual([other]);
    expect(other.status).toBe("requested");
  });
  // the coordinator asks for venue 1, with the end time being earlier than the start time. it is refused, nothing is saved and venue 2 is unaffected 
  it("98-S16 a request refused for a bad field creates nothing and leaves the other booking as it was", async () => {
    const { coordinator, bookings, other } = withOneBooking();

    expect((await coordinator.post(submit({ endTime: "08:00" }))).status).toBe(422);

    expect(bookings.rows).toEqual([other]);
    expect(other.status).toBe("requested");
  });
  // the coordinator books venue 1, but rejected by venue staff. venue 1 becomes rejected, and venue 2 is still waiting 
  it("98-S17 venue staff rejecting one of two bookings leaves the other pending", async () => {
    const { app, coordinator, bookings, other } = withOneBooking();
    const second = (await coordinator.post(submit())).body;

    const res = await postAs(app, "staff-1", `/venue-bookings/${second.id}/reject`, { reason: "Under renovation" });

    expect(res.status).toBe(200);
    expect(bookings.rows.find((b) => b.id === second.id)?.status).toBe("rejected");
    expect(other.status).toBe("requested");
  });
  // the coordinator books venue 1 too, then withdraws it. venue 1 becomes withdrawn, and venue 2 is still waiting
  it("98-S18 the coordinator withdrawing one of two pending bookings leaves the other pending", async () => {
    const { app, coordinator, bookings, other } = withOneBooking();
    const second = (await coordinator.post(submit())).body;

    const res = await postAs(app, "coordinator-1", `/venue-bookings/${second.id}/withdraw`);

    expect(res.status).toBe(200);
    expect(bookings.rows.find((b) => b.id === second.id)?.status).toBe("withdrawn");
    expect(other.status).toBe("requested");
  });

  // replacing a rejected booking is fine while another booking of the event is still pending
  // there is also a rejected venue 1 booking. the coordinator replaces it with a new date. venue 2 is unaffected, the old venue 1
  // stays rejected, and the new venue 1 is pending, so the event has 3 bookings in total
  it("98-S19 amending a rejected booking while another booking is pending: 201, and the other is unchanged", async () => {
    const { app, bookings, other } = withOneBooking();
    const rejected = bookings.seed({ eventId: "event-1", venueId: "venue-1", status: "rejected", start: new Date("2030-11-14T01:00:00Z"), end: new Date("2030-11-14T09:00:00Z") });

    const res = await postAs(app, "coordinator-1", `/venue-bookings/${rejected.id}/amend`, { venueId: "venue-1", date: "2030-11-15", startTime: "09:00", endTime: "17:00" });

    expect(res.status).toBe(201);
    expect(rejected.status).toBe("rejected");
    expect(other.status).toBe("requested");
    expect(bookings.rows.filter((b) => b.eventId === "event-1")).toHaveLength(3);
  });
});

// ----------------------------------------------------------------------------
// SCRUM-98/AC6 the access rules stay the same for a second booking
// ----------------------------------------------------------------------------

describe("SCRUM-98/AC6 only the assigned coordinator of an eligible event may add another venue (98-S26, 98-S29)", () => {
  const existing = { eventId: "event-1", venueId: "venue-2", start: new Date("2030-11-14T01:00:00Z"), end: new Date("2030-11-14T09:00:00Z") };

  it("98-S26 a coordinator the event is not assigned to cannot add a second venue: 403 and no row", async () => {
    const { as, bookings } = setup();
    bookings.seed(existing);

    const res = await as("coordinator-2").post(submit());

    expect(res.status).toBe(403);
    expect(bookings.rows).toHaveLength(1);
  });

  it("98-S29 an event that is no longer eligible cannot add a second venue: 409 EVENT_NOT_ELIGIBLE and no row", async () => {
    const events = new FakeEventReader([anEvent({ status: "cancelled" })]);
    const { coordinator, bookings } = setup({ events });
    bookings.seed(existing);

    const res = await coordinator.post(submit());

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EVENT_NOT_ELIGIBLE");
    expect(bookings.rows).toHaveLength(1);
  });
});

describe("SCRUM-116/AC3 a Safety Officer cannot edit the venue arrangements", () => {
  it("SCRUM-116/AC3 a Safety Officer's venue booking request gets 403 and no row is created", async () => {
    const { as, bookings } = setup();
    const res = await as("safety-1").post(submit());
    expect(res.status).toBe(403);
    expect(bookings.rows).toHaveLength(0);
  });
});
