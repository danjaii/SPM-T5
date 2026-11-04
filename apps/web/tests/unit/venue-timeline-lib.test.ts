// SCRUM-130: the venue timeline's geometry and dates (lib/venueTimeline.ts). 14 Nov 2026 is a Saturday; in Singapore (UTC+8)
// 10:00 is 02:00Z.

import { describe, expect, it } from "vitest";
import type { CalendarPeriod, CalendarVenue } from "@/lib/venueCalendar";
import {
  affectedBlocks, blocksForDay, busyOnDay, dayStatus, daysOf, hourBounds, hourLabel, nowPct, shortDay, stepAnchor, todaySgt, viewRange, viewTitle,
} from "@/lib/venueTimeline";
import { venueFixture } from "./venue-calendar-fixtures";

const Z = (hhmm: string, day = 14) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 10, day, h - 8, m)).toISOString();
};
const p = (kind: string, status: string, start: string, end: string, extra: Partial<CalendarPeriod> = {}) =>
  ({ kind, status, label: status, start, end, ...extra }) as CalendarPeriod;
const venue = (periods: CalendarPeriod[], id = "v") => venueFixture({ id, name: `Venue ${id}`, periods }) as unknown as CalendarVenue;

describe("SCRUM-130 the dates each view shows", () => {
  it("SCRUM-130 takes today from the Singapore clock, not UTC", () => {
    expect(todaySgt(new Date("2026-11-13T16:30:00.000Z"))).toBe("2026-11-14");
  });

  it("SCRUM-130 shows one day, its Monday-to-Sunday week, or its whole month", () => {
    expect(viewRange("day", "2026-11-14")).toEqual({ from: "2026-11-14", to: "2026-11-14" });
    expect(viewRange("week", "2026-11-14")).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(viewRange("week", "2026-11-09")).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(viewRange("week", "2026-11-15")).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(viewRange("month", "2026-11-14")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(viewRange("month", "2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("SCRUM-130 steps a day, a week, or a month at a time, keeping the day of the month where it can", () => {
    expect(stepAnchor("day", "2026-11-30", 1)).toBe("2026-12-01");
    expect(stepAnchor("week", "2026-11-14", -1)).toBe("2026-11-07");
    expect(stepAnchor("month", "2026-11-14", 1)).toBe("2026-12-14");
    expect(stepAnchor("month", "2026-01-31", 1)).toBe("2026-02-28");
    expect(stepAnchor("month", "2026-01-15", -1)).toBe("2025-12-15");
  });

  it("SCRUM-130 names what is shown in words", () => {
    expect(viewTitle("day", "2026-11-14")).toBe("Saturday 14 November 2026");
    expect(viewTitle("week", "2026-11-14")).toBe("9 to 15 November 2026");
    expect(viewTitle("week", "2026-12-02")).toBe("30 November to 6 December 2026");
    expect(viewTitle("week", "2026-12-30")).toBe("28 December 2026 to 3 January 2027");
    expect(viewTitle("month", "2026-11-14")).toBe("November 2026");
    expect(shortDay("2026-11-14")).toBe("Sat 14 Nov");
    expect(daysOf("2026-11-29", "2026-12-02")).toEqual(["2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02"]);
    expect(hourLabel(8)).toBe("08:00");
  });
});

describe("SCRUM-130/AC1 where a period sits on the day timeline", () => {
  it("SCRUM-130/AC1 covers 08:00 to 20:00 when nothing booked falls outside it, whatever the free, closed and blocked time says", () => {
    const v = venue([p("closed", "UNAVAILABLE", Z("00:00"), Z("08:00")), p("block", "BLOCKED", Z("00:00"), Z("24:00"))]);
    expect(hourBounds([v], "2026-11-14")).toEqual({ startHour: 8, endHour: 20 });
  });

  it("SCRUM-130/AC1 widens to whole hours to take in a booking's setup or turnaround outside 08:00 to 20:00", () => {
    const v = venue([p("setup", "CONFIRMED", Z("07:30"), Z("08:00")), p("event", "CONFIRMED", Z("08:00"), Z("20:00")), p("turnaround", "CONFIRMED", Z("20:00"), Z("20:45"))]);
    expect(hourBounds([v], "2026-11-14")).toEqual({ startHour: 7, endHour: 21 });
    expect(hourBounds([v], "2026-11-15")).toEqual({ startHour: 8, endHour: 20 }); // nothing that day
  });

  it("SCRUM-130/AC1 puts a 10:00 to 12:00 booking with 30 minutes setup and 45 minutes turnaround from 09:30 to 12:45", () => {
    const blocks = blocksForDay(
      [p("setup", "CONFIRMED", Z("09:30"), Z("10:00")), p("event", "CONFIRMED", Z("10:00"), Z("12:00")), p("turnaround", "CONFIRMED", Z("12:00"), Z("12:45"))],
      "2026-11-14", 8, 20,
    );
    expect(blocks.map((b) => [b.period.kind, b.startTime, b.endTime])).toEqual([["setup", "09:30", "10:00"], ["event", "10:00", "12:00"], ["turnaround", "12:00", "12:45"]]);
    // 12 hours wide: 09:30 is 1.5 h in, and the whole occupied stretch is 3.25 h
    expect(blocks[0].leftPct).toBeCloseTo(12.5);
    expect(blocks[2].leftPct + blocks[2].widthPct - blocks[0].leftPct).toBeCloseTo((3.25 / 12) * 100);
  });

  it("SCRUM-130/AC1 cuts a period at the edges of the hours shown and of the day, and drops one that misses them", () => {
    const blocks = blocksForDay([p("block", "BLOCKED", Z("06:00"), Z("09:00", 15)), p("event", "CONFIRMED", Z("21:00"), Z("22:00"))], "2026-11-14", 8, 24);
    expect(blocks).toHaveLength(2);
    expect([blocks[0].startTime, blocks[0].endTime, blocks[0].leftPct]).toEqual(["08:00", "24:00", 0]);
    expect(blocksForDay([p("event", "CONFIRMED", Z("21:00"), Z("22:00"))], "2026-11-14", 8, 20)).toEqual([]);
  });

  it("SCRUM-130/AC1 places the now line only on the day shown and inside its hours", () => {
    expect(nowPct("2026-11-14", 8, 20, new Date(Z("14:00")))).toBeCloseTo(50);
    expect(nowPct("2026-11-14", 8, 20, new Date(Z("07:00")))).toBeNull();
    expect(nowPct("2026-11-15", 8, 20, new Date(Z("14:00")))).toBeNull();
  });
});

describe("SCRUM-130 what a week or month cell shows", () => {
  const periods = [
    p("open", "AVAILABLE", Z("08:00"), Z("22:00")),
    p("event", "TENTATIVELY_HELD", Z("10:00"), Z("12:00")),
    p("setup", "TENTATIVELY_HELD", Z("09:30"), Z("10:00")),
    p("block", "BLOCKED", Z("22:00", 15), Z("02:00", 16)),
  ];

  it("SCRUM-130 lists only bookings and blocks that touch the day", () => {
    expect(busyOnDay(periods, "2026-11-14").map((x) => x.kind)).toEqual(["event"]);
    expect(busyOnDay(periods, "2026-11-16").map((x) => x.kind)).toEqual(["block"]);
    expect(busyOnDay(periods, "2026-11-17")).toEqual([]);
  });

  it("SCRUM-130 gives the busiest status of the day: blocked, then confirmed, then held, then free or closed", () => {
    expect(dayStatus(periods, "2026-11-14")).toBe("TENTATIVELY_HELD");
    expect(dayStatus([...periods, p("event", "CONFIRMED", Z("14:00"), Z("15:00"))], "2026-11-14")).toBe("CONFIRMED");
    expect(dayStatus(periods, "2026-11-15")).toBe("BLOCKED");
    expect(dayStatus([p("open", "AVAILABLE", Z("08:00", 17), Z("22:00", 17))], "2026-11-17")).toBe("AVAILABLE");
    expect(dayStatus([p("closed", "UNAVAILABLE", Z("00:00", 17), Z("24:00", 17))], "2026-11-17")).toBe("UNAVAILABLE");
  });
});

describe("SCRUM-130/AC2 closures that lie over confirmed bookings", () => {
  it("SCRUM-130/AC2 joins the pieces of one block back together and keeps it when any piece overlaps a confirmed booking", () => {
    const v = venue([
      p("block", "BLOCKED", Z("08:00"), Z("10:00"), { overlaps_confirmed_booking: false, reason_label: "Maintenance" }),
      p("block", "BLOCKED", Z("10:00"), Z("12:00"), { overlaps_confirmed_booking: true, reason_label: "Maintenance" }),
      p("block", "BLOCKED", Z("12:00"), Z("18:00"), { overlaps_confirmed_booking: false, reason_label: "Maintenance" }),
    ]);
    expect(affectedBlocks([v])).toEqual([{ venue: v, start: Z("08:00"), end: Z("18:00"), reasonLabel: "Maintenance" }]);
  });

  it("SCRUM-130/AC2 leaves out a block over nothing confirmed, and finds a flagged block that ends a venue's list or follows another period", () => {
    const quiet = venue([p("block", "BLOCKED", Z("08:00"), Z("10:00"), { overlaps_confirmed_booking: false })], "quiet");
    const late = venue([
      p("block", "BLOCKED", Z("06:00"), Z("07:00"), { overlaps_confirmed_booking: true }),
      p("open", "AVAILABLE", Z("07:00"), Z("09:00")),
      p("block", "BLOCKED", Z("09:00"), Z("10:00"), { overlaps_confirmed_booking: true }),
    ], "late");
    expect(affectedBlocks([quiet, late]).map((b) => [b.venue.id, b.start])).toEqual([["late", Z("06:00")], ["late", Z("09:00")]]);
  });
});
