import request from "supertest";
import { describe, it, expect } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";
import { FakeBookingRepository } from "../support/fakeBookingRepository";
import { FakeEventReader, anEvent } from "../support/fakeEventReader";
import { FakeUserReader } from "../support/fakeUserReader";
import { FakeRoleReader, FakeVenueReader, aVenue } from "../support/fakeVenueAndRoles";

const NOW = new Date("2026-10-05T03:00:00.000Z");
const DECIDED = new Date("2026-10-04T00:00:00.000Z");
// Suggested: Lotus Room, 2030-11-15, 09:00-17:00 SGT.
const SUGGESTION = { venueId: "venue-2", start: new Date("2030-11-15T01:00:00Z"), end: new Date("2030-11-15T09:00:00Z") };

const deps = {
  anon: { auth: { getUser: async (t: string) => ({ data: { user: t.startsWith("tok-") ? { id: t.slice(4) } : null } }) } },
  forUser: () => {
    throw new Error("ports are faked");
  },
} as unknown as SupabaseDeps;

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
  const app = createApp(deps, { now: () => NOW, ports: () => ({ bookings, events, venues, roles, users: new FakeUserReader() }) });
  const accept = (id: string, user = "coordinator-1") =>
    request(app).post(`/venue-bookings/${id}/accept-suggestion`).set("Cookie", `cs_session=tok-${user}`);
  const r1 = (extra = {}) =>
    bookings.seed({
      eventId: "event-1",
      venueId: "venue-1",
      start: new Date("2030-11-14T01:00:00Z"),
      end: new Date("2030-11-14T09:00:00Z"),
      status: "rejected",
      reviewNotes: "Room under renovation",
      reviewedBy: "staff-1",
      reviewedAt: DECIDED,
      suggestion: SUGGESTION,
      ...extra,
    });
  return { app, bookings, events, accept, r1 };
}

describe("SCRUM-59/AC1 accepting a suggested alternative (59-S1)", () => {
  it("59-S1 creates a PENDING request for the suggestion that refers to R1, and leaves R1 unchanged", async () => {
    const { accept, bookings, events, r1 } = setup();
    const original = r1();
    const before = structuredClone(original);
    events.add(anEvent({ expectedAttendance: 90 }));

    const res = await accept(original.id);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: "PENDING",
      venueId: "venue-2",
      date: "2030-11-15",
      startTime: "09:00",
      endTime: "17:00",
      expectedAttendance: 90,
      submittedAt: NOW.toISOString(),
    });
    const created = bookings.rows.find((r) => r.id === res.body.id)!;
    expect(created).toMatchObject({ amendsBookingId: original.id, fromSuggestion: true });
    expect(bookings.rows.find((r) => r.id === original.id)).toEqual(before);
  });

  it("404 for an unknown request", async () => {
    expect((await setup().accept("nope")).status).toBe(404);
  });
});

describe("SCRUM-59/AC2 the suggested slot has been taken since (59-S2)", () => {
  it("59-S2 is 409 SLOT_CONFLICT with no row, and the suggestion is still returned by the detail", async () => {
    const { app, accept, bookings, r1 } = setup();
    const original = r1();
    bookings.seed({ eventId: "other-event", venueId: "venue-2", start: new Date("2030-11-15T03:00:00Z"), end: new Date("2030-11-15T05:00:00Z") });
    const res = await accept(original.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SLOT_CONFLICT");
    expect(bookings.rows.filter((r) => r.amendsBookingId === original.id)).toHaveLength(0);

    const detail = await request(app).get(`/venue-bookings/${original.id}`).set("Cookie", "cs_session=tok-coordinator-1");
    expect(detail.body.suggestion).toMatchObject({ venueName: "Lotus Room", date: "2030-11-15" });
  });
});

describe("SCRUM-59/AC3 a suggestion can be accepted once (59-S3)", () => {
  it("59-S3 a second accept is 409 SUGGESTION_ALREADY_USED and creates no second row", async () => {
    const { accept, bookings, r1 } = setup();
    const original = r1();
    expect((await accept(original.id)).status).toBe(201);
    const res = await accept(original.id);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: "SUGGESTION_ALREADY_USED", error: "The suggested alternative has already been used." });
    expect(bookings.rows.filter((r) => r.amendsBookingId === original.id)).toHaveLength(1);
  });

  it("59-S3 stays used even after the accepted request is itself rejected", async () => {
    const { accept, bookings, r1 } = setup();
    const original = r1();
    const first = await accept(original.id);
    Object.assign(bookings.rows.find((r) => r.id === first.body.id)!, { status: "rejected" });
    expect((await accept(original.id)).body.code).toBe("SUGGESTION_ALREADY_USED");
  });
});

describe("SCRUM-59/AC4 there must be a suggestion on a rejected request (59-S4)", () => {
  it("59-S4 a rejected request with no suggestion: 409 NO_SUGGESTION", async () => {
    const { accept, r1 } = setup();
    const res = await accept(r1({ suggestion: null }).id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NO_SUGGESTION");
  });

  it.each(["requested", "approved", "withdrawn"])("59-S4 %s: 409 NOT_REJECTED", async (status) => {
    const { accept, r1 } = setup();
    const res = await accept(r1({ status }).id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NOT_REJECTED");
  });
});

describe("SCRUM-59/AC5 the event is not changed (59-S5)", () => {
  it("59-S5 the event's proposed date and times are unchanged after accepting", async () => {
    const { accept, events, r1 } = setup();
    await accept(r1().id);
    const event = await events.getById("event-1");
    expect(event?.proposedStart).toEqual(new Date("2030-11-14T01:00:00.000Z"));
    expect(event?.proposedEnd).toEqual(new Date("2030-11-14T09:00:00.000Z"));
  });
});

describe("SCRUM-59/AC6 only the assigned Coordinator may accept (59-S6)", () => {
  it.each(["coordinator-2", "organiser-1", "staff-1", "tech-1", "attendee-1"])("59-S6 %s gets 403 and no request is created", async (user) => {
    const { accept, bookings, r1 } = setup();
    const res = await accept(r1().id, user);
    expect(res.status).toBe(403);
    expect(Object.keys(res.body).sort()).toEqual(["code", "error"]);
    expect(bookings.rows).toHaveLength(1);
  });

  it("59-S6 no session is 401", async () => {
    const { app, r1 } = setup();
    expect((await request(app).post(`/venue-bookings/${r1().id}/accept-suggestion`)).status).toBe(401);
  });
});

describe("SCRUM-59 the same checks as any new request still apply", () => {
  it("an ineligible event is 409 EVENT_NOT_ELIGIBLE", async () => {
    const { accept, events, r1 } = setup();
    events.add(anEvent({ status: "cancelled" }));
    expect((await accept(r1().id)).body.code).toBe("EVENT_NOT_ELIGIBLE");
  });

  it("a suggestion whose start has since passed is a 422 validation failure", async () => {
    const { accept, r1 } = setup();
    const stale = { venueId: "venue-2", start: new Date("2026-01-01T01:00:00Z"), end: new Date("2026-01-01T09:00:00Z") };
    expect((await accept(r1({ suggestion: stale }).id)).status).toBe(422);
  });
});
