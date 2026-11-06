// SCRUM-97/AC2, AC3: a request is checked against the other holds with their expiry, at the service as well as in the database.
// Orchid Hall has no padding here. "Summit B" holds 10:00-12:00 on 2030-11-14 as a pending request with the given expiry.

import request from "supertest";
import { describe, expect, it } from "vitest";
import { isHoldingDbStatus, sgtToUtc } from "@spm-t5/shared";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";
import { FakeBookingRepository } from "../support/fakeBookingRepository";
import { FakeEventReader, anEvent } from "../support/fakeEventReader";
import { FakeVenueDetailsReader } from "../support/fakeVenueDetails";
import { FakeUserReader } from "../support/fakeUserReader";
import { FakeRoleReader, FakeVenueReader, aVenue } from "../support/fakeVenueAndRoles";

const NOW = new Date("2030-11-01T09:00:00.000Z");
const ORCHID = "venue-orchid";
const DAY = "2030-11-14";
const at = (time: string) => sgtToUtc(DAY, time);
const HOUR = 3_600_000;
const deps = {
  anon: { auth: { getUser: async (t: string) => ({ data: { user: t.startsWith("tok-") ? { id: t.slice(4) } : null } }) } },
  forUser: () => { throw new Error("ports are faked"); },
} as unknown as SupabaseDeps;

function setup(expiry: Date | null | undefined, holderEvent = "summit-b") {
  const bookings = new FakeBookingRepository(() => NOW);
  bookings.setVenue(ORCHID, { name: "Orchid Hall", setupMinutes: 0, turnaroundMinutes: 0 });
  bookings.seed({ eventId: holderEvent, venueId: ORCHID, start: at("10:00"), end: at("12:00"), status: "requested", holdExpiresAt: expiry });
  const events = new FakeEventReader([anEvent({ id: "summit-a", name: "Summit A" }), anEvent({ id: "summit-b", name: "Summit B" })]);
  const venues = new FakeVenueReader([aVenue({ id: ORCHID, name: "Orchid Hall" })]);
  const roles = new FakeRoleReader({ "coordinator-1": "event_coordinator" });
  const app = createApp(deps, { now: () => NOW, ports: () => ({ bookings, events, venues, roles, users: new FakeUserReader(), venueDetails: FakeVenueDetailsReader.from(venues) }) });
  const submit = (eventId: string) =>
    request(app).post("/venue-bookings").set("Cookie", "cs_session=tok-coordinator-1").send({ eventId, venueId: ORCHID, date: DAY, startTime: "11:00", endTime: "13:00" });
  return { submit };
}

describe("SCRUM-97/AC2 a live hold, or one with no expiry, still blocks the slot", () => {
  it("refuses another event's overlapping request while the hold is live", async () => {
    const res = await setup(new Date(NOW.getTime() + HOUR)).submit("summit-a");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SLOT_CONFLICT");
  });

  it("refuses it when the hold has no expiry (nothing changes for those rows)", async () => {
    expect((await setup(null).submit("summit-a")).status).toBe(409);
    expect((await setup(undefined).submit("summit-a")).status).toBe(409);
  });

  it("refuses the same event a second booking of the venue while its first hold is live (DUPLICATE_VENUE)", async () => {
    const res = await setup(new Date(NOW.getTime() + HOUR), "summit-a").submit("summit-a");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("DUPLICATE_VENUE");
  });
});

describe("SCRUM-97/AC3 an expired hold frees the slot", () => {
  const past = new Date(NOW.getTime() - HOUR);

  it("accepts another event's overlapping request as a new pending request", async () => {
    const res = await setup(past).submit("summit-a");
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("PENDING");
  });

  it("accepts the same event's new request for the venue its own expired hold had (no DUPLICATE_VENUE)", async () => {
    const res = await setup(past, "summit-a").submit("summit-a");
    expect(res.status).toBe(201);
  });

  it("treats the expiry moment itself as expired", async () => {
    expect((await setup(NOW).submit("summit-a")).status).toBe(201);
  });
});

describe("SCRUM-97 the shared holding rule", () => {
  const now = new Date("2030-11-01T09:00:00Z");
  it.each([
    ["requested", null, true], ["requested", new Date("2030-11-01T09:00:01Z"), true], ["requested", new Date("2030-11-01T09:00:00Z"), false],
    ["requested", new Date("2030-10-31T09:00:00Z"), false], ["approved", new Date("2030-10-31T09:00:00Z"), true],
    ["confirmed", new Date("2030-10-31T09:00:00Z"), true], ["rejected", null, false], ["withdrawn", null, false],
  ])("%s with expiry %s holds: %s", (status, expiry, expected) => {
    expect(isHoldingDbStatus(status, expiry, now)).toBe(expected);
  });
});

// Review gap: the coordinator's lists use the service clock, so an expired hold reads EXPIRED there too
describe("SCRUM-97/AC4 the lists use the service clock", () => {
  function listSetup() {
    const bookings = new FakeBookingRepository(() => NOW);
    bookings.setVenue(ORCHID, { name: "Orchid Hall", setupMinutes: 0, turnaroundMinutes: 0 });
    const dead = bookings.seed({ eventId: "summit-a", venueId: ORCHID, start: at("10:00"), end: at("12:00"), status: "requested", requestedBy: "coordinator-1", holdExpiresAt: new Date(NOW.getTime() - 60_000) });
    const live = bookings.seed({ eventId: "summit-a", venueId: ORCHID, start: at("14:00"), end: at("16:00"), status: "requested", requestedBy: "coordinator-1", holdExpiresAt: new Date(NOW.getTime() + HOUR) });
    const events = new FakeEventReader([anEvent({ id: "summit-a", name: "Summit A", assignedCoordinatorId: "coordinator-1" } as never)]);
    const venues = new FakeVenueReader([aVenue({ id: ORCHID, name: "Orchid Hall" })]);
    const roles = new FakeRoleReader({ "coordinator-1": "event_coordinator" });
    const app = createApp(deps, { now: () => NOW, ports: () => ({ bookings, events, venues, roles, users: new FakeUserReader(), venueDetails: FakeVenueDetailsReader.from(venues) }) });
    return { app, dead, live };
  }

  it("shows the expired hold as EXPIRED and the live one as PENDING in my venue bookings", async () => {
    const { app, dead, live } = listSetup();
    const res = await request(app).get("/venue-bookings").set("Cookie", "cs_session=tok-coordinator-1");
    expect(res.status).toBe(200);
    const byId = Object.fromEntries((res.body as { id: string; status: string }[]).map((b) => [b.id, b.status]));
    expect(byId[dead.id]).toBe("EXPIRED");
    expect(byId[live.id]).toBe("PENDING");
  });

  it("shows the same on the event's venue bookings", async () => {
    const { app, dead, live } = listSetup();
    const res = await request(app).get("/events/summit-a/venue-bookings").set("Cookie", "cs_session=tok-coordinator-1");
    expect(res.status).toBe(200);
    const list = (Array.isArray(res.body) ? res.body : res.body.bookings) as { id: string; status: string }[];
    const byId = Object.fromEntries(list.map((b) => [b.id, b.status]));
    expect(byId[dead.id]).toBe("EXPIRED");
    expect(byId[live.id]).toBe("PENDING");
  });
});

describe("SCRUM-97/AC2, AC3 one minute either side of the expiry (16:59 and 17:01 in the scenario)", () => {
  const EXPIRY = new Date(NOW.getTime() + HOUR);
  const MIN = 60_000;

  function at(clock: Date) {
    const bookings = new FakeBookingRepository(() => clock);
    bookings.setVenue(ORCHID, { name: "Orchid Hall", setupMinutes: 0, turnaroundMinutes: 0 });
    bookings.seed({ eventId: "summit-b", venueId: ORCHID, start: sgtToUtc(DAY, "10:00"), end: sgtToUtc(DAY, "12:00"), status: "requested", holdExpiresAt: EXPIRY });
    const events = new FakeEventReader([anEvent({ id: "summit-a", name: "Summit A" }), anEvent({ id: "summit-b", name: "Summit B" })]);
    const venues = new FakeVenueReader([aVenue({ id: ORCHID, name: "Orchid Hall" })]);
    const roles = new FakeRoleReader({ "coordinator-1": "event_coordinator" });
    const app = createApp(deps, { now: () => clock, ports: () => ({ bookings, events, venues, roles, users: new FakeUserReader(), venueDetails: FakeVenueDetailsReader.from(venues) }) });
    return request(app).post("/venue-bookings").set("Cookie", "cs_session=tok-coordinator-1").send({ eventId: "summit-a", venueId: ORCHID, date: DAY, startTime: "11:00", endTime: "13:00" });
  }

  it("SCRUM-97/AC2 refuses the slot one minute before the hold expires, saying it is tentatively held", async () => {
    const res = await at(new Date(EXPIRY.getTime() - MIN));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SLOT_CONFLICT");
    expect(res.body.error).toContain("is tentatively held from");
  });

  it("SCRUM-97/AC3 creates the request, as Pending, one minute after the hold expires", async () => {
    const res = await at(new Date(EXPIRY.getTime() + MIN));
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("PENDING");
  });
});
