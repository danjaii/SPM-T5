import request from "supertest";
import { describe, it, expect } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";
import { FakeBookingRepository } from "../support/fakeBookingRepository";
import { FakeEventReader, anEvent } from "../support/fakeEventReader";
import { FakeRoleReader, FakeVenueReader, aVenue } from "../support/fakeVenueAndRoles";

const NOW = new Date("2026-10-05T03:00:00.000Z");
const SLOT = { start: new Date("2030-11-14T01:00:00Z"), end: new Date("2030-11-14T09:00:00Z") };

const deps = {
  anon: { auth: { getUser: async (t: string) => ({ data: { user: t.startsWith("tok-") ? { id: t.slice(4) } : null } }) } },
  forUser: () => {
    throw new Error("ports are faked");
  },
} as unknown as SupabaseDeps;

function setup() {
  const bookings = new FakeBookingRepository(() => NOW);
  const events = new FakeEventReader([anEvent()]);
  const venues = new FakeVenueReader([aVenue()]);
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
  const approve = (id: string, user = "staff-1") => request(app).post(`/venue-bookings/${id}/approve`).set("Cookie", as(user));
  const eventBooking = (eventId = "event-1", user = "coordinator-1") =>
    request(app).get(`/events/${eventId}/venue-booking`).set("Cookie", as(user));
  const pending = (over: Record<string, unknown> = {}) =>
    bookings.seed({ eventId: "event-1", venueId: "venue-1", ...SLOT, ...over });
  return { app, bookings, events, approve, eventBooking, pending, as };
}

describe("SCRUM-38/AC1 approving a pending request (38-S1)", () => {
  it("38-S1 becomes APPROVED with who and when recorded, and leaves the pending queue", async () => {
    const { bookings, approve, pending } = setup();
    const row = pending();
    const res = await approve(row.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: row.id,
      status: "APPROVED",
      decidedBy: "staff-1",
      decidedAt: NOW.toISOString(),
      rejectionReason: null,
      date: "2030-11-14",
      startTime: "09:00",
      endTime: "17:00",
    });
    expect(row).toMatchObject({ status: "approved", reviewedBy: "staff-1", reviewedAt: NOW });
    expect(await bookings.listPending()).toEqual([]);
  });

  it("38-S1 404 for an unknown request", async () => {
    expect((await setup().approve("nope")).status).toBe(404);
  });
});

describe("SCRUM-38/AC2 a decided request cannot be approved again (38-S2)", () => {
  it.each(["approved", "rejected", "withdrawn"])("38-S2 %s: 409 NOT_PENDING and unchanged", async (status) => {
    const { approve, pending } = setup();
    const row = pending({ status });
    const res = await approve(row.id);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: "NOT_PENDING", error: "This request is no longer pending." });
    expect(row.status).toBe(status);
    expect(row.reviewedAt).toBeNull();
  });

  it("38-S2 the pending check comes before the past-time check", async () => {
    const { approve, pending } = setup();
    const row = pending({ status: "rejected", start: new Date("2026-10-01T01:00:00Z"), end: new Date("2026-10-01T09:00:00Z") });
    expect((await approve(row.id)).body.code).toBe("NOT_PENDING");
  });
});

describe("SCRUM-38/AC3 two decisions at the same moment (38-S3)", () => {
  it("38-S3 approve + approve in parallel: exactly one succeeds, the other is NOT_PENDING", async () => {
    const { approve, pending } = setup();
    const row = pending();
    const results = await Promise.all([approve(row.id, "staff-1"), approve(row.id, "staff-2")]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)?.body.code).toBe("NOT_PENDING");
    expect(row.status).toBe("approved");
  });

  it("38-S3 approve + reject in parallel: exactly one wins", async () => {
    const { bookings, approve, pending } = setup();
    const row = pending();
    const [approved, rejected] = await Promise.all([
      approve(row.id),
      bookings.decide(row.id, { outcome: "rejected", reason: "Renovation" }, "staff-2", NOW),
    ]);
    expect([approved.status === 200, rejected !== null].filter(Boolean)).toHaveLength(1);
  });

  it("38-S3 a decision landing between the pre-check and the update is NOT_PENDING", async () => {
    const { bookings, approve, pending } = setup();
    const row = pending();
    const real = bookings.decide.bind(bookings);
    let first = true;
    bookings.decide = async (...args) => {
      if (first) {
        first = false;
        await real(row.id, { outcome: "rejected", reason: "Other" }, "staff-2", NOW);
      }
      return real(...args);
    };
    const res = await approve(row.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NOT_PENDING");
    expect(row.status).toBe("rejected");
  });
});

describe("SCRUM-38/AC4 the event shows its approved venue (38-S4)", () => {
  it("38-S4 returns the venue, date and time; the event is untouched", async () => {
    const { events, approve, eventBooking, pending } = setup();
    const before = structuredClone(await events.getById("event-1"));
    await approve(pending().id);

    const res = await eventBooking();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ venueName: "Orchid Hall", date: "2030-11-14", startTime: "09:00", endTime: "17:00" });
    expect(await events.getById("event-1")).toEqual(before);
  });

  it("38-S4 is null while nothing is approved (pending or rejected only)", async () => {
    const { eventBooking, pending } = setup();
    pending({ status: "rejected" });
    pending();
    const res = await eventBooking();
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it("38-S4 only the event's assigned coordinator may ask; unknown event is 404", async () => {
    const { eventBooking } = setup();
    for (const user of ["coordinator-2", "organiser-1", "staff-1", "tech-1", "attendee-1"]) {
      expect((await eventBooking("event-1", user)).status, user).toBe(403);
    }
    expect((await eventBooking("nope")).status).toBe(404);
  });
});

describe("SCRUM-38/AC5 the venue becomes committed (38-S5, in memory)", () => {
  it("38-S5 after approval an overlapping request from another event is SLOT_CONFLICT", async () => {
    const { app, events, approve, pending, as } = setup();
    events.add(anEvent({ id: "event-2", assignedCoordinatorId: "coordinator-2" }));
    await approve(pending().id);
    const res = await request(app)
      .post("/venue-bookings")
      .set("Cookie", as("coordinator-2"))
      .send({ eventId: "event-2", venueId: "venue-1", date: "2030-11-14", startTime: "10:00", endTime: "12:00" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SLOT_CONFLICT");
  });
});

describe("SCRUM-38/AC6 the outcome reaches the Coordinator (38-S6, in memory)", () => {
  it("38-S6 the coordinator's list shows APPROVED with its decision date", async () => {
    const { app, approve, pending, as } = setup();
    const row = pending({ requestedBy: "coordinator-1" });
    await approve(row.id);
    const res = await request(app).get("/venue-bookings").set("Cookie", as("coordinator-1"));
    expect(res.body).toEqual([expect.objectContaining({ id: row.id, status: "APPROVED", decidedAt: NOW.toISOString() })]);
  });
});

describe("SCRUM-38/AC7 no automatic suitability check (38-S7)", () => {
  it("38-S7 attendance above capacity still approves", async () => {
    const { approve, pending } = setup();
    const row = pending({
      snapshot: { eventName: "Big", expectedAttendance: 5000, venueRequirements: null, accessibilityNeeds: null },
    });
    const res = await approve(row.id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("APPROVED");
  });
});

describe("SCRUM-38/AC8 the requested time has already passed (38-S8)", () => {
  it("38-S8 start in the past: 409 SLOT_IN_PAST and still PENDING", async () => {
    const { approve, pending } = setup();
    const row = pending({ start: new Date("2026-10-05T02:00:00Z"), end: new Date("2026-10-05T09:00:00Z") });
    const res = await approve(row.id);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: "SLOT_IN_PAST", error: "The requested time has already passed." });
    expect(row.status).toBe("requested");
  });

  it("38-S8 a start exactly now is not yet in the past", async () => {
    const { approve, pending } = setup();
    const row = pending({ start: NOW, end: new Date("2026-10-05T09:00:00Z") });
    expect((await approve(row.id)).status).toBe(200);
  });
});

describe("SCRUM-38/AC9 only Venue Staff may approve (38-S9)", () => {
  it.each(["coordinator-1", "coordinator-2", "organiser-1", "tech-1", "attendee-1", "ghost"])(
    "38-S9 %s gets 403 and the request stays PENDING",
    async (user) => {
      const { approve, pending } = setup();
      const row = pending({ requestedBy: "coordinator-1" });
      const res = await approve(row.id, user);
      expect(res.status).toBe(403);
      expect(Object.keys(res.body).sort()).toEqual(["code", "error"]);
      expect(row.status).toBe("requested");
    },
  );

  it("38-S9 no session is 401", async () => {
    const { app, pending } = setup();
    const row = pending();
    expect((await request(app).post(`/venue-bookings/${row.id}/approve`)).status).toBe(401);
    expect(row.status).toBe("requested");
  });

  it("38-S9 the role check comes before the lookup, so a wrong role learns nothing about the id", async () => {
    expect((await setup().approve("nope", "coordinator-1")).status).toBe(403);
  });
});
