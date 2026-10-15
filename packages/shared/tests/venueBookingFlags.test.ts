import { describe, expect, it } from "vitest";
import { sgtToUtc } from "../src/venueBooking";
import {
  NO_BOOKINGS_AFFECTED_MESSAGE,
  VENUE_BOOKING_FLAG_KINDS,
  VENUE_BOOKING_FLAG_LABELS,
  bufferConflictSummary,
  flagLabel,
  isVenueBookingFlagKind,
} from "../src/venueBookingFlags";

const at = (date: string, time: string) => sgtToUtc(date, time);

describe("SCRUM-104/AC1 flag kinds and labels (104-S1)", () => {
  it("104-S1: the two kinds and their exact labels, with an en dash", () => {
    expect(VENUE_BOOKING_FLAG_KINDS).toEqual(["buffer_conflict", "venue_unavailable"]);
    expect(VENUE_BOOKING_FLAG_LABELS.buffer_conflict).toBe("Buffer conflict");
    expect(VENUE_BOOKING_FLAG_LABELS.venue_unavailable).toBe("Venue unavailable – alternative needed");
    expect(VENUE_BOOKING_FLAG_LABELS.venue_unavailable).toContain("–");
    expect(VENUE_BOOKING_FLAG_LABELS.venue_unavailable).not.toContain("-");
  });

  it("104-S1: flagLabel and isVenueBookingFlagKind know the kinds and nothing else", () => {
    expect(isVenueBookingFlagKind("buffer_conflict")).toBe(true);
    expect(isVenueBookingFlagKind("venue_unavailable")).toBe(true);
    expect(isVenueBookingFlagKind("replaced")).toBe(false);
    expect(isVenueBookingFlagKind(undefined)).toBe(false);
    expect(flagLabel("buffer_conflict")).toBe("Buffer conflict");
    expect(flagLabel("nope")).toBeUndefined();
  });
});

describe("SCRUM-104/AC1 bufferConflictSummary (104-S1)", () => {
  it("104-S1: the customer's worked example", () => {
    // Orchid Hall setup 30, turnaround 45. Summit A 10:00-12:00 occupies until 12:45; Summit B 12:30-14:00 from 12:00.
    const summary = bufferConflictSummary(
      { name: "Summit A", eventStart: at("2026-11-14", "10:00"), occupiedUntil: at("2026-11-14", "12:45") },
      { name: "Summit B", eventStart: at("2026-11-14", "12:30"), occupiedFrom: at("2026-11-14", "12:00") },
    );
    expect(summary).toBe("Summit A (occupies until 12:45) now conflicts with Summit B (occupies from 12:00)");
  });

  it("104-S1: times are Singapore time, not UTC", () => {
    // 04:45 UTC is 12:45 in Singapore.
    const summary = bufferConflictSummary(
      { name: "A", eventStart: new Date("2026-11-14T02:00:00Z"), occupiedUntil: new Date("2026-11-14T04:45:00Z") },
      { name: "B", eventStart: new Date("2026-11-14T04:30:00Z"), occupiedFrom: new Date("2026-11-14T04:00:00Z") },
    );
    expect(summary).toBe("A (occupies until 12:45) now conflicts with B (occupies from 12:00)");
  });

  it("104-S1: a date is added when the earlier booking's turnaround runs into the next day", () => {
    const summary = bufferConflictSummary(
      { name: "Gala", eventStart: at("2026-11-14", "20:00"), occupiedUntil: at("2026-11-15", "00:30") },
      { name: "Brunch", eventStart: at("2026-11-15", "00:15"), occupiedFrom: at("2026-11-15", "00:00") },
    );
    expect(summary).toBe("Gala (occupies until 15 Nov 00:30) now conflicts with Brunch (occupies from 00:00)");
  });

  it("104-S1: a date is added when the later booking's setup starts the day before", () => {
    const summary = bufferConflictSummary(
      { name: "Late", eventStart: at("2026-11-14", "20:00"), occupiedUntil: at("2026-11-14", "23:30") },
      { name: "Early", eventStart: at("2026-11-15", "00:30"), occupiedFrom: at("2026-11-14", "23:00") },
    );
    expect(summary).toBe("Late (occupies until 23:30) now conflicts with Early (occupies from 14 Nov 23:00)");
  });

  it("104-S1: the day is the Singapore day, so 17:00 UTC counts as 01:00 on the next day", () => {
    const summary = bufferConflictSummary(
      { name: "A", eventStart: at("2026-11-14", "22:00"), occupiedUntil: new Date("2026-11-14T17:00:00Z") },
      { name: "B", eventStart: at("2026-11-14", "23:00"), occupiedFrom: at("2026-11-14", "23:00") },
    );
    expect(summary).toContain("A (occupies until 15 Nov 01:00)");
  });
});

describe("SCRUM-104/AC6 no bookings affected (104-S6)", () => {
  it("104-S6: the exact message", () => {
    expect(NO_BOOKINGS_AFFECTED_MESSAGE).toBe("No existing bookings are affected.");
  });
});
