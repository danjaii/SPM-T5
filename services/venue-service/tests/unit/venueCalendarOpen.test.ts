import request from "supertest";
import { describe, expect, it } from "vitest";
import { sgtToUtc, type Role } from "@spm-t5/shared";
import { createApp } from "../../src/app";
import { aCalendarVenue, createFakeSession, FakeVenueCalendarReader } from "../support/fakeCalendar";

// The clock is Wednesday 11 Nov 2026 11:00 Singapore time, so the current week is Monday 9 to Sunday 15 November.
const NOW = sgtToUtc("2026-11-11", "11:00");

function arrange(reader = new FakeVenueCalendarReader([aCalendarVenue()]), now = NOW) {
  const session = createFakeSession();
  const app = createApp(session.deps, { now: () => now, venueCalendar: () => reader });
  return { app, reader, signIn: session.signIn };
}

describe("SCRUM-84/AC1 open the venue availability calendar", () => {
  it.each(["event_coordinator", "venue_staff", "technical_support_staff"] as Role[])("S2: %s gets the calendar", async (role) => {
    const { app, signIn } = arrange();
    const res = await request(app).get("/venue-calendar").set("Cookie", signIn(role).cookie);
    expect(res.status).toBe(200);
  });

  it("S1: with no parameters the range is the current week, Monday to Sunday in Singapore time", async () => {
    const { app, signIn } = arrange();
    const res = await request(app).get("/venue-calendar").set("Cookie", signIn("event_coordinator").cookie);
    expect(res.body.range).toEqual({
      from: "2026-11-09",
      to: "2026-11-15",
      start: sgtToUtc("2026-11-09", "00:00").toISOString(),
      end: sgtToUtc("2026-11-16", "00:00").toISOString(),
      time_zone: "Asia/Singapore",
    });
  });

  it("S4: Sunday 23:59 Singapore time is still the same week; Monday 00:00 starts the next", async () => {
    const sunday = arrange(undefined, sgtToUtc("2026-11-15", "23:59"));
    const monday = arrange(undefined, sgtToUtc("2026-11-16", "00:00"));
    const a = await request(sunday.app).get("/venue-calendar").set("Cookie", sunday.signIn("venue_staff").cookie);
    const b = await request(monday.app).get("/venue-calendar").set("Cookie", monday.signIn("venue_staff").cookie);
    expect([a.body.range.from, a.body.range.to]).toEqual(["2026-11-09", "2026-11-15"]);
    expect([b.body.range.from, b.body.range.to]).toEqual(["2026-11-16", "2026-11-22"]);
  });

  it("S3: every active venue is listed, ordered by name, with name, address and capacity, even one with nothing booked; an inactive one is not", async () => {
    const reader = new FakeVenueCalendarReader([
      aCalendarVenue({ id: "orchid", name: "Orchid Hall" }),
      aCalendarVenue({ id: "jasmine", name: "Jasmine Room", address: "2 Marina Boulevard", maxCapacity: 40 }),
      aCalendarVenue({ id: "old", name: "Old Hall", isActive: false }),
    ]);
    const { app, signIn } = arrange(reader);
    const res = await request(app).get("/venue-calendar").set("Cookie", signIn("event_coordinator").cookie);

    expect(res.body.venues.map((v: { id: string }) => v.id)).toEqual(["jasmine", "orchid"]);
    expect(res.body.venues[0]).toMatchObject({ name: "Jasmine Room", address: "2 Marina Boulevard", max_capacity: 40 });
    const week = res.body.venues[1].periods;
    expect(week).toEqual([
      { kind: "open", status: "AVAILABLE", label: "Available", start: res.body.range.start, end: res.body.range.end },
    ]);
  });
});
