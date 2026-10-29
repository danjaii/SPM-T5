import { describe, expect, it } from "vitest";
import { addDays, currentWeek, parseCalendarRange, sgtToUtc } from "../../src";

describe("SCRUM-84/AC1 the current week (Monday to Sunday, Singapore time)", () => {
  it("S1: a Wednesday gives that Monday to the Sunday", () => {
    const week = currentWeek(sgtToUtc("2026-11-11", "11:00"));
    expect([week.from, week.to]).toEqual(["2026-11-09", "2026-11-15"]);
    expect(week.start).toEqual(sgtToUtc("2026-11-09", "00:00"));
    expect(week.end).toEqual(sgtToUtc("2026-11-16", "00:00"));
  });

  it("S4: Sunday 23:59 Singapore time is the same week, Monday 00:00 the next", () => {
    expect(currentWeek(sgtToUtc("2026-11-15", "23:59")).from).toBe("2026-11-09");
    expect(currentWeek(sgtToUtc("2026-11-16", "00:00")).from).toBe("2026-11-16");
  });

  it("S4: a UTC instant that is already the next Singapore day counts as that day", () => {
    // 2026-11-15 17:00 UTC is Monday 16 November 01:00 in Singapore
    expect(currentWeek(new Date("2026-11-15T17:00:00.000Z")).from).toBe("2026-11-16");
  });

  it("adds days across a month end", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
  });
});

describe("SCRUM-84/AC5 choose the date range", () => {
  it("S1: a single date is that Singapore day, midnight to midnight", () => {
    const parsed = parseCalendarRange({ from: "2026-11-14" }, sgtToUtc("2026-11-11", "11:00"));
    expect(parsed).toEqual({ ok: true, data: { from: "2026-11-14", to: "2026-11-14", start: sgtToUtc("2026-11-14", "00:00"), end: sgtToUtc("2026-11-15", "00:00") } });
  });

  it("S2: a start and an end date include both days", () => {
    const parsed = parseCalendarRange({ from: "2026-11-14", to: "2026-11-16" }, new Date());
    expect(parsed).toMatchObject({ ok: true, data: { from: "2026-11-14", to: "2026-11-16", end: sgtToUtc("2026-11-17", "00:00") } });
  });

  it("S4: a range over a month and a year end works", () => {
    const parsed = parseCalendarRange({ from: "2026-12-30", to: "2027-01-02" }, new Date());
    expect(parsed).toMatchObject({ ok: true, data: { end: sgtToUtc("2027-01-03", "00:00") } });
  });

  it("S2: no dates is the current week", () => {
    expect(parseCalendarRange({}, sgtToUtc("2026-11-11", "11:00"))).toMatchObject({ ok: true, data: { from: "2026-11-09", to: "2026-11-15" } });
  });
});

describe("SCRUM-84/AC6 reject an invalid date range", () => {
  const ask = (query: { from?: unknown; to?: unknown }) => parseCalendarRange(query, new Date("2026-11-11T03:00:00Z"));

  it("S1: an end date before the start date is refused with the message on the end date", () => {
    expect(ask({ from: "2026-11-14", to: "2026-11-13" })).toEqual({ ok: false, fieldErrors: { to: "The end date must be on or after the start date." } });
  });

  it("S1: the same day for both is fine (on or after)", () => {
    expect(ask({ from: "2026-11-14", to: "2026-11-14" })).toMatchObject({ ok: true });
  });

  it.each(["14/11/2026", "2026-11-14T00:00", "2026-2-3", "2026-02-30", "2026-13-01", "abc"])("S2: %s is not a date", (bad) => {
    expect(ask({ from: bad })).toEqual({ ok: false, fieldErrors: { from: "Enter the date as YYYY-MM-DD." } });
    expect(ask({ from: "2026-11-14", to: bad })).toEqual({ ok: false, fieldErrors: { to: "Enter the date as YYYY-MM-DD." } });
  });

  it("S2: a repeated parameter (an array) is not a date", () => {
    expect(ask({ from: ["2026-11-14", "2026-11-15"] })).toMatchObject({ ok: false, fieldErrors: { from: expect.any(String) } });
  });

  it("S5: an end date with no start date asks for the start date", () => {
    expect(ask({ to: "2026-11-14" })).toEqual({ ok: false, fieldErrors: { from: "Choose a start date." } });
  });

  it("S3: 62 days is the longest range; 63 is refused", () => {
    expect(ask({ from: "2026-11-01", to: "2026-12-02" })).toMatchObject({ ok: true }); // 32 days
    expect(ask({ from: "2026-11-01", to: "2027-01-01" })).toMatchObject({ ok: true }); // 62 days
    expect(ask({ from: "2026-11-01", to: "2027-01-02" })).toEqual({ ok: false, fieldErrors: { to: "Choose a range of 62 days or fewer." } });
  });

  it("both a bad start and a bad end are reported together", () => {
    expect(ask({ from: "x", to: "y" })).toEqual({ ok: false, fieldErrors: { from: "Enter the date as YYYY-MM-DD.", to: "Enter the date as YYYY-MM-DD." } });
  });
});
