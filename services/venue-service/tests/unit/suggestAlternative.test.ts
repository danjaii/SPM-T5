import request from "supertest";
import { describe, it, expect } from "vitest";
import { ROLES, sgtToUtc } from "@spm-t5/shared";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";
import { FakeBookingRepository } from "../support/fakeBookingRepository";
import { FakeEventReader, anEvent } from "../support/fakeEventReader";
import { FakeUserReader } from "../support/fakeUserReader";
import { FakeVenueDetailsReader } from "../support/fakeVenueDetails";
import { FakeRoleReader, FakeVenueReader, aVenue } from "../support/fakeVenueAndRoles";

/**
 * SCRUM-40 (docs/specs/venue-booking-suggestion.md): Venue Staff may suggest an alternative venue and time when they reject a
 * request. The suggestion rides on the SCRUM-39 reject action; the repository, the coordinator's view of it and the one-click
 * accept (SCRUM-59) already exist, so these cover the reject routes and the rules around the suggestion.
 */
const NOW = new Date("2026-10-05T03:00:00.000Z");
const SLOT = { start: new Date("2030-11-14T01:00:00Z"), end: new Date("2030-11-14T09:00:00Z") };
const REASON = "Room under renovation until 2026-12-01";
const LOTUS = { venueId: "venue-2", date: "2030-11-15", startTime: "09:00", endTime: "17:00" };

const deps = {
  anon: { auth: { getUser: async (t: string) => ({ data: { user: t.startsWith("tok-") ? { id: t.slice(4) } : null } }) } },
  forUser: () => {
    throw new Error("ports are faked");
  },
} as unknown as SupabaseDeps;

function setup() {
  const bookings = new FakeBookingRepository(() => NOW);
  const events = new FakeEventReader([anEvent(), anEvent({ id: "event-2", name: "Summit C", assignedCoordinatorId: "coordinator-2" })]);
  const venues = new FakeVenueReader([
    aVenue(),
    aVenue({ id: "venue-2", name: "Lotus Room" }),
    aVenue({ id: "venue-3", name: "Closed Hall", isActive: false }),
  ]);
  const roleMap: Record<string, string> = {
    "coordinator-1": "event_coordinator",
    "coordinator-2": "event_coordinator",
    "organiser-1": "event_organiser",
    "staff-1": "venue_staff",
    ...Object.fromEntries(ROLES.map((role) => [`${role}-user`, role])),
  };
  const roles = new FakeRoleReader(roleMap as never);
  const app = createApp(deps, {
    now: () => NOW,
    ports: () => ({ bookings, events, venues, roles, users: new FakeUserReader(), venueDetails: FakeVenueDetailsReader.from(venues) }),
  });
  const as = (user: string) => `cs_session=tok-${user}`;
  const reject = (id: string, body: unknown, user = "staff-1") => request(app).post(`/venue-bookings/${id}/reject`).set("Cookie", as(user)).send(body as object);
  const pending = (over: Record<string, unknown> = {}) =>
    bookings.seed({ eventId: "event-1", venueId: "venue-1", requestedBy: "coordinator-1", ...SLOT, ...over });
  return { app, bookings, as, reject, pending };
}

describe("SCRUM-40/AC1 rejecting with a suggestion (40-S1)", () => {
  it("40-S1: 200 REJECTED with its reason, and the suggestion (venue, and the period as UTC instants) is stored with it", async () => {
    const { reject, pending } = setup();
    const row = pending();

    const res = await reject(row.id, { reason: REASON, suggestion: LOTUS });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: row.id, status: "REJECTED", rejectionReason: REASON, decidedBy: "staff-1" });
    expect(row.suggestion).toEqual({ venueId: "venue-2", start: sgtToUtc("2030-11-15", "09:00"), end: sgtToUtc("2030-11-15", "17:00") });
    expect(row.reviewNotes).toBe(REASON);
  });

  it("40-S1: the requesting coordinator then sees the suggested venue, date and time on the request, and can accept it", async () => {
    const { app, as, reject, pending } = setup();
    const row = pending();
    await reject(row.id, { reason: REASON, suggestion: LOTUS });

    const res = await request(app).get(`/venue-bookings/${row.id}`).set("Cookie", as("coordinator-1"));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "REJECTED",
      rejectionReason: REASON,
      suggestion: { venueId: "venue-2", venueName: "Lotus Room", date: "2030-11-15", startTime: "09:00", endTime: "17:00" },
    });
  });

  it("40-S1: the same venue at another time is a valid suggestion too", async () => {
    const { reject, pending } = setup();
    const row = pending();

    const res = await reject(row.id, { reason: REASON, suggestion: { ...LOTUS, venueId: "venue-1" } });

    expect(res.status).toBe(200);
    expect(row.suggestion?.venueId).toBe("venue-1");
  });
});

describe("SCRUM-40/AC2 the suggestion is optional (40-S2)", () => {
  it.each([
    ["left out", { reason: REASON }],
    ["null", { reason: REASON, suggestion: null }],
    ["blank", { reason: REASON, suggestion: { venueId: "", date: "", startTime: "", endTime: "" } }],
  ])("40-S2: a rejection with a reason and a suggestion that is %s succeeds and stores no suggestion", async (_label, body) => {
    const { reject, pending } = setup();
    const row = pending();

    const res = await reject(row.id, body);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("REJECTED");
    expect(row.suggestion).toBeNull();
  });
});

describe("SCRUM-40/AC3 a suggestion does not hold the suggested slot (40-S3)", () => {
  it("40-S3: after the rejection, a different coordinator's request for the suggested venue and period is created PENDING", async () => {
    const { app, as, reject, pending } = setup();
    const row = pending();
    await reject(row.id, { reason: REASON, suggestion: LOTUS });

    const res = await request(app)
      .post("/venue-bookings")
      .set("Cookie", as("coordinator-2"))
      .send({ eventId: "event-2", ...LOTUS });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "PENDING", venueId: "venue-2", date: "2030-11-15", startTime: "09:00", endTime: "17:00" });
    expect(row.suggestion?.venueId).toBe("venue-2"); // and the suggestion is still there
  });
});

describe("SCRUM-40/AC1 an invalid suggestion is refused and nothing is rejected (40-S4)", () => {
  it.each([
    ["an unknown venue", { ...LOTUS, venueId: "venue-404" }, "suggestion.venueId"],
    ["an inactive venue", { ...LOTUS, venueId: "venue-3" }, "suggestion.venueId"],
    ["a date that does not exist", { ...LOTUS, date: "2030-02-30" }, "suggestion.date"],
    ["a start in the past", { ...LOTUS, date: "2026-10-04" }, "suggestion.startTime"],
    ["an end that is not after the start", { ...LOTUS, startTime: "17:00", endTime: "09:00" }, "suggestion.endTime"],
    ["a venue with no times", { venueId: "venue-2" }, "suggestion.date"],
    ["times with no venue", { date: "2030-11-15", startTime: "09:00", endTime: "17:00" }, "suggestion.venueId"],
  ])("40-S4: %s is a 422 on %s, the request stays PENDING, and no suggestion is stored", async (_label, suggestion, field) => {
    const { reject, pending } = setup();
    const row = pending();

    const res = await reject(row.id, { reason: REASON, suggestion });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("VALIDATION_FAILED");
    expect(Object.keys(res.body.fieldErrors)).toContain(field);
    expect(row.status).toBe("requested");
    expect(row.suggestion).toBeNull();
  });

  it("40-S4: a malformed venue id from the database is just 'no such venue', not a server error", async () => {
    const bookings = new FakeBookingRepository(() => NOW);
    const failing = new FakeVenueReader([aVenue()]);
    failing.getById = async (id: string) => {
      if (id === "not-a-uuid") throw Object.assign(new Error("Reading venue failed"), { cause: { code: "22P02" } });
      return null;
    };
    const roles = new FakeRoleReader({ "staff-1": "venue_staff" } as never);
    const app = createApp(deps, {
      now: () => NOW,
      ports: () => ({ bookings, events: new FakeEventReader([anEvent()]), venues: failing, roles, venueDetails: FakeVenueDetailsReader.from(failing) }),
    });
    const row = bookings.seed({ eventId: "event-1", venueId: "venue-1", requestedBy: "coordinator-1", ...SLOT });

    const res = await request(app)
      .post(`/venue-bookings/${row.id}/reject`)
      .set("Cookie", "cs_session=tok-staff-1")
      .send({ reason: REASON, suggestion: { ...LOTUS, venueId: "not-a-uuid" } });

    expect(res.status).toBe(422);
    expect(res.body.fieldErrors["suggestion.venueId"]).toBe("Choose a venue from the list.");
  });

  it("40-S4: any other failure reading the venue is not hidden: it is a server error", async () => {
    const bookings = new FakeBookingRepository(() => NOW);
    const failing = new FakeVenueReader([aVenue()]);
    failing.getById = async () => {
      throw new Error("database down");
    };
    const roles = new FakeRoleReader({ "staff-1": "venue_staff" } as never);
    const app = createApp(deps, {
      now: () => NOW,
      ports: () => ({ bookings, events: new FakeEventReader([anEvent()]), venues: failing, roles, venueDetails: FakeVenueDetailsReader.from(failing) }),
    });
    const row = bookings.seed({ eventId: "event-1", venueId: "venue-1", requestedBy: "coordinator-1", ...SLOT });

    const res = await request(app).post(`/venue-bookings/${row.id}/reject`).set("Cookie", "cs_session=tok-staff-1").send({ reason: REASON, suggestion: LOTUS });

    expect(res.status).toBe(500);
    expect(row.status).toBe("requested");
  });

  it("40-S4: the reason is still required, and a good suggestion does not make up for it", async () => {
    const { reject, pending } = setup();
    const row = pending();

    const res = await reject(row.id, { reason: "  ", suggestion: LOTUS });

    expect(res.status).toBe(422);
    expect(res.body.fieldErrors.reason).toBeTruthy();
    expect(row.status).toBe("requested");
    expect(row.suggestion).toBeNull();
  });
});

describe("SCRUM-40 only Venue Staff, and only while pending (40-S5)", () => {
  const OTHERS = ROLES.filter((r) => r !== "venue_staff").map((r) => `${r}-user`);

  it.each(OTHERS)("40-S5: %s gets 403 first, even with an invalid body, and nothing is stored", async (user) => {
    const { reject, pending } = setup();
    const row = pending();

    for (const body of [{ reason: REASON, suggestion: LOTUS }, { reason: "", suggestion: { venueId: "x" } }]) {
      const res = await reject(row.id, body, user);
      expect(res.status).toBe(403);
    }
    expect(row.status).toBe("requested");
    expect(row.suggestion).toBeNull();
  });

  it("40-S5: with no session the answer is 401", async () => {
    const { app, pending } = setup();
    const row = pending();

    expect((await request(app).post(`/venue-bookings/${row.id}/reject`).send({ reason: REASON, suggestion: LOTUS })).status).toBe(401);
  });

  it("40-S5: a request that is already decided cannot be rejected again, and the second suggestion is not stored", async () => {
    const { reject, pending } = setup();
    const row = pending();
    await reject(row.id, { reason: REASON, suggestion: LOTUS });

    const again = await reject(row.id, { reason: "Changed my mind", suggestion: { ...LOTUS, venueId: "venue-1" } });

    expect(again.status).toBe(409);
    expect(again.body.code).toBe("NOT_PENDING");
    expect(row.suggestion?.venueId).toBe("venue-2");
    expect(row.reviewNotes).toBe(REASON);
  });

  it("40-S5: an unknown request is 404", async () => {
    expect((await setup().reject("nope", { reason: REASON, suggestion: LOTUS })).status).toBe(404);
  });
});
