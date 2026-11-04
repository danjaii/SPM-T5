// SCRUM-130/AC1: where the calendar's periods sit on a week grid (days across, hours down). 14 Nov 2026 is a Saturday in Singapore (UTC+8).

import { describe, expect, it } from "vitest";
import { blocksForDay, hourBounds, weekChunks } from "@/lib/venueWeekGrid";
import type { CalendarPeriod } from "@/lib/venueCalendar";

const Z = (date: string, hhmm: string) => new Date(Date.parse(`${date}T${hhmm}:00.000Z`) - 8 * 3_600_000).toISOString();
const period = (kind: CalendarPeriod["kind"], status: CalendarPeriod["status"], from: string, to: string, over: Partial<CalendarPeriod> = {}): CalendarPeriod => ({
  kind, status, label: status, start: from, end: to, ...over,
});

describe("SCRUM-130/AC1 weekChunks: the days shown, a week at a time", () => {
  it("SCRUM-130/AC1 gives one week of seven days for a seven day range, and keeps the order", () => {
    expect(weekChunks("2026-11-09", "2026-11-15")).toEqual([["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]]);
  });

  it("SCRUM-130/AC1 gives a single day as one column", () => {
    expect(weekChunks("2026-11-14", "2026-11-14")).toEqual([["2026-11-14"]]);
  });

  it("SCRUM-130/AC1 splits a longer range into weeks of seven, the last one shorter, across a month end", () => {
    const weeks = weekChunks("2026-11-27", "2026-12-10");
    expect(weeks.map((w) => w.length)).toEqual([7, 7]);
    expect(weeks[0][0]).toBe("2026-11-27");
    expect(weeks[0][4]).toBe("2026-12-01");
    expect(weekChunks("2026-11-09", "2026-11-18").map((w) => w.length)).toEqual([7, 3]);
  });
});

describe("SCRUM-130/AC1 hourBounds: the hours the grid covers", () => {
  it("SCRUM-130/AC1 is 06:00 to 22:00 when nothing falls outside it, whatever the open and closed periods say", () => {
    expect(hourBounds([period("open", "AVAILABLE", Z("2026-11-14", "00:00"), Z("2026-11-14", "23:00")), period("event", "CONFIRMED", Z("2026-11-14", "09:00"), Z("2026-11-14", "12:00"))])).toEqual({ startHour: 6, endHour: 22 });
  });

  it("SCRUM-130/AC1 widens to whole hours to take in a booking, setup or block before 06:00 or after 22:00", () => {
    expect(hourBounds([period("setup", "CONFIRMED", Z("2026-11-14", "04:30"), Z("2026-11-14", "05:00"))]).startHour).toBe(4);
    expect(hourBounds([period("turnaround", "CONFIRMED", Z("2026-11-14", "22:00"), Z("2026-11-14", "23:15"))].concat()).endHour).toBe(24);
    expect(hourBounds([period("block", "BLOCKED", Z("2026-11-14", "21:00"), Z("2026-11-14", "22:30"))]).endHour).toBe(23);
  });
});

describe("SCRUM-130/AC1 blocksForDay: a period's place in one day's column", () => {
  const confirmed = period("event", "CONFIRMED", Z("2026-11-14", "10:00"), Z("2026-11-14", "12:00"));

  it("SCRUM-130/AC1 puts a booking at its start and gives it its length, as a share of the 06:00 to 22:00 column", () => {
    const [block] = blocksForDay([confirmed], "2026-11-14", 6, 22);
    expect(block.topPct).toBeCloseTo((4 / 16) * 100, 5);
    expect(block.heightPct).toBeCloseTo((2 / 16) * 100, 5);
    expect([block.startTime, block.endTime]).toEqual(["10:00", "12:00"]);
  });

  it("SCRUM-130/AC1 leaves a period out of any day it does not touch", () => {
    expect(blocksForDay([confirmed], "2026-11-15", 6, 22)).toEqual([]);
    expect(blocksForDay([confirmed], "2026-11-13", 6, 22)).toEqual([]);
  });

  it("SCRUM-130/AC1 cuts a period that runs over midnight at each day's edge", () => {
    const night = period("block", "BLOCKED", Z("2026-11-14", "20:00"), Z("2026-11-15", "08:00"));
    const first = blocksForDay([night], "2026-11-14", 6, 22)[0];
    const second = blocksForDay([night], "2026-11-15", 6, 22)[0];
    expect([first.startTime, first.endTime]).toEqual(["20:00", "22:00"]);
    expect([second.startTime, second.endTime]).toEqual(["06:00", "08:00"]);
    expect(second.topPct).toBe(0);
    expect(first.topPct + first.heightPct).toBeCloseTo(100, 5);
  });

  it("SCRUM-130/AC1 drops a period that lies wholly outside the hours shown", () => {
    expect(blocksForDay([period("closed", "UNAVAILABLE", Z("2026-11-14", "00:00"), Z("2026-11-14", "06:00"))], "2026-11-14", 6, 22)).toEqual([]);
  });

  it("SCRUM-130/AC1 keeps the order of the periods it is given and does not move them (setup, event, turnaround side by side in time)", () => {
    const set = period("setup", "CONFIRMED", Z("2026-11-14", "09:30"), Z("2026-11-14", "10:00"));
    const turn = period("turnaround", "CONFIRMED", Z("2026-11-14", "12:00"), Z("2026-11-14", "12:45"));
    const blocks = blocksForDay([set, confirmed, turn], "2026-11-14", 6, 22);
    expect(blocks.map((b) => b.period.kind)).toEqual(["setup", "event", "turnaround"]);
    expect(blocks[0].topPct + blocks[0].heightPct).toBeCloseTo(blocks[1].topPct, 5);
    expect(blocks[1].topPct + blocks[1].heightPct).toBeCloseTo(blocks[2].topPct, 5);
  });
});
