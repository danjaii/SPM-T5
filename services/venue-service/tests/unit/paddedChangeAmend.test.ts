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

// SCRUM-103 with SCRUM-98 (several bookings per event), SCRUM-102 (change one booking) and SCRUM-60/59 (amend). Orchid Hall
// has setup 30 and turnaround 45; "Summit A" (another event) holds it 10:00-12:00 on 2030-11-14, so it occupies 09:30-12:45.
const NOW = new Date("2026-10-01T00:00:00.000Z");
const ORCHID = "venue-orchid";
const DAY = "2030-11-14";
const MESSAGE = "Orchid Hall is occupied from 09:30 to 12:45, including setup and turnaround";
const at = (time: string) => sgtToUtc(DAY, time);

const deps = {
  anon: { auth: { getUser: async (t: string) => ({ data: { user: t.startsWith("tok-") ? { id: t.slice(4) } : null } }) } },
  forUser: () => {
    throw new Error("ports are faked");
  },
} as unknown as SupabaseDeps;

function setup() {
  const bookings = new FakeBookingRepository(() => NOW);
  bookings.setVenue(ORCHID, { name: "Orchid Hall", setupMinutes: 30, turnaroundMinutes: 45 });
  bookings.seed({ eventId: "summit-a", venueId: ORCHID, start: at("10:00"), end: at("12:00"), status: "approved" });
  // Summit B's own booking at Orchid Hall, 16:00-17:00 (occupies 15:30-17:45)
  const own = bookings.seed({ eventId: "summit-b", venueId: ORCHID, start: at("16:00"), end: at("17:00"), status: "requested" });
  const events = new FakeEventReader([anEvent({ id: "summit-b", name: "Summit B" })]);
  const venues = new FakeVenueReader([aVenue({ id: ORCHID, name: "Orchid Hall", setupMinutes: 30, turnaroundMinutes: 45 })]);
  const roles = new FakeRoleReader({ "coordinator-1": "event_coordinator" });
  const app = createApp(deps, { now: () => NOW, ports: () => ({ bookings, events, venues, roles, users: new FakeUserReader(), venueDetails: FakeVenueDetailsReader.from(venues) }) });
  const as = () => ({
    post: (path: string, body: object) => request(app).post(path).set("Cookie", "cs_session=tok-coordinator-1").send(body),
    patch: (path: string, body: object) => request(app).patch(path).set("Cookie", "cs_session=tok-coordinator-1").send(body),
  });
  const times = (startTime: string, endTime: string) => ({ date: DAY, startTime, endTime });
  return { bookings, own, as: as(), times };
}

describe("SCRUM-103/AC1 changing one venue booking is checked with the padding (103-S8)", () => {
  it("103-S8: moving it to 12:30-14:00 is refused with the occupied period", async () => {
    const { as, own, times, bookings } = setup();

    const res = await as.patch(`/venue-bookings/${own.id}`, times("12:30", "14:00"));

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: "SLOT_CONFLICT", error: MESSAGE });
    expect(bookings.rows.find((r) => r.id === own.id)?.start).toEqual(at("16:00")); // unchanged
  });

  it("103-S8: moving it to 13:15-15:00 (the padded periods only touch) is accepted and goes back to PENDING", async () => {
    const { as, own, times } = setup();
    const res = await as.patch(`/venue-bookings/${own.id}`, times("13:15", "15:00"));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("PENDING");
  });

  it("103-S8: it does not conflict with its own old period", async () => {
    const { as, own, times } = setup();
    // 16:30-17:30 overlaps the booking's own 16:00-17:00 and its padding
    expect((await as.patch(`/venue-bookings/${own.id}`, times("16:30", "17:30"))).status).toBe(200);
  });

  it("103-S8: losing the race on a change still gets the specific message (103-S7)", async () => {
    const { as, own, times, bookings } = setup();
    const real = bookings.slotConflicts.bind(bookings);
    const lookup = vi.spyOn(bookings, "slotConflicts").mockResolvedValueOnce([]).mockImplementation(real);

    const res = await as.patch(`/venue-bookings/${own.id}`, times("12:30", "14:00"));

    expect(lookup).toHaveBeenCalledTimes(2);
    expect(res.body).toEqual({ code: "SLOT_CONFLICT", error: MESSAGE });
  });
});

describe("SCRUM-103/AC1 the event's own bookings clash through the padding too (103-S9, SCRUM-98)", () => {
  it("103-S9: a second Orchid Hall booking for the same event whose padding touches the first is DUPLICATE_VENUE", async () => {
    const { as } = setup();
    // 18:00-19:00 occupies 17:30-19:45, which overlaps the event's own 15:30-17:45 although 17:00 < 18:00
    const res = await as.post("/venue-bookings", { eventId: "summit-b", venueId: ORCHID, ...{ date: DAY, startTime: "18:00", endTime: "19:00" } });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("DUPLICATE_VENUE");
  });

  it("103-S9: when the padding only touches it is created", async () => {
    const { as } = setup();
    // 18:15-19:00 occupies 17:45-19:45: touches the event's own 17:45 end
    const res = await as.post("/venue-bookings", { eventId: "summit-b", venueId: ORCHID, date: DAY, startTime: "18:15", endTime: "19:00" });
    expect(res.status).toBe(201);
  });

  it("103-S9: changing one booking onto a padded clash with the event's other booking is DUPLICATE_VENUE", async () => {
    const { as, bookings, times } = setup();
    const other = bookings.seed({ eventId: "summit-b", venueId: ORCHID, start: at("19:00"), end: at("20:00"), status: "requested" });
    // moving the 19:00 booking to 18:00-19:00 clashes with the 16:00-17:00 one through the padding
    const res = await as.patch(`/venue-bookings/${other.id}`, times("18:00", "19:00"));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("DUPLICATE_VENUE");
  });
});

describe("SCRUM-103/AC1 amending a rejected booking is checked with the padding (103-S10)", () => {
  it("103-S10: an amendment into 12:30-14:00 is refused with the occupied period", async () => {
    const { as, bookings } = setup();
    const rejected = bookings.seed({ eventId: "summit-b", venueId: ORCHID, start: at("07:00"), end: at("08:00"), status: "rejected" });

    const res = await as.post(`/venue-bookings/${rejected.id}/amend`, { venueId: ORCHID, date: DAY, startTime: "12:30", endTime: "14:00" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: "SLOT_CONFLICT", error: MESSAGE });
  });
});
