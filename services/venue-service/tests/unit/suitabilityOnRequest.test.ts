import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";
import { FakeBookingRepository } from "../support/fakeBookingRepository";
import { FakeEventReader, anEvent } from "../support/fakeEventReader";
import { FakeUserReader } from "../support/fakeUserReader";
import { FakeVenueDetailsReader, aVenueWithDetails } from "../support/fakeVenueDetails";
import { FakeRoleReader, FakeVenueReader, aVenue } from "../support/fakeVenueAndRoles";

// SCRUM-110 (docs/specs/venue-request-suitability.md): the suitability check on a venue booking request.
// "Orchid Hall" (venue-1, 200 seats, Theatre) suits "TechConf 2026"; "Lotus Room" (venue-2, 60 seats, Boardroom only) does not.

const NOW = new Date("2026-10-01T00:00:00.000Z");
const SLOT = { date: "2030-11-14", startTime: "09:00", endTime: "17:00" };
const REASON = "Organiser will run two smaller sessions";

const deps = {
  anon: { auth: { getUser: async (t: string) => ({ data: { user: t.startsWith("tok-") ? { id: t.slice(4) } : null } }) } },
  forUser: () => {
    throw new Error("ports are faked");
  },
} as unknown as SupabaseDeps;

const techConf = anEvent({ id: "event-1", name: "TechConf 2026", expectedAttendance: 120, venueRequirements: "Theatre" });

function setup(event = techConf) {
  const bookings = new FakeBookingRepository(() => NOW);
  const events = new FakeEventReader([event]);
  const venues = new FakeVenueReader([aVenue({ maxCapacity: 200 }), aVenue({ id: "venue-2", name: "Lotus Room", maxCapacity: 60 })]);
  const venueDetails = new FakeVenueDetailsReader([
    aVenueWithDetails(),
    aVenueWithDetails({ id: "venue-2", name: "Lotus Room", maxCapacity: 60, layouts: [{ id: "l-board", name: "Boardroom", maxCapacity: 60 }] }),
  ]);
  const roles = new FakeRoleReader({ "coordinator-1": "event_coordinator", "staff-1": "venue_staff" });
  const app = createApp(deps, {
    now: () => NOW,
    ports: () => ({ bookings, events, venues, roles, users: new FakeUserReader({ "coordinator-1": "Casey Coordinator" }), venueDetails }),
  });
  const as = (user: string) => `cs_session=tok-${user}`;
  const submit = (body: object) =>
    request(app).post("/venue-bookings").set("Cookie", as("coordinator-1")).send({ eventId: "event-1", ...SLOT, ...body });
  return { app, bookings, events, venues, venueDetails, submit, as };
}

describe("SCRUM-110/AC1 requesting a suitable venue (110-S1)", () => {
  it("110-S1: no warning, PENDING with suitability suitable", async () => {
    const { submit, bookings } = setup();
    const res = await submit({ venueId: "venue-1" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "PENDING", suitability: "suitable" });
    expect(bookings.rows[0]).toMatchObject({ suitability: "suitable", suitabilityUnmet: [], suitabilityOverrideReason: null });
  });

  it("110-S1: a reason sent for a suitable venue is not stored", async () => {
    const { submit, bookings } = setup();
    expect((await submit({ venueId: "venue-1", overrideReason: REASON })).status).toBe(201);
    expect(bookings.rows[0].suitabilityOverrideReason).toBeNull();
  });
});

describe("SCRUM-110/AC2 warning for an unsuitable venue (110-S2, 110-S2b)", () => {
  it("110-S2: without a reason, 409 UNSUITABLE_VENUE lists every unmet requirement and nothing is created", async () => {
    const { submit, bookings } = setup();
    const res = await submit({ venueId: "venue-2" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("UNSUITABLE_VENUE");
    expect(res.body.unmet).toEqual([
      { key: "capacity", label: "Capacity", message: "Expected attendance 120 exceeds capacity 60" },
      { key: "layout", label: "Layout", message: "Theatre not supported" },
    ]);
    expect(bookings.rows).toHaveLength(0);
  });

  it("110-S2: with a reason, the request is created Not suitable carrying the unmet list and the reason", async () => {
    const { submit, bookings } = setup();
    const res = await submit({ venueId: "venue-2", overrideReason: `  ${REASON}  ` });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "PENDING", suitability: "not_suitable" });
    expect(bookings.rows[0]).toMatchObject({ suitability: "not_suitable", suitabilityOverrideReason: REASON });
    expect(bookings.rows[0].suitabilityUnmet?.map((u) => u.key)).toEqual(["capacity", "layout"]);
  });

  it.each([["", 409], ["   ", 409]])("110-S2b: a blank reason (%j) is the same as none", async (overrideReason, status) => {
    const { submit, bookings } = setup();
    expect((await submit({ venueId: "venue-2", overrideReason })).status).toBe(status);
    expect(bookings.rows).toHaveLength(0);
  });

  it("110-S2b: a reason over 500 characters is 422 on overrideReason", async () => {
    const { submit, bookings } = setup();
    const res = await submit({ venueId: "venue-2", overrideReason: "a".repeat(501) });
    expect(res.status).toBe(422);
    expect(res.body.fieldErrors).toHaveProperty("overrideReason");
    expect(bookings.rows).toHaveLength(0);
  });
});

describe("SCRUM-110/AC5 unavailability still blocks (110-S5)", () => {
  it("110-S5: an overlapping booking is SLOT_CONFLICT even with a reason, never the confirm step", async () => {
    const { submit, bookings } = setup();
    bookings.seed({
      eventId: "other-event",
      venueId: "venue-2",
      status: "approved",
      start: new Date("2030-11-14T00:00:00Z"),
      end: new Date("2030-11-14T10:00:00Z"),
    });
    const res = await submit({ venueId: "venue-2", overrideReason: REASON });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SLOT_CONFLICT");
    expect(res.body).not.toHaveProperty("unmet");
    expect(bookings.rows).toHaveLength(1);
  });

  it("110-S5: without a reason the answer is still SLOT_CONFLICT, not UNSUITABLE_VENUE", async () => {
    const { submit, bookings } = setup();
    bookings.seed({ eventId: "other-event", venueId: "venue-2", status: "requested", start: new Date("2030-11-14T00:00:00Z"), end: new Date("2030-11-14T10:00:00Z") });
    expect((await submit({ venueId: "venue-2" })).body.code).toBe("SLOT_CONFLICT");
  });
});

describe("SCRUM-110/AC4 Venue Staff see the result (110-S4)", () => {
  it("110-S4: the queue list and detail carry the suitability, the unmet requirements and the reason", async () => {
    const { submit, as, app } = setup();
    const created = await submit({ venueId: "venue-2", overrideReason: REASON });

    const list = await request(app).get("/booking-queue").set("Cookie", as("staff-1"));
    expect(list.body[0]).toMatchObject({
      id: created.body.id,
      suitability: "not_suitable",
      suitabilityOverrideReason: REASON,
    });
    expect(list.body[0].suitabilityUnmet.map((u: { message: string }) => u.message)).toEqual([
      "Expected attendance 120 exceeds capacity 60",
      "Theatre not supported",
    ]);

    const detail = await request(app).get(`/booking-queue/${created.body.id}`).set("Cookie", as("staff-1"));
    expect(detail.body).toMatchObject({ suitability: "not_suitable", suitabilityOverrideReason: REASON });
    expect(detail.body.suitabilityUnmet).toHaveLength(2);
  });

  it("110-S4: a suitable request shows suitable with nothing unmet", async () => {
    const { submit, as, app } = setup();
    await submit({ venueId: "venue-1" });
    const list = await request(app).get("/booking-queue").set("Cookie", as("staff-1"));
    expect(list.body[0]).toMatchObject({ suitability: "suitable", suitabilityUnmet: [], suitabilityOverrideReason: null });
  });

  it("110-S4: an older request without a stored result shows none", async () => {
    const { bookings, as, app } = setup();
    bookings.seed({ eventId: "event-1", venueId: "venue-1", start: new Date("2030-11-14T01:00:00Z"), end: new Date("2030-11-14T09:00:00Z") });
    const list = await request(app).get("/booking-queue").set("Cookie", as("staff-1"));
    expect(list.body[0]).toMatchObject({ suitability: null, suitabilityUnmet: [], suitabilityOverrideReason: null });
  });
});

describe("SCRUM-110/AC6 a multi-venue booking is checked on its own attendance (110-S6)", () => {
  // TechConf expects 120. "Breakout A" is a booking of it for 40 people at Lotus Room (60 seats, SCRUM-98).
  const breakout = { venueId: "venue-2", expectedAttendance: 40, venueRequirements: "Boardroom" };

  it("110-S6: attendance 40 is compared with capacity 60, not the event's 120, and its layout with the venue's", async () => {
    const { submit, bookings } = setup();
    const res = await submit(breakout);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ suitability: "suitable", exceedsCapacity: false });
    expect(bookings.rows[0].snapshot).toMatchObject({ expectedAttendance: 40, venueRequirements: "Boardroom" });
  });

  it("110-S6: without its own numbers the booking is judged on the event's 120 and Theatre", async () => {
    const { submit } = setup();
    expect((await submit({ venueId: "venue-2" })).body.code).toBe("UNSUITABLE_VENUE");
  });

  it("110-S6: its own attendance can be the unsuitable one (80 in a 60-seat room) and then needs a reason", async () => {
    const { submit, bookings } = setup();
    const body = { venueId: "venue-2", expectedAttendance: 80, venueRequirements: "Boardroom" };
    const refused = await submit(body);
    expect(refused.status).toBe(409);
    expect(refused.body.unmet).toEqual([{ key: "capacity", label: "Capacity", message: "Expected attendance 80 exceeds capacity 60" }]);
    expect(bookings.rows).toHaveLength(0);
    expect((await submit({ ...body, overrideReason: REASON })).body).toMatchObject({ suitability: "not_suitable", exceedsCapacity: true });
  });

  it("110-S6: two bookings of one event are each judged on their own (Orchid for 120 is fine, Lotus for 40 is fine)", async () => {
    const { submit, bookings } = setup();
    expect((await submit({ venueId: "venue-1" })).status).toBe(201);
    expect((await submit({ ...breakout, startTime: "09:00" })).status).toBe(201);
    expect(bookings.rows.map((r) => r.suitability)).toEqual(["suitable", "suitable"]);
  });
});

describe("SCRUM-110 changing a booking makes its result afresh (110-S10)", () => {
  const change = (ctx: ReturnType<typeof setup>, id: string, body: object) =>
    request(ctx.app).patch(`/venue-bookings/${id}`).set("Cookie", ctx.as("coordinator-1")).send({ ...SLOT, ...body });
  const held = (ctx: ReturnType<typeof setup>, extra: object = {}) =>
    ctx.bookings.seed({
      eventId: "event-1",
      venueId: "venue-1",
      start: new Date("2030-11-14T01:00:00Z"),
      end: new Date("2030-11-14T09:00:00Z"),
      status: "approved",
      suitability: "suitable",
      suitabilityUnmet: [],
      snapshot: { eventName: "TechConf 2026", expectedAttendance: 120, venueRequirements: "Theatre", accessibilityNeeds: null },
      ...extra,
    });

  it("110-S10: raising the attendance past the venue needs a reason; nothing changes without one", async () => {
    const ctx = setup();
    const row = held(ctx);
    const refused = await change(ctx, row.id, { expectedAttendance: 300 });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("UNSUITABLE_VENUE");
    expect(row).toMatchObject({ status: "approved", suitability: "suitable" });
    expect(row.snapshot.expectedAttendance).toBe(120);
  });

  it("110-S10: with a reason it goes back to PENDING carrying the new result, unmet list and reason", async () => {
    const ctx = setup();
    const row = held(ctx);
    const res = await change(ctx, row.id, { expectedAttendance: 300, overrideReason: REASON });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "PENDING", suitability: "not_suitable" });
    expect(row).toMatchObject({ suitability: "not_suitable", suitabilityOverrideReason: REASON });
    expect(row.suitabilityUnmet?.map((u) => u.key)).toEqual(["capacity"]);
  });

  it("110-S10: changing an unsuitable booking back to numbers that fit clears the warning and the reason", async () => {
    const ctx = setup();
    const row = held(ctx, {
      suitability: "not_suitable",
      suitabilityUnmet: [{ key: "capacity", label: "Capacity", message: "Expected attendance 300 exceeds capacity 180" }],
      suitabilityOverrideReason: REASON,
      snapshot: { eventName: "TechConf 2026", expectedAttendance: 300, venueRequirements: "Theatre", accessibilityNeeds: null },
    });
    const res = await change(ctx, row.id, { expectedAttendance: 100, overrideReason: "ignored" });
    expect(res.status).toBe(200);
    expect(row).toMatchObject({ suitability: "suitable", suitabilityUnmet: [], suitabilityOverrideReason: null });
  });

  it("110-S10: a change that leaves the numbers as they were is still NO_CHANGES (102-S9), before any suitability talk", async () => {
    const ctx = setup();
    const row = held(ctx);
    expect((await change(ctx, row.id, {})).body.code).toBe("NO_CHANGES");
  });

  it("110-S10: a reason over 500 characters is 422", async () => {
    const ctx = setup();
    const row = held(ctx);
    const res = await change(ctx, row.id, { expectedAttendance: 300, overrideReason: "a".repeat(501) });
    expect(res.status).toBe(422);
    expect(res.body.fieldErrors).toHaveProperty("overrideReason");
  });
});

describe("SCRUM-110 not-checked and manual lines never raise the warning (110-S9)", () => {
  it("110-S9: no layout recorded and a free-text accessibility note still submit", async () => {
    const { submit } = setup({ ...techConf, venueRequirements: null, expectedAttendance: 40, accessibilityNeeds: "Stage must face the windows" });
    const res = await submit({ venueId: "venue-2" });
    expect(res.status).toBe(201);
    expect(res.body.suitability).toBe("suitable");
  });
});

describe("SCRUM-110 amend and accept-suggestion use the same check (110-S8)", () => {
  function withRejected() {
    const ctx = setup();
    const r1 = ctx.bookings.seed({
      eventId: "event-1",
      venueId: "venue-1",
      start: new Date("2030-11-14T01:00:00Z"),
      end: new Date("2030-11-14T09:00:00Z"),
      status: "rejected",
      reviewNotes: "Under renovation",
      reviewedBy: "staff-1",
      reviewedAt: NOW,
      suggestion: { venueId: "venue-2", start: new Date("2030-11-15T01:00:00Z"), end: new Date("2030-11-15T09:00:00Z") },
    });
    return { ...ctx, r1 };
  }
  const post = (ctx: ReturnType<typeof withRejected>, path: string, body: object = {}) =>
    request(ctx.app).post(path).set("Cookie", ctx.as("coordinator-1")).send(body);

  it("110-S8: amending to an unsuitable venue needs a reason", async () => {
    const ctx = withRejected();
    const slot = { venueId: "venue-2", ...SLOT, date: "2030-11-16" };
    expect((await post(ctx, `/venue-bookings/${ctx.r1.id}/amend`, slot)).body.code).toBe("UNSUITABLE_VENUE");
    const ok = await post(ctx, `/venue-bookings/${ctx.r1.id}/amend`, { ...slot, overrideReason: REASON });
    expect(ok.status).toBe(201);
    expect(ok.body.suitability).toBe("not_suitable");
  });

  it("110-S8: accepting a suggestion for an unsuitable venue asks for a reason, then accepts it", async () => {
    const ctx = withRejected();
    const first = await post(ctx, `/venue-bookings/${ctx.r1.id}/accept-suggestion`);
    expect(first.status).toBe(409);
    expect(first.body.code).toBe("UNSUITABLE_VENUE");

    const second = await post(ctx, `/venue-bookings/${ctx.r1.id}/accept-suggestion`, { overrideReason: REASON });
    expect(second.status).toBe(201);
    expect(second.body).toMatchObject({ venueId: "venue-2", suitability: "not_suitable" });
  });
});
