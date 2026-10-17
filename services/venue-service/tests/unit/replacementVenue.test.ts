import request from "supertest";
import { describe, expect, it } from "vitest";
import { sgtToUtc, type Role } from "@spm-t5/shared";
import { createApp } from "../../src/app";
import type { SearchableVenue, VenueSearchReader } from "../../src/readers/venueSearchReader";
import type { SupabaseDeps } from "../../src/supabase";
import { FakeBookingRepository } from "../support/fakeBookingRepository";
import { FakeEventReader, anEvent } from "../support/fakeEventReader";
import { FakeUserReader } from "../support/fakeUserReader";
import { FakeVenueDetailsReader, aVenueWithDetails } from "../support/fakeVenueDetails";
import { FakeRoleReader, FakeVenueReader, aVenue } from "../support/fakeVenueAndRoles";

// SCRUM-107 (docs/specs/replacement-venue.md): finding and requesting a replacement for a booking flagged as unavailable. An
// in-memory repository stands in for the database, including migration 46's take-over trigger.
const NOW = new Date("2026-10-01T00:00:00.000Z");
const START = sgtToUtc("2030-11-14", "09:00");
const END = sgtToUtc("2030-11-14", "17:00");
const BLOCK = { start: sgtToUtc("2030-11-14", "08:00"), end: sgtToUtc("2030-11-16", "18:00") };

const deps = {
  anon: { auth: { getUser: async (t: string) => ({ data: { user: t.startsWith("tok-") ? { id: t.slice(4) } : null } }) } },
  forUser: () => {
    throw new Error("ports are faked");
  },
} as unknown as SupabaseDeps;

class FakeSearch implements VenueSearchReader {
  constructor(readonly venues: SearchableVenue[], readonly free: string[]) {}
  async availableVenueIds() {
    return this.free;
  }
  async activeVenues() {
    return this.venues;
  }
  async options() {
    return { layouts: [], facilities: [] };
  }
}

function setup(eventStatus = "confirmed") {
  const bookings = new FakeBookingRepository(() => NOW);
  const events = new FakeEventReader([anEvent({ status: eventStatus, expectedAttendance: 120 })]);
  const venueInfos = [
    aVenue({ id: "venue-1", name: "Orchid Hall", maxCapacity: 150 }),
    aVenue({ id: "venue-2", name: "Lotus Room", maxCapacity: 200 }),
    aVenue({ id: "venue-3", name: "Small Room", maxCapacity: 50 }),
    aVenue({ id: "venue-4", name: "Maple Hall", maxCapacity: 300 }),
    aVenue({ id: "venue-5", name: "Held Hall", maxCapacity: 300 }),
    aVenue({ id: "venue-6", name: "Refused Hall", maxCapacity: 300 }),
  ];
  const venues = new FakeVenueReader(venueInfos);
  for (const v of venueInfos) bookings.setVenue(v.id, { name: v.name });
  const searchable = venueInfos.map((v) => aVenueWithDetails({ id: v.id, name: v.name, maxCapacity: v.maxCapacity, address: `${v.name} Road` }));
  const search = new FakeSearch(searchable, venueInfos.map((v) => v.id));
  const roles = new FakeRoleReader({
    "coordinator-1": "event_coordinator",
    "coordinator-2": "event_coordinator",
    "organiser-1": "event_organiser",
    "staff-1": "venue_staff",
    "lead-1": "event_coordinator_lead",
  } as Record<string, Role>);
  const app = createApp(deps, {
    now: () => NOW,
    venueSearch: () => search,
    ports: () => ({ bookings, events, venues, roles, users: new FakeUserReader(), venueDetails: FakeVenueDetailsReader.from(venues) }),
  });
  const as = (userId: string) => ({
    get: (path: string) => request(app).get(path).set("Cookie", `cs_session=tok-${userId}`),
    post: (path: string, body: object = {}) => request(app).post(path).set("Cookie", `cs_session=tok-${userId}`).send(body),
    patch: (path: string, body: object = {}) => request(app).patch(path).set("Cookie", `cs_session=tok-${userId}`).send(body),
  });
  // the story's booking: approved at Orchid Hall for 120 people, flagged because a block covers it
  const original = bookings.seed({
    eventId: "event-1",
    venueId: "venue-1",
    start: START,
    end: END,
    status: "approved",
    snapshot: { eventName: "TechConf 2026", expectedAttendance: 120, venueRequirements: "Theatre", accessibilityNeeds: null },
  });
  bookings.flagUnavailable(original.id, BLOCK.start, BLOCK.end);
  return { app, bookings, events, search, original, coordinator: as("coordinator-1"), as };
}

const REPLACE = (id: string) => `/venue-bookings/${id}/replacement`;
const CANDIDATES = (id: string) => `/venue-bookings/${id}/replacement-candidates`;

describe("SCRUM-107/AC1 finding replacement options (107-S1)", () => {
  it("107-S1: only free venues that hold the booking's own 120, never the original's venue, one the event holds, or a refused one", async () => {
    const { coordinator, bookings, original } = setup();
    bookings.seed({ eventId: "event-1", venueId: "venue-5", start: START, end: END, status: "approved" }); // the event already holds it
    bookings.seed({ eventId: "event-1", venueId: "venue-6", start: START, end: END, status: "rejected" }); // refused for this period

    const res = await coordinator.get(CANDIDATES(original.id));

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { venueId: "venue-2", name: "Lotus Room", address: "Lotus Room Road", maxCapacity: 200 },
      { venueId: "venue-4", name: "Maple Hall", address: "Maple Hall Road", maxCapacity: 300 },
    ]);
  });

  it("107-S1: a venue the search says is not free is not offered, and nothing free is 200 []", async () => {
    const { coordinator, original, search } = setup();
    search.free.splice(0, search.free.length, "venue-1", "venue-2", "venue-3"); // Maple Hall and the others are busy or blocked
    expect((await coordinator.get(CANDIDATES(original.id))).body.map((v: { name: string }) => v.name)).toEqual(["Lotus Room"]);

    search.free.splice(0, search.free.length);
    const none = await coordinator.get(CANDIDATES(original.id));
    expect(none.status).toBe(200);
    expect(none.body).toEqual([]);
  });
});

describe("SCRUM-107/AC2 requesting a replacement (107-S2)", () => {
  it("107-S2: Lotus Room creates a PENDING request with the original's date, times, attendance and requirements, linked to it", async () => {
    const { coordinator, bookings, original } = setup();
    const before = structuredClone(original);

    const res = await coordinator.post(REPLACE(original.id), { venueId: "venue-2" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: "PENDING",
      venueId: "venue-2",
      date: "2030-11-14",
      startTime: "09:00",
      endTime: "17:00",
      expectedAttendance: 120,
      venueRequirements: "Theatre",
      replaces: original.id,
    });
    const created = bookings.rows.find((r) => r.id === res.body.id);
    expect(created).toMatchObject({ status: "requested", amendsBookingId: original.id });
    // the original is unchanged and still flagged
    expect(bookings.rows.find((r) => r.id === original.id)).toEqual(before);
    expect(bookings.openFlags(original.id)).toHaveLength(1);
  });

  it("107-S2: works on a Confirmed event (decision 3), but a completed or cancelled event is EVENT_NOT_ELIGIBLE", async () => {
    expect((await setup("confirmed").coordinator.post(REPLACE("booking-1"), { venueId: "venue-2" })).status).toBe(201);
    for (const status of ["completed", "cancelled", "rejected"]) {
      const { coordinator, original } = setup(status);
      const res = await coordinator.post(REPLACE(original.id), { venueId: "venue-2" });
      expect(res.status, status).toBe(409);
      expect(res.body.code, status).toBe("EVENT_NOT_ELIGIBLE");
    }
  });

  it("107-S2: an unsuitable venue needs its own reason; the original's result is not inherited", async () => {
    const { coordinator, original, bookings } = setup();

    const without = await coordinator.post(REPLACE(original.id), { venueId: "venue-3" });
    expect(without.status).toBe(409);
    expect(without.body.code).toBe("UNSUITABLE_VENUE");
    expect(bookings.rows).toHaveLength(1);

    const withReason = await coordinator.post(REPLACE(original.id), { venueId: "venue-3", overrideReason: "Smaller crowd expected" });
    expect(withReason.status).toBe(201);
    expect(bookings.rows.find((r) => r.id === withReason.body.id)).toMatchObject({ suitability: "not_suitable", suitabilityOverrideReason: "Smaller crowd expected" });
  });

  it("107-S2: a missing venue is 422, an unknown venue 404, and a held slot is SLOT_CONFLICT", async () => {
    const { coordinator, original, bookings } = setup();
    expect((await coordinator.post(REPLACE(original.id), {})).status).toBe(422);
    expect((await coordinator.post(REPLACE(original.id), { venueId: "nowhere" })).status).toBe(404);
    bookings.seed({ eventId: "other-event", venueId: "venue-2", start: START, end: END, status: "approved" });
    const res = await coordinator.post(REPLACE(original.id), { venueId: "venue-2" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SLOT_CONFLICT");
  });
});

describe("SCRUM-107/AC3 an approved replacement takes over (107-S3)", () => {
  it("107-S3: the original becomes REPLACED, its flag resolves as replaced, and it shows Replaced by Lotus Room", async () => {
    const { coordinator, bookings, original } = setup();
    const created = (await coordinator.post(REPLACE(original.id), { venueId: "venue-2" })).body;

    await bookings.decide(created.id, { outcome: "approved" }, "staff-1", NOW);

    expect(bookings.rows.find((r) => r.id === original.id)).toMatchObject({ status: "replaced", replacedByBookingId: created.id });
    expect(bookings.openFlags(original.id)).toEqual([]);
    const detail = (await coordinator.get(`/venue-bookings/${original.id}`)).body;
    expect(detail.status).toBe("REPLACED");
    expect(detail.replacedBy).toMatchObject({ id: created.id, venueName: "Lotus Room", date: "2030-11-14", status: "APPROVED" });
    expect(detail.flagHistory).toMatchObject([{ kind: "venue_unavailable", resolvedReason: "replaced", unavailability: { reasonLabel: "Maintenance" } }]);
    expect(detail.flags).toEqual([]);
    const replacementDetail = (await coordinator.get(`/venue-bookings/${created.id}`)).body;
    expect(replacementDetail.replaces).toMatchObject({ id: original.id, venueName: "Orchid Hall", status: "REPLACED" });
  });

  it("107-S3: the event's venue list shows both, the original as replaced by the new venue", async () => {
    const { coordinator, bookings, original } = setup();
    const created = (await coordinator.post(REPLACE(original.id), { venueId: "venue-2" })).body;
    await bookings.decide(created.id, { outcome: "approved" }, "staff-1", NOW);

    const list = (await coordinator.get("/events/event-1/venue-bookings")).body;

    const old = list.find((b: { id: string }) => b.id === original.id);
    const next = list.find((b: { id: string }) => b.id === created.id);
    expect(old).toMatchObject({ status: "REPLACED", replacedBy: { venueName: "Lotus Room" } });
    expect(next).toMatchObject({ status: "APPROVED", venueName: "Lotus Room", replaces: { venueName: "Orchid Hall" } });
  });

  it("107-S7: an ordinary amendment of a rejected booking changes nothing on the old one when it is approved", async () => {
    const { coordinator, bookings, original } = setup("approved");
    // not the flagged one: a separate rejected booking amended through SCRUM-60
    const rejected = bookings.seed({ eventId: "event-1", venueId: "venue-4", start: sgtToUtc("2030-12-01", "09:00"), end: sgtToUtc("2030-12-01", "12:00"), status: "rejected" });
    const amended = await coordinator.post(`/venue-bookings/${rejected.id}/amend`, { venueId: "venue-2", date: "2030-12-01", startTime: "09:00", endTime: "12:00" });
    expect(amended.status).toBe(201);

    await bookings.decide(amended.body.id, { outcome: "approved" }, "staff-1", NOW);

    expect(bookings.rows.find((r) => r.id === rejected.id)).toMatchObject({ status: "rejected", replacedByBookingId: null });
    expect(bookings.rows.find((r) => r.id === original.id)).toMatchObject({ status: "approved" });
  });

  it("107-S7: approving a replacement whose original's flag was resolved meanwhile is an ordinary approval", async () => {
    const { coordinator, bookings, original } = setup();
    const created = (await coordinator.post(REPLACE(original.id), { venueId: "venue-2" })).body;
    for (const f of bookings.flagRows) Object.assign(f, { resolvedAt: NOW, resolvedReason: "booking_closed" });

    await bookings.decide(created.id, { outcome: "approved" }, "staff-1", NOW);

    expect(bookings.rows.find((r) => r.id === original.id)).toMatchObject({ status: "approved", replacedByBookingId: null });
  });
});

describe("SCRUM-107/AC4 a rejected replacement leaves the original flagged (107-S4)", () => {
  it("107-S4: the original is unchanged and flagged, Find replacement works again, and the refused venue is no longer offered", async () => {
    const { coordinator, bookings, original } = setup();
    const created = (await coordinator.post(REPLACE(original.id), { venueId: "venue-2" })).body;
    const before = structuredClone(bookings.rows.find((r) => r.id === original.id));

    await bookings.decide(created.id, { outcome: "rejected", reason: "Booked out" }, "staff-1", NOW);

    expect(bookings.rows.find((r) => r.id === original.id)).toEqual(before);
    expect(bookings.openFlags(original.id)).toHaveLength(1);
    const again = await coordinator.get(CANDIDATES(original.id));
    expect(again.status).toBe(200);
    expect(again.body.map((v: { name: string }) => v.name)).toEqual(["Held Hall", "Maple Hall", "Refused Hall"]); // Lotus Room was refused for this period
    const second = await coordinator.post(REPLACE(original.id), { venueId: "venue-4" });
    expect(second.status).toBe(201);
  });

  it("107-S4: a rejected replacement cannot be amended or accepted, and the same venue and period is REPEAT_OF_REJECTED", async () => {
    const { coordinator, bookings, original } = setup();
    const created = (await coordinator.post(REPLACE(original.id), { venueId: "venue-2" })).body;
    await bookings.decide(created.id, { outcome: "rejected", reason: "Booked out" }, "staff-1", NOW);

    const amend = await coordinator.post(`/venue-bookings/${created.id}/amend`, { venueId: "venue-4", date: "2030-11-14", startTime: "09:00", endTime: "17:00" });
    expect(amend.status).toBe(409);
    expect(amend.body.code).toBe("REPLACEMENT_REJECTED");

    const repeat = await coordinator.post(REPLACE(original.id), { venueId: "venue-2" });
    expect(repeat.status).toBe(409);
    expect(repeat.body.code).toBe("REPEAT_OF_REJECTED");
  });
});

describe("SCRUM-107/AC5 one replacement request at a time (107-S5)", () => {
  it("107-S5: with one waiting, finding and requesting are REPLACEMENT_PENDING; withdrawing it frees them", async () => {
    const { coordinator, bookings, original } = setup();
    const created = (await coordinator.post(REPLACE(original.id), { venueId: "venue-2" })).body;

    for (const res of [await coordinator.get(CANDIDATES(original.id)), await coordinator.post(REPLACE(original.id), { venueId: "venue-4" })]) {
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("REPLACEMENT_PENDING");
    }
    expect(bookings.rows.filter((r) => r.amendsBookingId === original.id)).toHaveLength(1);
    // the booking page shows the waiting replacement
    expect((await coordinator.get(`/venue-bookings/${original.id}`)).body.replacedBy).toMatchObject({ id: created.id, status: "PENDING" });

    expect((await coordinator.post(`/venue-bookings/${created.id}/withdraw`)).status).toBe(200);
    expect((await coordinator.get(CANDIDATES(original.id))).status).toBe(200);
  });

  it("107-S5: the original cannot be changed or cancelled while its replacement waits [PROPOSED]", async () => {
    const { coordinator, original } = setup("approved");
    await coordinator.post(REPLACE(original.id), { venueId: "venue-2" });

    const change = await coordinator.patch(`/venue-bookings/${original.id}`, { date: "2030-11-14", startTime: "10:00", endTime: "17:00" });
    expect(change.status).toBe(409);
    expect(change.body.code).toBe("REPLACEMENT_PENDING");
    const cancel = await coordinator.post(`/venue-bookings/${original.id}/cancel`, { reason: "No longer needed" });
    expect(cancel.status).toBe(409);
    expect(cancel.body.code).toBe("REPLACEMENT_PENDING");
  });

  it("107-S5: two requests at the same moment create one; the other is REPLACEMENT_PENDING", async () => {
    const { coordinator, bookings, original } = setup();
    const results = await Promise.all([coordinator.post(REPLACE(original.id), { venueId: "venue-2" }), coordinator.post(REPLACE(original.id), { venueId: "venue-4" })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)?.body.code).toBe("REPLACEMENT_PENDING");
    expect(bookings.rows.filter((r) => r.amendsBookingId === original.id)).toHaveLength(1);
  });
});

describe("SCRUM-107/AC6 only flagged bookings, only the assigned coordinator (107-S6)", () => {
  it("107-S6: an Approved booking with no flag, or only a buffer-conflict flag, is NOT_FLAGGED", async () => {
    const { coordinator, bookings } = setup();
    const plain = bookings.seed({ eventId: "event-1", venueId: "venue-4", start: sgtToUtc("2030-12-01", "09:00"), end: sgtToUtc("2030-12-01", "12:00"), status: "approved" });
    for (const path of [CANDIDATES(plain.id)]) {
      const res = await coordinator.get(path);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("NOT_FLAGGED");
    }
    expect((await coordinator.post(REPLACE(plain.id), { venueId: "venue-2" })).body.code).toBe("NOT_FLAGGED");

    bookings.flagRows.push({
      id: "buffer-1", bookingId: plain.id, kind: "buffer_conflict", otherBookingId: "x", otherStart: START, otherEnd: END,
      unavailabilityId: null, unavailabilityReason: null, createdAt: NOW, resolvedAt: null, resolvedReason: null,
    });
    expect((await coordinator.get(CANDIDATES(plain.id))).body.code).toBe("NOT_FLAGGED");
  });

  it("107-S6: another coordinator, a lead, an organiser and venue staff are 403; unknown is 404; no session is 401", async () => {
    const { as, original, app } = setup();
    for (const who of ["coordinator-2", "lead-1", "organiser-1", "staff-1"]) {
      expect((await as(who).get(CANDIDATES(original.id))).status, who).toBe(403);
      expect((await as(who).post(REPLACE(original.id), { venueId: "venue-2" })).status, who).toBe(403);
    }
    expect((await as("coordinator-1").get(CANDIDATES("nope"))).status).toBe(404);
    expect((await request(app).get(CANDIDATES(original.id))).status).toBe(401);
  });

  it("107-S6: a booking that is no longer holding (cancelled) is NOT_FLAGGED", async () => {
    const { coordinator, bookings, original } = setup();
    Object.assign(bookings.rows.find((r) => r.id === original.id)!, { status: "cancelled" });
    expect((await coordinator.get(CANDIDATES(original.id))).body.code).toBe("NOT_FLAGGED");
  });
});
