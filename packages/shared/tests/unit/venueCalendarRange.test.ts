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
