import { calendarRange, sgtToUtc } from "@spm-t5/shared";
import { describe, expect, it } from "vitest";
import type { CalendarVenue } from "../../src/readers/venueCalendarReader";
import { buildCalendar } from "../../src/services/venueCalendarService";
import { aCalendarVenue } from "../support/fakeCalendar";

// Operating hours are Singapore local time. One day: Saturday 14 November 2026.
const DAY = calendarRange("2026-11-14", "2026-11-14");
const at = (time: string, date = "2026-11-14") => sgtToUtc(date, time).toISOString();
const nothing = { bookings: [], blocks: [] };

const periodsOf = (venue: Partial<CalendarVenue>, range = DAY, entries = nothing) =>
  buildCalendar([aCalendarVenue(venue)], entries, range)[0]!.periods.map((p) => [p.status, p.label, p.start, p.end]);

describe("SCRUM-84/AC4 periods outside operating hours are Unavailable", () => {
  it("S1/S2: a venue open 08:00-22:00 is Unavailable before 08:00 and after 22:00 and Available between", () => {
    expect(periodsOf({ operatingStart: "08:00", operatingEnd: "22:00" })).toEqual([
      ["UNAVAILABLE", "Unavailable", DAY.start.toISOString(), at("08:00")],
      ["AVAILABLE", "Available", at("08:00"), at("22:00")],
      ["UNAVAILABLE", "Unavailable", at("22:00"), DAY.end.toISOString()],
    ]);
  });

  it("S1: each Singapore day has its own closed hours, so two days give two closed stretches around one open one at midnight", () => {
    const two = calendarRange("2026-11-14", "2026-11-15");
    expect(periodsOf({ operatingStart: "08:00", operatingEnd: "22:00" }, two).map((p) => [p[0], p[2], p[3]])).toEqual([
      ["UNAVAILABLE", two.start.toISOString(), at("08:00")],
      ["AVAILABLE", at("08:00"), at("22:00")],
      ["UNAVAILABLE", at("22:00"), at("08:00", "2026-11-15")], // closed over midnight: one period, no seam
      ["AVAILABLE", at("08:00", "2026-11-15"), at("22:00", "2026-11-15")],
      ["UNAVAILABLE", at("22:00", "2026-11-15"), two.end.toISOString()],
    ]);
  });

  it("S1: a booking in closed hours keeps its status, and a block there is Blocked, never Unavailable", () => {
    const entries = {
      bookings: [{ venueId: "orchid", status: "CONFIRMED" as const, eventStart: sgtToUtc("2026-11-14", "06:00"), eventEnd: sgtToUtc("2026-11-14", "07:00"), occupiedStart: sgtToUtc("2026-11-14", "06:00"), occupiedEnd: sgtToUtc("2026-11-14", "07:00"), setupMinutes: 0, turnaroundMinutes: 0 }],
      blocks: [{ venueId: "orchid", start: sgtToUtc("2026-11-14", "23:00"), end: sgtToUtc("2026-11-15", "01:00"), reason: "safety" }],
    };
    const statuses = periodsOf({ operatingStart: "08:00", operatingEnd: "22:00" }, DAY, entries).map((p) => p[0]);
    expect(statuses).toEqual(["UNAVAILABLE", "CONFIRMED", "UNAVAILABLE", "AVAILABLE", "UNAVAILABLE", "BLOCKED"]);
  });
});

describe("SCRUM-84/AC3 free time inside operating hours is Available", () => {
  it("S1: the free stretches around a booking inside operating hours are Available, and setup and turnaround are not", () => {
    const entries = {
      bookings: [{ venueId: "orchid", status: "TENTATIVELY_HELD" as const, eventStart: sgtToUtc("2026-11-14", "10:00"), eventEnd: sgtToUtc("2026-11-14", "12:00"), occupiedStart: sgtToUtc("2026-11-14", "09:30"), occupiedEnd: sgtToUtc("2026-11-14", "12:45"), setupMinutes: 30, turnaroundMinutes: 45 }],
      blocks: [],
    };
    const result = periodsOf({ operatingStart: "08:00", operatingEnd: "22:00" }, DAY, entries);
    expect(result.filter((p) => p[0] === "AVAILABLE").map((p) => [p[2], p[3]])).toEqual([
      [at("08:00"), at("09:30")],
      [at("12:45"), at("22:00")],
    ]);
  });

  it("S2: a venue with no operating hours (null) has no restriction: Available all day", () => {
    expect(periodsOf({ operatingStart: null, operatingEnd: null })).toEqual([["AVAILABLE", "Available", DAY.start.toISOString(), DAY.end.toISOString()]]);
  });

  it("S2: only one of the two hours set also means no restriction", () => {
    expect(periodsOf({ operatingStart: "08:00", operatingEnd: null })).toHaveLength(1);
    expect(periodsOf({ operatingStart: null, operatingEnd: "22:00" })).toHaveLength(1);
  });

  it("S2: equal start and end hours are treated as no restriction", () => {
    expect(periodsOf({ operatingStart: "08:00", operatingEnd: "08:00" })).toEqual([["AVAILABLE", "Available", DAY.start.toISOString(), DAY.end.toISOString()]]);
  });

  it("S2: hours that end before they start run overnight (22:00-02:00), including the tail of the day before the range", () => {
    expect(periodsOf({ operatingStart: "22:00", operatingEnd: "02:00" }).map((p) => [p[0], p[2], p[3]])).toEqual([
      ["AVAILABLE", DAY.start.toISOString(), at("02:00")],
      ["UNAVAILABLE", at("02:00"), at("22:00")],
      ["AVAILABLE", at("22:00"), DAY.end.toISOString()],
    ]);
  });

  it("S3: the hours the periods were worked out from are given back as HH:MM (null when there are none)", () => {
    const [v] = buildCalendar([aCalendarVenue({ operatingStart: "08:00", operatingEnd: "22:00" })], nothing, DAY);
    const [w] = buildCalendar([aCalendarVenue()], nothing, DAY);
    expect(v!.operating_hours).toEqual({ start: "08:00", end: "22:00" });
    expect(w!.operating_hours).toBeNull();
  });
});
