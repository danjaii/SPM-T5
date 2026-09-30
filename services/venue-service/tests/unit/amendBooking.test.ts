import request from "supertest";
import { describe, it, expect } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";
import { FakeBookingRepository } from "../support/fakeBookingRepository";
import { FakeEventReader, anEvent } from "../support/fakeEventReader";
import { FakeRoleReader, FakeVenueReader, aVenue } from "../support/fakeVenueAndRoles";

const NOW = new Date("2026-10-05T03:00:00.000Z");
const DECIDED = new Date("2026-10-04T00:00:00.000Z");
const R1_SLOT = { start: new Date("2030-11-14T01:00:00Z"), end: new Date("2030-11-14T09:00:00Z") };
const AMEND = { venueId: "venue-2", date: "2030-11-14", startTime: "09:00", endTime: "17:00" };

const deps = {
  anon: { auth: { getUser: async (t: string) => ({ data: { user: t.startsWith("tok-") ? { id: t.slice(4) } : null } }) } },
  forUser: () => {
    throw new Error("ports are faked");
  },
} as unknown as SupabaseDeps;

function setup(eventOverrides = {}) {
  const bookings = new FakeBookingRepository(() => NOW);
  const events = new FakeEventReader([anEvent(eventOverrides)]);
  const venues = new FakeVenueReader([aVenue(), aVenue({ id: "venue-2", name: "Lotus Room" })]);
  const roles = new FakeRoleReader({
    "coordinator-1": "event_coordinator",
    "coordinator-2": "event_coordinator",
    "organiser-1": "event_organiser",
    "staff-1": "venue_staff",
    "tech-1": "technical_support_staff",
    "attendee-1": "attendee",
  });
  const app = createApp(deps, { now: () => NOW, ports: () => ({ bookings, events, venues, roles }) });
  const amend = (id: string, body: object = AMEND, user = "coordinator-1") =>
    request(app).post(`/venue-bookings/${id}/amend`).set("Cookie", `cs_session=tok-${user}`).send(body);
  const r1 = () =>
    bookings.seed({
      eventId: "event-1",
      venueId: "venue-1",
      ...R1_SLOT,
      status: "rejected",
      reviewNotes: "Room under renovation",
      reviewedBy: "staff-1",
      reviewedAt: DECIDED,
    });
  return { app, bookings, events, amend, r1 };
}

describe("SCRUM-60/AC1 amending a rejected request (60-S1)", () => {
  it("60-S1 creates a new PENDING request that refers to R1, with a fresh snapshot, and leaves R1 unchanged", async () => {
    const { amend, bookings, events, r1 } = setup();
    const original = r1();
    const before = structuredClone(original);
    events.add(anEvent({ expectedAttendance: 75 }));

    const res = await amend(original.id);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "PENDING", venueId: "venue-2", expectedAttendance: 75, submittedAt: NOW.toISOString() });
    const created = bookings.rows.find((r) => r.id === res.body.id)!;
    expect(created.amendsBookingId).toBe(original.id);
    expect(created.fromSuggestion).toBe(false);
    expect(bookings.rows.find((r) => r.id === original.id)).toEqual(before);
  });

  it("does not let the body pick a different event", async () => {
    const { amend, bookings, r1 } = setup();
    const res = await amend(r1().id, { ...AMEND, eventId: "some-other-event" });
    expect(res.status).toBe(201);
    expect(bookings.rows.find((r) => r.id === res.body.id)?.eventId).toBe("event-1");
  });

  it("404 for an unknown request", async () => {
    expect((await setup().amend("nope")).status).toBe(404);
  });

  it("an empty body is a validation failure", async () => {
    const { app, r1 } = setup();
    const res = await request(app).post(`/venue-bookings/${r1().id}/amend`).set("Cookie", "cs_session=tok-coordinator-1");
    expect(res.status).toBe(422);
  });
});

describe("SCRUM-60/AC2 the amendment must differ from earlier rejections (60-S2)", () => {
  const same = { venueId: "venue-1", date: "2030-11-14", startTime: "09:00", endTime: "17:00" };

  it("60-S2 identical to R1: 409 REPEAT_OF_REJECTED", async () => {
    const { amend, r1 } = setup();
    const res = await amend(r1().id, same);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("REPEAT_OF_REJECTED");
  });

  it("60-S2 identical to an earlier rejected R0 of the same event is also refused", async () => {
    const { amend, bookings, r1 } = setup();
    bookings.seed({ eventId: "event-1", venueId: "venue-2", ...R1_SLOT, status: "rejected" });
    const original = r1();
    const res = await amend(original.id, { ...same, venueId: "venue-2" });
    expect(res.body.code).toBe("REPEAT_OF_REJECTED");
  });

  it.each([
    ["venue", { venueId: "venue-2" }],
    ["date", { date: "2030-11-15" }],
    ["start", { startTime: "10:00" }],
    ["end", { endTime: "16:00" }],
  ])("60-S2 changing only the %s is not refused", async (_name, patch) => {
    const { amend, r1 } = setup();
    expect((await amend(r1().id, { ...same, ...patch })).status).toBe(201);
  });
});

describe("SCRUM-60/AC3 the same checks as a new request apply (60-S3)", () => {
  it("60-S3 an ineligible event is 409 EVENT_NOT_ELIGIBLE", async () => {
    const { amend, r1 } = setup({ status: "cancelled" });
    expect((await amend(r1().id)).body.code).toBe("EVENT_NOT_ELIGIBLE");
  });

  it("60-S3 invalid times are 422", async () => {
    const { amend, r1 } = setup();
    const res = await amend(r1().id, { ...AMEND, startTime: "17:00", endTime: "09:00" });
    expect(res.status).toBe(422);
    expect(res.body.fieldErrors).toHaveProperty("endTime");
  });

  it("60-S3 a slot held by another event is 409 SLOT_CONFLICT", async () => {
    const { amend, bookings, r1 } = setup();
    bookings.seed({ eventId: "other-event", venueId: "venue-2", start: new Date("2030-11-14T03:00:00Z"), end: new Date("2030-11-14T05:00:00Z") });
    const original = r1();
    const res = await amend(original.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SLOT_CONFLICT");
    expect(bookings.rows.filter((r) => r.amendsBookingId === original.id)).toHaveLength(0);
  });
});

describe("SCRUM-60/AC4 only rejected requests can be amended (60-S4)", () => {
  it.each(["requested", "approved", "withdrawn"])("60-S4 %s: 409 NOT_REJECTED", async (status) => {
    const { amend, bookings } = setup();
    const row = bookings.seed({ eventId: "event-1", venueId: "venue-1", ...R1_SLOT, status });
    const res = await amend(row.id);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: "NOT_REJECTED", error: "Only a rejected request can be amended." });
  });

  it("60-S4 a rejected request is allowed with or without a suggestion", async () => {
    const withSuggestion = setup();
    const a = withSuggestion.r1();
    a.suggestion = { venueId: "venue-2", start: R1_SLOT.start, end: R1_SLOT.end };
    expect((await withSuggestion.amend(a.id, { ...AMEND, venueId: "venue-2", date: "2030-11-16" })).status).toBe(201);
    const without = setup();
    expect((await without.amend(without.r1().id)).status).toBe(201);
  });
});

describe("SCRUM-60/AC5 one active request at a time (60-S5)", () => {
  it.each(["requested", "approved"])("60-S5 amending R1 again while the amendment is %s: 409 ACTIVE_REQUEST_EXISTS", async (status) => {
    const { amend, bookings, r1 } = setup();
    const original = r1();
    const first = await amend(original.id);
    Object.assign(bookings.rows.find((r) => r.id === first.body.id)!, { status });
    const res = await amend(original.id, { ...AMEND, date: "2030-11-20" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ACTIVE_REQUEST_EXISTS");
  });
});

describe("SCRUM-60/AC6 amending an amendment (60-S6)", () => {
  it("60-S6 R3 refers to R2 and the history of each is [R1, R2, R3]", async () => {
    const { app, amend, bookings, r1 } = setup();
    const original = r1();
    const r2 = (await amend(original.id)).body;
    Object.assign(bookings.rows.find((r) => r.id === r2.id)!, { status: "rejected", reviewedAt: DECIDED, reviewNotes: "No" });
    const r3 = (await amend(r2.id, { ...AMEND, date: "2030-11-20" })).body;
    expect(bookings.rows.find((r) => r.id === r3.id)?.amendsBookingId).toBe(r2.id);

    for (const id of [original.id, r2.id, r3.id]) {
      const detail = await request(app).get(`/venue-bookings/${id}`).set("Cookie", "cs_session=tok-coordinator-1");
      expect(detail.body.chain.map((c: { id: string }) => c.id)).toEqual([original.id, r2.id, r3.id]);
    }
  });
});

describe("SCRUM-60/AC7 only the assigned Coordinator may amend (60-S7)", () => {
  it.each(["coordinator-2", "organiser-1", "staff-1", "tech-1", "attendee-1"])("60-S7 %s gets 403 and no request is created", async (user) => {
    const { amend, bookings, r1 } = setup();
    const row = r1();
    const res = await amend(row.id, AMEND, user);
    expect(res.status).toBe(403);
    expect(Object.keys(res.body).sort()).toEqual(["code", "error"]);
    expect(bookings.rows).toHaveLength(1);
  });

  it("60-S7 no session is 401", async () => {
    const { app, r1 } = setup();
    expect((await request(app).post(`/venue-bookings/${r1().id}/amend`).send(AMEND)).status).toBe(401);
  });

  it("403 when the event is no longer visible to the caller", async () => {
    const { amend, bookings } = setup();
    const orphan = bookings.seed({ eventId: "deleted", venueId: "venue-1", ...R1_SLOT, status: "rejected" });
    expect((await amend(orphan.id)).status).toBe(403);
  });
});
