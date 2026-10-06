import { describe, expect, it } from "vitest";
import { parseVenueSearchInput } from "../src/venueSearch";

// The clock: 2026-10-06 09:00 Singapore time.
const now = new Date("2026-10-06T01:00:00Z");
const valid = { date: "2026-10-15", startTime: "09:00", endTime: "17:00" };

const errorsOf = (body: unknown) => {
  const r = parseVenueSearchInput(body, now);
  return r.ok ? undefined : r.fieldErrors;
};

describe("SCRUM-65/AC1 parseVenueSearchInput accepts a date and time", () => {
  it("turns the Singapore period into UTC instants and leaves optional filters unset", () => {
    expect(parseVenueSearchInput(valid, now)).toEqual({
      ok: true,
      data: {
        date: "2026-10-15",
        startTime: "09:00",
        endTime: "17:00",
        start: new Date("2026-10-15T01:00:00Z"),
        end: new Date("2026-10-15T09:00:00Z"),
        accessible: false,
        facilityIds: [],
      },
    });
  });

  it("accepts today (only earlier days are in the past)", () => {
    expect(parseVenueSearchInput({ ...valid, date: "2026-10-06" }, now).ok).toBe(true);
  });
});

describe("SCRUM-65/AC2 optional filters", () => {
  it("reads location, layout, accessibility and facilities (array or comma-separated)", () => {
    const r = parseVenueSearchInput({ ...valid, location: " Orchard ", layoutId: "l1", accessible: "true", facilityIds: "f1, f2,f1" }, now);
    expect(r).toMatchObject({ ok: true, data: { location: "Orchard", layoutId: "l1", accessible: true, facilityIds: ["f1", "f2"] } });
    const r2 = parseVenueSearchInput({ ...valid, accessible: true, facilityIds: ["a", "b"] }, now);
    expect(r2).toMatchObject({ ok: true, data: { accessible: true, facilityIds: ["a", "b"] } });
  });

  it("treats blank filters as not set", () => {
    const r = parseVenueSearchInput({ ...valid, location: "  ", layoutId: "", attendance: "", accessible: "false" }, now);
    expect(r).toMatchObject({ ok: true, data: { accessible: false, facilityIds: [] } });
    expect(r.ok && "location" in r.data).toBe(false);
  });
});

describe("SCRUM-65/AC3 expected attendance", () => {
  it("reads attendance as a number", () => {
    expect(parseVenueSearchInput({ ...valid, attendance: "120" }, now)).toMatchObject({ ok: true, data: { attendance: 120 } });
  });

  it.each(["0", "-5", "1.5", "abc"])("rejects attendance %s", (attendance) => {
    expect(errorsOf({ ...valid, attendance })).toEqual({ attendance: "Please enter a whole number of at least 1." });
  });
});

describe("SCRUM-65/AC4 missing date or time", () => {
  it("prompts for every missing field at once", () => {
    expect(errorsOf({})).toEqual({
      date: "Please enter a date.",
      startTime: "Please enter a start time.",
      endTime: "Please enter an end time.",
    });
  });

  it("prompts only for the missing one", () => {
    expect(errorsOf({ ...valid, startTime: "  " })).toEqual({ startTime: "Please enter a start time." });
  });

  it("treats a non-object body as an empty search", () => {
    expect(errorsOf(null)).toHaveProperty("date");
    expect(errorsOf("nope")).toHaveProperty("startTime");
  });

  it("rejects malformed values", () => {
    expect(errorsOf({ date: "15/10/2026", startTime: "9am", endTime: "25:00" })).toEqual({
      date: "Please enter the date as YYYY-MM-DD.",
      startTime: "Please enter the start time as HH:MM.",
      endTime: "Please enter the end time as HH:MM.",
    });
    expect(errorsOf({ ...valid, date: "2026-02-30" })).toEqual({ date: "Please enter a real date." });
  });
});

describe("SCRUM-65/AC5 past dates", () => {
  it("rejects yesterday (Singapore time)", () => {
    expect(errorsOf({ ...valid, date: "2026-10-05" })).toEqual({ date: "The date must not be in the past." });
  });

  it("uses the Singapore day, not the UTC day, for today", () => {
    // 2026-10-05 17:00 UTC is already 2026-10-06 01:00 in Singapore, so 2026-10-05 is yesterday.
    const lateUtc = new Date("2026-10-05T17:00:00Z");
    expect(parseVenueSearchInput({ ...valid, date: "2026-10-05" }, lateUtc).ok).toBe(false);
    expect(parseVenueSearchInput({ ...valid, date: "2026-10-06" }, lateUtc).ok).toBe(true);
  });
});

describe("SCRUM-65/AC6 end before start", () => {
  it("rejects an end before the start", () => {
    expect(errorsOf({ ...valid, startTime: "17:00", endTime: "09:00" })).toEqual({
      endTime: "The end time must be after the start time.",
    });
  });

  it("rejects an end equal to the start", () => {
    expect(errorsOf({ ...valid, startTime: "09:00", endTime: "09:00" })).toHaveProperty("endTime");
  });
});
