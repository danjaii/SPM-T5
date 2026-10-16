import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { sgtToUtc } from "@spm-t5/shared";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";
import { FakeBookingRepository } from "../support/fakeBookingRepository";
import { FakeEventReader, anEvent } from "../support/fakeEventReader";
import { FakeVenueDetailsReader } from "../support/fakeVenueDetails";
import { FakeUserReader } from "../support/fakeUserReader";
import { FakeRoleReader, FakeVenueReader, aVenue } from "../support/fakeVenueAndRoles";

// SCRUM-105 (docs/specs/venue-unavailability.md): new requests inside an unavailability block are refused, the padded period
// counts against the block. Orchid Hall is unavailable from 14 Nov 08:00 to 16 Nov 18:00 (the story's example).
const NOW = new Date("2026-10-01T00:00:00.000Z");
const ORCHID = "venue-orchid";
const MESSAGE = "Orchid Hall is unavailable from 14 Nov 08:00 to 16 Nov 18:00";
const BLOCK_START = sgtToUtc("2026-11-14", "08:00");
const BLOCK_END = sgtToUtc("2026-11-16", "18:00");

const deps = {
  anon: { auth: { getUser: async (t: string) => ({ data: { user: t.startsWith("tok-") ? { id: t.slice(4) } : null } }) } },
  forUser: () => {
    throw new Error("ports are faked");
  },
} as unknown as SupabaseDeps;

function setup(timing: { setupMinutes?: number; turnaroundMinutes?: number } = { setupMinutes: 30 }) {
  const bookings = new FakeBookingRepository(() => NOW);
  bookings.setVenue(ORCHID, { name: "Orchid Hall", ...timing });
  bookings.setUnavailable(ORCHID, BLOCK_START, BLOCK_END);
  const events = new FakeEventReader([anEvent({ id: "summit-b", name: "Summit B" })]);
  const venues = new FakeVenueReader([aVenue({ id: ORCHID, name: "Orchid Hall", ...timing })]);
  const roles = new FakeRoleReader({ "coordinator-1": "event_coordinator", "staff-1": "venue_staff" });
  const app = createApp(deps, { now: () => NOW, ports: () => ({ bookings, events, venues, roles, users: new FakeUserReader(), venueDetails: FakeVenueDetailsReader.from(venues) }) });
  const as = (user = "coordinator-1") => ({
    get: (path: string) => request(app).get(path).set("Cookie", `cs_session=tok-${user}`),
    post: (path: string, body: object) => request(app).post(path).set("Cookie", `cs_session=tok-${user}`).send(body),
    patch: (path: string, body: object) => request(app).patch(path).set("Cookie", `cs_session=tok-${user}`).send(body),
  });
  const slot = (date: string, startTime: string, endTime: string) => ({ eventId: "summit-b", venueId: ORCHID, date, startTime, endTime });
  return { bookings, events, as: as(), asStaff: as("staff-1"), slot };
}

describe("SCRUM-105/AC4 a request inside the unavailable period is refused (105-S4)", () => {
  it("105-S4: 15 Nov 09:00-17:00 is 409 VENUE_UNAVAILABLE with the period and without the reason, and nothing is created", async () => {
    const { as, slot, bookings } = setup();

    const res = await as.post("/venue-bookings", slot("2026-11-15", "09:00", "17:00"));

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: "VENUE_UNAVAILABLE", error: MESSAGE });
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain("maintenance");
    expect(bookings.rows).toHaveLength(0);
  });

  it("105-S4: the earliest of several overlapping blocks is named", async () => {
    const { as, slot, bookings } = setup();
    bookings.setUnavailable(ORCHID, sgtToUtc("2026-11-10", "08:00"), sgtToUtc("2026-11-15", "10:00"), "renovation");

    const res = await as.post("/venue-bookings", slot("2026-11-15", "09:00", "17:00"));

    expect(res.body.error).toBe("Orchid Hall is unavailable from 10 Nov 08:00 to 15 Nov 10:00");
  });

  it("105-S4: losing the race to the database trigger still gets the same message (pre-check passed, insert refused)", async () => {
    const { as, slot, bookings } = setup();
    const real = bookings.unavailabilityConflicts.bind(bookings);
    const lookup = vi.spyOn(bookings, "unavailabilityConflicts").mockResolvedValueOnce([]).mockImplementation(real);

    const res = await as.post("/venue-bookings", slot("2026-11-15", "09:00", "17:00"));

    expect(lookup).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: "VENUE_UNAVAILABLE", error: MESSAGE });
  });

  it("105-S4: changing a booking into the block (SCRUM-102) is refused the same way and the booking is untouched", async () => {
    const { as, bookings } = setup();
    const own = bookings.seed({ eventId: "summit-b", venueId: ORCHID, start: sgtToUtc("2026-11-20", "09:00"), end: sgtToUtc("2026-11-20", "12:00"), status: "requested" });

    const res = await as.patch(`/venue-bookings/${own.id}`, { date: "2026-11-15", startTime: "09:00", endTime: "12:00" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: "VENUE_UNAVAILABLE", error: MESSAGE });
    expect(bookings.rows.find((r) => r.id === own.id)?.start).toEqual(sgtToUtc("2026-11-20", "09:00"));
  });

  it("105-S4: amending a rejected request into the block (SCRUM-60) is refused the same way", async () => {
    const { as, bookings } = setup();
    const rejected = bookings.seed({ eventId: "summit-b", venueId: ORCHID, start: sgtToUtc("2026-11-20", "09:00"), end: sgtToUtc("2026-11-20", "12:00"), status: "rejected" });

    const res = await as.post(`/venue-bookings/${rejected.id}/amend`, { venueId: ORCHID, date: "2026-11-15", startTime: "09:00", endTime: "12:00" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("VENUE_UNAVAILABLE");
  });

  it("105-S4: a slot that is held by another booking is still SLOT_CONFLICT when it is blocked too", async () => {
    const { as, slot, bookings } = setup();
    bookings.seed({ eventId: "summit-a", venueId: ORCHID, start: sgtToUtc("2026-11-15", "09:00"), end: sgtToUtc("2026-11-15", "17:00"), status: "approved" });

    const res = await as.post("/venue-bookings", slot("2026-11-15", "10:00", "12:00"));

    expect(res.body.code).toBe("SLOT_CONFLICT");
  });

  it("105-S4: a request outside the block is created Pending", async () => {
    const { as, slot } = setup();
    const res = await as.post("/venue-bookings", slot("2026-11-20", "09:00", "17:00"));
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("PENDING");
  });
});

describe("SCRUM-105/AC5 the setup time counts against the period (105-S5)", () => {
  it("105-S5: with setup 30, 16 Nov 18:15-20:00 (occupies from 17:45) is refused", async () => {
    const { as, slot } = setup({ setupMinutes: 30 });
    const res = await as.post("/venue-bookings", slot("2026-11-16", "18:15", "20:00"));
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: "VENUE_UNAVAILABLE", error: MESSAGE });
  });

  it("105-S5: with setup 30, 16 Nov 18:30-20:00 (occupies from 18:00, only touching the block) is created Pending", async () => {
    const { as, slot } = setup({ setupMinutes: 30 });
    const res = await as.post("/venue-bookings", slot("2026-11-16", "18:30", "20:00"));
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("PENDING");
  });

  it("105-S5: the block has no padding of its own: with no setup, 18:00-20:00 right after it is created", async () => {
    const { as, slot } = setup({ setupMinutes: 0 });
    expect((await as.post("/venue-bookings", slot("2026-11-16", "18:00", "20:00"))).status).toBe(201);
  });

  it("105-S5: with turnaround 30, a booking ending 08:00 on 14 Nov is refused and one ending 07:30 is created", async () => {
    const { as, slot } = setup({ setupMinutes: 0, turnaroundMinutes: 30 });
    expect((await as.post("/venue-bookings", slot("2026-11-14", "06:00", "08:00"))).body.code).toBe("VENUE_UNAVAILABLE");
    expect((await as.post("/venue-bookings", slot("2026-11-14", "06:00", "07:30"))).status).toBe(201);
  });
});

describe("SCRUM-105/AC4 the suitability report says a block makes the venue unavailable (105-S4, SCRUM-109 seam)", () => {
  it("105-S4: availability is not met, naming the block's period", async () => {
    const { asStaff } = setup();

    const res = await asStaff.get(`/venue-suitability?venueId=${ORCHID}&eventId=summit-b&date=2026-11-15&startTime=09:00&endTime=17:00`);

    expect(res.status).toBe(200);
    const availability = res.body.criteria.find((c: { key: string }) => c.key === "availability");
    expect(availability).toMatchObject({ status: "not_met", message: "Unavailable from 14 Nov 08:00 to 16 Nov 18:00" });
  });

  it("105-S4: a held slot is still reported as held when it is also blocked", async () => {
    const { asStaff, bookings } = setup();
    bookings.seed({ eventId: "summit-a", venueId: ORCHID, start: sgtToUtc("2026-11-15", "09:00"), end: sgtToUtc("2026-11-15", "17:00"), status: "approved" });

    const res = await asStaff.get(`/venue-suitability?venueId=${ORCHID}&eventId=summit-b&date=2026-11-15&startTime=10:00&endTime=12:00`);

    const availability = res.body.criteria.find((c: { key: string }) => c.key === "availability");
    expect(availability.message).toBe("Already held for part of the requested period");
  });

  it("105-S4: a free period outside the block is met", async () => {
    const { asStaff } = setup();
    const res = await asStaff.get(`/venue-suitability?venueId=${ORCHID}&eventId=summit-b&date=2026-11-20&startTime=09:00&endTime=17:00`);
    expect(res.body.criteria.find((c: { key: string }) => c.key === "availability").status).toBe("met");
  });
});
