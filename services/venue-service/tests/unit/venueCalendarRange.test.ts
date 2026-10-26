import request from "supertest";
import { describe, expect, it } from "vitest";
import { sgtToUtc } from "@spm-t5/shared";
import { createApp } from "../../src/app";
import { aCalendarVenue, createFakeSession, FakeVenueCalendarReader } from "../support/fakeCalendar";

const NOW = sgtToUtc("2026-11-11", "11:00");

function arrange() {
  const reader = new FakeVenueCalendarReader([aCalendarVenue({ operatingStart: "08:00", operatingEnd: "22:00" })]);
  const session = createFakeSession();
  const app = createApp(session.deps, { now: () => NOW, venueCalendar: () => reader });
  const cookie = session.signIn("event_coordinator").cookie;
  return { reader, get: (query: string) => request(app).get(`/venue-calendar${query}`).set("Cookie", cookie) };
}

describe("SCRUM-84/AC5 change the date range", () => {
  it("S1: a single date shows exactly that Singapore day", async () => {
    const { get, reader } = arrange();

    const res = await get("?from=2026-11-20");

    expect(res.status).toBe(200);
    expect(res.body.range).toMatchObject({ from: "2026-11-20", to: "2026-11-20", start: sgtToUtc("2026-11-20", "00:00").toISOString(), end: sgtToUtc("2026-11-21", "00:00").toISOString() });
    const periods = res.body.venues[0].periods;
    expect(periods[0].start).toBe(sgtToUtc("2026-11-20", "00:00").toISOString());
    expect(periods[periods.length - 1].end).toBe(sgtToUtc("2026-11-21", "00:00").toISOString());
    expect(reader.asked).toEqual({ from: sgtToUtc("2026-11-20", "00:00"), to: sgtToUtc("2026-11-21", "00:00") });
  });

  it("S2/S4: a start and an end date show exactly those days, both included, across a month end", async () => {
    const { get } = arrange();

    const res = await get("?from=2026-11-29&to=2026-12-02");

    expect(res.body.range).toMatchObject({ from: "2026-11-29", to: "2026-12-02", end: sgtToUtc("2026-12-03", "00:00").toISOString() });
    const periods = res.body.venues[0].periods;
    expect(periods[0].start).toBe(sgtToUtc("2026-11-29", "00:00").toISOString());
    expect(periods[periods.length - 1].end).toBe(sgtToUtc("2026-12-03", "00:00").toISOString());
  });

  it("S3: the periods tile the range with no gap and no overlap", async () => {
    const { get, reader } = arrange();
    reader.hold("orchid", "CONFIRMED", sgtToUtc("2026-11-20", "10:00"), sgtToUtc("2026-11-20", "12:00"));
    reader.block("orchid", sgtToUtc("2026-11-20", "11:00"), sgtToUtc("2026-11-21", "03:00"));

    const periods = (await get("?from=2026-11-19&to=2026-11-21")).body.venues[0].periods as { start: string; end: string }[];

    periods.slice(1).forEach((p, i) => expect(p.start).toBe(periods[i]!.end));
  });
});
