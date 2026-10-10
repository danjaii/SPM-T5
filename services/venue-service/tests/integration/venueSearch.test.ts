import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseVenueSearchInput, sgtToUtc } from "@spm-t5/shared";
import { SupabaseVenueSearchReader } from "../../src/readers/venueSearchReader";
import { searchVenues } from "../../src/services/venueSearchService";
import { adminClient, Fixtures, hasDb, signInAs } from "./support/db";

/**
 * SCRUM-65 against Postgres: the available_venues function (migration 14), called as a signed-in coordinator,
 * and the search built on it. Fixture venues are prefixed "IT-", dated 2031 and cleaned up afterwards.
 */
const period = (date: string, start: string, end: string) => ({ start: sgtToUtc(date, start), end: sgtToUtc(date, end) });

describe.skipIf(!hasDb)("SCRUM-65 venue search against Postgres (migration 14)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const fixtures = new Fixtures(admin);
  let coordinatorA: { userId: string };
  let reader: SupabaseVenueSearchReader;

  /** Ids (among the given ones) the signed-in coordinator B is told are free for the period. */
  const freeAmong = async (ids: string[], p: { start: Date; end: Date }) =>
    (await reader.availableVenueIds(p.start, p.end)).filter((id) => ids.includes(id));

  /** A holding booking on the venue made by coordinator A for their own event, in the given status. */
  async function hold(venueId: string, p: { start: Date; end: Date }, status = "requested") {
    const eventId = await fixtures.event("approved", coordinatorA.userId);
    const { error } = await admin.from("venue_bookings").insert({
      event_id: eventId,
      venue_id: venueId,
      requested_by: coordinatorA.userId,
      status,
      event_start_datetime: p.start.toISOString(),
      event_end_datetime: p.end.toISOString(),
    });
    if (error) throw new Error(error.message);
  }

  beforeAll(async () => {
    coordinatorA = await signInAs("rachel.tan@connectsphere.example.com");
    // Coordinator B searches; RLS hides coordinator A's bookings from them, which is the point of the function.
    const b = await signInAs("marcus.lim@connectsphere.example.com");
    reader = new SupabaseVenueSearchReader(b.client);
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  it("SCRUM-65/AC1 excludes a venue held by another coordinator's overlapping request, in every holding status", async () => {
    for (const status of ["requested", "tentative", "approved", "confirmed"]) {
      const venue = await fixtures.venue();
      await hold(venue, period("2031-03-10", "09:00", "17:00"), status);
      expect(await freeAmong([venue], period("2031-03-10", "13:00", "14:00"))).toEqual([]);
    }
  });

  it("SCRUM-65/AC1 includes a venue whose booking was rejected", async () => {
    const venue = await fixtures.venue();
    await hold(venue, period("2031-03-11", "09:00", "17:00"), "rejected");
    expect(await freeAmong([venue], period("2031-03-11", "10:00", "12:00"))).toEqual([venue]);
  });

  it("SCRUM-65/AC1 excludes a venue with an overlapping maintenance block", async () => {
    const venue = await fixtures.venue();
    const p = period("2031-03-12", "09:00", "17:00");
    await fixtures.unavailability(venue, p.start, p.end);
    expect(await freeAmong([venue], period("2031-03-12", "16:00", "18:00"))).toEqual([]);
  });

  it("SCRUM-65/AC1 allows back-to-back periods, another date and an untouched venue", async () => {
    const booked = await fixtures.venue();
    const blocked = await fixtures.venue();
    const untouched = await fixtures.venue();
    const p = period("2031-03-13", "09:00", "17:00");
    await hold(booked, p);
    await fixtures.unavailability(blocked, p.start, p.end);

    expect(await freeAmong([booked, blocked], period("2031-03-13", "17:00", "18:00"))).toHaveLength(2);
    expect(await freeAmong([booked, blocked], period("2031-03-13", "07:00", "09:00"))).toHaveLength(2);
    expect(await freeAmong([booked, blocked], period("2031-03-14", "09:00", "17:00"))).toHaveLength(2);
    expect(await freeAmong([untouched], p)).toEqual([untouched]);
  });

  it("SCRUM-65/AC1 leaves out inactive venues", async () => {
    const venue = await fixtures.venue("IT-venue", { is_active: false });
    expect(await freeAmong([venue], period("2031-03-15", "09:00", "10:00"))).toEqual([]);
  });

  it("SCRUM-65/AC2,AC3 the full search applies capacity, location, accessibility, layout and facilities", async () => {
    const good = await fixtures.venue("IT-venue", { address: "77 Zzyzx Lane", max_capacity: 200, is_accessible: true });
    const small = await fixtures.venue("IT-venue", { address: "77 Zzyzx Lane", max_capacity: 20, is_accessible: true });
    const inaccessible = await fixtures.venue("IT-venue", { address: "77 Zzyzx Lane", max_capacity: 200 });
    const facility = await fixtures.facility(good);
    await fixtures.facility(small);
    await fixtures.facility(inaccessible);
    const layoutId = await fixtures.layout(good, 150);

    const parsed = parseVenueSearchInput(
      {
        startDate: "2031-03-16", startTime: "09:00", endDate: "2031-03-16", endTime: "17:00",
        attendance: "100", location: "zzyzx", accessible: "true", layoutId, facilityIds: facility,
      },
      new Date("2031-03-01T00:00:00Z"),
    );
    if (!parsed.ok) throw new Error("search input should be valid");

    const results = await searchVenues(reader, parsed.data);
    expect(results.map((r) => r.id)).toEqual([good]);
    expect(results[0]).toMatchObject({ address: "77 Zzyzx Lane", max_capacity: 200, is_accessible: true });
    expect(results[0].layouts).toEqual([expect.objectContaining({ id: layoutId, max_capacity: 150 })]);
    expect(results[0].facilities.map((f) => f.id)).toEqual([facility]);
  });

  it("SCRUM-65/AC8 returns nothing when no venue matches", async () => {
    const parsed = parseVenueSearchInput(
      { startDate: "2031-03-17", startTime: "09:00", endDate: "2031-03-17", endTime: "10:00", location: "no such place anywhere" },
      new Date("2031-03-01T00:00:00Z"),
    );
    if (!parsed.ok) throw new Error("search input should be valid");
    expect(await searchVenues(reader, parsed.data)).toEqual([]);
  });

  it("SCRUM-65/AC1,AC2 location matches the name, a booking inside a multi-day period excludes the venue, and closed hours are left out", async () => {
    const tag = Math.random().toString(36).slice(2, 8);
    const open = await fixtures.venue(`IT-zz${tag}-open`, { operating_hours_start: "08:00:00", operating_hours_end: "20:00:00" });
    const closedAtNight = await fixtures.venue(`IT-zz${tag}-late`, { operating_hours_start: "10:00:00", operating_hours_end: "20:00:00" });
    const heldMidPeriod = await fixtures.venue(`IT-zz${tag}-held`);
    await hold(heldMidPeriod, period("2031-03-19", "09:00", "17:00"));

    // 18 to 20 March, 09:00 to 17:00: the booking on the 19th falls inside it.
    const parsed = parseVenueSearchInput(
      { startDate: "2031-03-18", startTime: "09:00", endDate: "2031-03-20", endTime: "17:00", location: `zz${tag}` },
      new Date("2031-03-01T00:00:00Z"),
    );
    if (!parsed.ok) throw new Error("search input should be valid");

    const results = await searchVenues(reader, parsed.data);
    expect(results.map((r) => r.id)).toEqual([open]);
    expect(results[0]).toMatchObject({ opening_time: "08:00", closing_time: "20:00" });
    expect(results.map((r) => r.id)).not.toContain(closedAtNight);
    expect(results.map((r) => r.id)).not.toContain(heldMidPeriod);
  });
});
