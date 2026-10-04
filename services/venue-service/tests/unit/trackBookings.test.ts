import request from "supertest";
import { describe, it, expect } from "vitest";
import { createApp } from "../../src/app";
import type { BookingRecord } from "../../src/domain/types";
import { amendmentChain } from "../../src/services/trackingService";
import type { SupabaseDeps } from "../../src/supabase";
import { FakeBookingRepository } from "../support/fakeBookingRepository";
import { FakeEventReader, anEvent } from "../support/fakeEventReader";
import { FakeUserReader } from "../support/fakeUserReader";
import { FakeRoleReader, FakeVenueReader, aVenue } from "../support/fakeVenueAndRoles";

const deps = {
  anon: { auth: { getUser: async (t: string) => ({ data: { user: t.startsWith("tok-") ? { id: t.slice(4) } : null } }) } },
  forUser: () => {
    throw new Error("ports are faked");
  },
} as unknown as SupabaseDeps;

const at = (day: number) => new Date(Date.UTC(2026, 9, day)); // submission times: 1..4 Oct 2026
const slot = (day: number) => ({ start: new Date(`2030-11-${day}T01:00:00Z`), end: new Date(`2030-11-${day}T09:00:00Z`) });

function setup() {
  let clock = at(1);
  const bookings = new FakeBookingRepository(() => clock);
  const events = new FakeEventReader([
    anEvent({ id: "event-1" }),
    anEvent({ id: "event-2" }),
    anEvent({ id: "event-3", assignedCoordinatorId: "coordinator-2" }),
  ]);
  const venues = new FakeVenueReader([aVenue(), aVenue({ id: "venue-2", name: "Lotus Room" })]);
  const roles = new FakeRoleReader({
    "coordinator-1": "event_coordinator",
    "coordinator-2": "event_coordinator",
    "organiser-1": "event_organiser",
    "staff-1": "venue_staff",
    "tech-1": "technical_support_staff",
    "attendee-1": "attendee",
  });
  const app = createApp(deps, { ports: () => ({ bookings, events, venues, roles, users: new FakeUserReader() }) });
  const get = (path: string, user = "coordinator-1") => request(app).get(path).set("Cookie", `cs_session=tok-${user}`);
  return { bookings, get, setClock: (d: Date) => (clock = d) };
}

describe("SCRUM-33/AC1 requests are listed with their outcomes (33-S1)", () => {
  it("33-S1 lists one request per status, newest first, with decision dates only on APPROVED and REJECTED", async () => {
    const { bookings, get, setClock } = setup();
    const decided = new Date("2026-10-10T00:00:00Z");
    setClock(at(1));
    bookings.seed({ eventId: "event-1", venueId: "venue-1", ...slot(14), status: "withdrawn", withdrawnAt: decided, reviewedAt: decided });
    setClock(at(2));
    bookings.seed({ eventId: "event-1", venueId: "venue-1", ...slot(15), status: "rejected", reviewedAt: decided });
    setClock(at(3));
    bookings.seed({ eventId: "event-2", venueId: "venue-2", ...slot(16), status: "approved", reviewedAt: decided });
    setClock(at(4));
    bookings.seed({ eventId: "event-2", venueId: "venue-2", ...slot(17), status: "requested" });

    const res = await get("/venue-bookings");
    expect(res.status).toBe(200);
    expect(res.body.map((r: { status: string }) => r.status)).toEqual(["PENDING", "APPROVED", "REJECTED", "WITHDRAWN"]);
    expect(res.body.map((r: { decidedAt: string | null }) => r.decidedAt)).toEqual([
      null,
      decided.toISOString(),
      decided.toISOString(),
      null,
    ]);
    expect(res.body[0]).toMatchObject({
      venueName: "Lotus Room",
      eventName: "Seeded event",
      date: "2030-11-17",
      startTime: "09:00",
      endTime: "17:00",
    });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("leaves out legacy cancelled rows, which are outside this feature", async () => {
    const { bookings, get } = setup();
    bookings.seed({ eventId: "event-1", venueId: "venue-1", ...slot(14), status: "cancelled" });
    expect((await get("/venue-bookings")).body).toEqual([]);
  });

  it("shows a placeholder if a venue has disappeared", async () => {
    const { bookings, get } = setup();
    bookings.seed({ eventId: "event-1", venueId: "gone", ...slot(14) });
    expect((await get("/venue-bookings")).body[0].venueName).toBe("Unknown venue");
  });
});

describe("SCRUM-33/AC2 a rejection reason and suggestion are visible (33-S2)", () => {
  it("33-S2 detail returns the reason, suggestion and snapshot", async () => {
    const { bookings, get } = setup();
    const rejected = bookings.seed({
      eventId: "event-1",
      venueId: "venue-1",
      ...slot(14),
      status: "rejected",
      reviewNotes: "Room under renovation",
      reviewedAt: new Date("2026-10-10T00:00:00Z"),
      suggestion: { venueId: "venue-2", start: new Date("2030-11-15T01:00:00Z"), end: new Date("2030-11-15T09:00:00Z") },
    });
    const res = await get(`/venue-bookings/${rejected.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "REJECTED",
      rejectionReason: "Room under renovation",
      suggestion: { venueName: "Lotus Room", date: "2030-11-15", startTime: "09:00", endTime: "17:00" },
      expectedAttendance: 10,
      amendsRequestId: null,
    });
  });

  it("does not show a review note as a rejection reason unless rejected", async () => {
    const { bookings, get } = setup();
    const approved = bookings.seed({ eventId: "event-1", venueId: "venue-1", ...slot(14), status: "approved", reviewNotes: "ok" });
    const res = await get(`/venue-bookings/${approved.id}`);
    expect(res.body.rejectionReason).toBeNull();
    expect(res.body.suggestion).toBeNull();
  });
});

describe("SCRUM-33/AC3 scoped to my own events (33-S3)", () => {
  it("33-S3 requests for another Coordinator's events are absent from the list and the detail is 403", async () => {
    const { bookings, get } = setup();
    const mine = bookings.seed({ eventId: "event-1", venueId: "venue-1", ...slot(14) });
    const theirs = bookings.seed({ eventId: "event-3", venueId: "venue-2", ...slot(15) });
    const res = await get("/venue-bookings");
    expect(res.body.map((r: { id: string }) => r.id)).toEqual([mine.id]);
    const detail = await get(`/venue-bookings/${theirs.id}`);
    expect(detail.status).toBe(403);
    expect(Object.keys(detail.body).sort()).toEqual(["code", "error"]);
  });

  it("404 for an unknown request", async () => {
    expect((await setup().get("/venue-bookings/nope")).status).toBe(404);
  });

  it("403 when the event is no longer visible to the caller", async () => {
    const { bookings, get } = setup();
    const orphan = bookings.seed({ eventId: "deleted-event", venueId: "venue-1", ...slot(14) });
    expect((await get(`/venue-bookings/${orphan.id}`)).status).toBe(403);
  });
});

describe("SCRUM-33/AC4 no requests yet (33-S4)", () => {
  it("33-S4 an empty list is 200 with an empty array", async () => {
    const res = await setup().get("/venue-bookings");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("SCRUM-33/AC5 request detail and amendment history (33-S5)", () => {
  it("33-S5 the detail of either request returns [R1, R2] and R1 keeps its rejection", async () => {
    const { bookings, get, setClock } = setup();
    setClock(at(1));
    const r1 = bookings.seed({
      eventId: "event-1",
      venueId: "venue-1",
      ...slot(14),
      status: "rejected",
      reviewNotes: "Room under renovation",
      reviewedAt: new Date("2026-10-05T00:00:00Z"),
    });
    setClock(at(2));
    const r2 = bookings.seed({ eventId: "event-1", venueId: "venue-2", ...slot(14), amendsBookingId: r1.id });

    for (const id of [r1.id, r2.id]) {
      const body = (await get(`/venue-bookings/${id}`)).body;
      expect(body.chain.map((c: { id: string }) => c.id)).toEqual([r1.id, r2.id]);
      expect(body.chain[0]).toMatchObject({
        status: "REJECTED",
        rejectionReason: "Room under renovation",
        decidedAt: "2026-10-05T00:00:00.000Z",
      });
    }
    expect((await get(`/venue-bookings/${r2.id}`)).body.amendsRequestId).toBe(r1.id);
  });

  it("orders a longer chain and ignores unrelated requests of the same event", () => {
    const base = { eventId: "e", venueId: "v", start: new Date(), end: new Date() } as BookingRecord;
    const mk = (id: string, amends: string | null, day: number) =>
      ({ ...base, id, amendsBookingId: amends, createdAt: at(day) }) as BookingRecord;
    const [a, b, c, other] = [mk("a", null, 1), mk("b", "a", 2), mk("c", "b", 3), mk("x", null, 2)];
    expect(amendmentChain(c, [c, other, b, a]).map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(amendmentChain(other, [c, other, b, a]).map((r) => r.id)).toEqual(["x"]);
  });

  it("does not loop on a corrupt cycle", () => {
    const base = { eventId: "e", venueId: "v", start: new Date(), end: new Date() } as BookingRecord;
    const a = { ...base, id: "a", amendsBookingId: "b", createdAt: at(1) } as BookingRecord;
    const b = { ...base, id: "b", amendsBookingId: "a", createdAt: at(2) } as BookingRecord;
    expect(amendmentChain(a, [a, b]).length).toBeLessThanOrEqual(2);
  });
});

describe("SCRUM-33/AC6 the latest status is shown (33-S6, service half)", () => {
  it("33-S6 a decision made after the first call shows on the next call", async () => {
    const { bookings, get } = setup();
    const row = bookings.seed({ eventId: "event-1", venueId: "venue-1", ...slot(14) });
    expect((await get("/venue-bookings")).body[0]).toMatchObject({ status: "PENDING", decidedAt: null });
    Object.assign(row, { status: "approved", reviewedAt: new Date("2026-10-06T00:00:00Z") });
    expect((await get("/venue-bookings")).body[0]).toMatchObject({ status: "APPROVED", decidedAt: "2026-10-06T00:00:00.000Z" });
  });
});

describe("SCRUM-33/AC7 other roles cannot use this list (33-S7)", () => {
  it.each(["staff-1", "organiser-1", "tech-1", "attendee-1"])("33-S7 %s gets 403 on the list and the detail", async (user) => {
    const { bookings, get } = setup();
    const row = bookings.seed({ eventId: "event-1", venueId: "venue-1", ...slot(14) });
    expect((await get("/venue-bookings", user)).status).toBe(403);
    expect((await get(`/venue-bookings/${row.id}`, user)).status).toBe(403);
  });

  it("33-S7 no session is 401", async () => {
    const app = createApp(deps);
    expect((await request(app).get("/venue-bookings")).status).toBe(401);
  });
});
