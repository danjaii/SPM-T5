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
    "tech-1": "technical_support_staff",
    "attendee-1": "attendee",
  });
  const app = createApp(deps, { now: () => NOW, ports: () => ({ bookings, events, venues, roles }) });
  const withdraw = (id: string, user = "coordinator-1") =>
    request(app).post(`/venue-bookings/${id}/withdraw`).set("Cookie", `cs_session=tok-${user}`);
  const pending = () => bookings.seed({ eventId: "event-1", venueId: "venue-1", ...SLOT });
  return { app, bookings, withdraw, pending };
}

describe("SCRUM-35/AC1 withdrawing a pending request (35-S1)", () => {
  it("35-S1 becomes WITHDRAWN with who and when recorded, and leaves the pending queue", async () => {
    const { bookings, withdraw, pending } = setup();
    const row = pending();
    const res = await withdraw(row.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: row.id, status: "WITHDRAWN" });
    expect(row).toMatchObject({ status: "withdrawn", withdrawnBy: "coordinator-1", withdrawnAt: NOW });
    expect(await bookings.listPending()).toEqual([]);
  });

  it("404 for an unknown request", async () => {
    expect((await setup().withdraw("nope")).status).toBe(404);
  });
});

describe("SCRUM-35/AC2 only pending requests can be withdrawn (35-S2)", () => {
  it.each(["approved", "rejected", "withdrawn"])("35-S2 %s: 409 NOT_PENDING and unchanged", async (status) => {
    const { bookings, withdraw } = setup();
    const row = bookings.seed({ eventId: "event-1", venueId: "venue-1", ...SLOT, status });
    const res = await withdraw(row.id);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: "NOT_PENDING", error: "This request is no longer pending." });
    expect(row.status).toBe(status);
    expect(row.withdrawnAt).toBeNull();
  });

  it("35-S2 a decision landing between the pre-check and the update is still NOT_PENDING (35-S5 shape)", async () => {
    const { bookings, withdraw, pending } = setup();
    const row = pending();
    // The pre-check sees PENDING; the decision wins before the conditional update runs.
    const real = bookings.withdraw.bind(bookings);
    bookings.withdraw = async (...args) => {
      await bookings.decide(row.id, { outcome: "approved" }, "staff-1", NOW);
      return real(...args);
    };
    const res = await withdraw(row.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NOT_PENDING");
    expect(row.status).toBe("approved");
  });
});

describe("SCRUM-35/AC3 only the assigned Coordinator may withdraw (35-S3)", () => {
  it.each(["coordinator-2", "organiser-1", "staff-1", "tech-1", "attendee-1", "ghost"])(
    "35-S3 %s gets 403 and the request stays PENDING",
    async (user) => {
      const { withdraw, pending } = setup();
      const row = pending();
      const res = await withdraw(row.id, user);
      expect(res.status).toBe(403);
      expect(Object.keys(res.body).sort()).toEqual(["code", "error"]);
      expect(row.status).toBe("requested");
    },
  );

  it("35-S3 no session is 401", async () => {
    const { app, pending } = setup();
    const row = pending();
    expect((await request(app).post(`/venue-bookings/${row.id}/withdraw`)).status).toBe(401);
    expect(row.status).toBe("requested");
  });

  it("403 when the event is no longer visible to the caller", async () => {
    const { bookings, withdraw } = setup();
    const orphan = bookings.seed({ eventId: "deleted", venueId: "venue-1", ...SLOT });
    expect((await withdraw(orphan.id)).status).toBe(403);
  });
});

describe("SCRUM-35/AC4 the slot is released (35-S4, in memory)", () => {
  it("35-S4 after withdrawing, the same event can submit again", async () => {
    const { app, bookings, withdraw, pending } = setup();
    const row = pending();
    await withdraw(row.id);
    const body = { eventId: "event-1", venueId: "venue-1", date: "2030-11-14", startTime: "09:00", endTime: "17:00" };
    const again = await request(app).post("/venue-bookings").set("Cookie", "cs_session=tok-coordinator-1").send(body);
    expect(again.status).toBe(201);
    expect(bookings.rows.filter((r) => r.status === "requested")).toHaveLength(1);
  });
});

describe("fake repository decide (used by later stories)", () => {
  it("records a rejection with reason and suggestion, and refuses a second decision", async () => {
    const { bookings, pending } = setup();
    const row = pending();
    const suggestion = { venueId: "venue-2", start: SLOT.start, end: SLOT.end };
    await bookings.decide(row.id, { outcome: "rejected", reason: "Renovation", suggestion }, "staff-1", NOW);
    expect(row).toMatchObject({ status: "rejected", reviewNotes: "Renovation", reviewedBy: "staff-1", suggestion });
    expect(await bookings.decide(row.id, { outcome: "approved" }, "staff-1", NOW)).toBeNull();
    expect(await bookings.withdraw("missing", "u", NOW)).toBeNull();
  });
});
