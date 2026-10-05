import { describe, it, expect } from "vitest";
import {
  canRequestVenue,
  dbStatusToApi,
  HOLDING_DB_STATUSES,
  isHoldingDbStatus,
  parseRejectionInput,
  parseVenueBookingInput,
  periodsOverlap,
  sgtToUtc,
  utcToSgt,
  VENUE_BOOKING_MESSAGES,
} from "../src/venueBooking";

const day = (start: string, end: string) => ({
  start: sgtToUtc("2026-11-14", start),
  end: sgtToUtc("2026-11-14", end),
});

describe("SCRUM-36 — periodsOverlap (DR5, half-open)", () => {
  const held = day("09:00", "17:00");

  it.each([
    ["36-S1 partly overlaps", "13:00", "18:00"],
    ["36-S1 identical", "09:00", "17:00"],
    ["36-S1 falls inside", "10:00", "12:00"],
    ["36-S1 contains the held period", "08:00", "18:00"],
    ["36-S1 overlaps by one minute", "16:59", "18:00"],
  ])("%s", (_name, start, end) => {
    expect(periodsOverlap(held, day(start, end))).toBe(true);
    expect(periodsOverlap(day(start, end), held)).toBe(true);
  });

  it.each([
    ["36-S2 starts exactly when the held period ends", "17:00", "18:00"],
    ["36-S2 ends exactly when the held period starts", "07:00", "09:00"],
  ])("%s", (_name, start, end) => {
    expect(periodsOverlap(held, day(start, end))).toBe(false);
    expect(periodsOverlap(day(start, end), held)).toBe(false);
  });

  it("36-S2 a different date never overlaps", () => {
    const nextDay = { start: sgtToUtc("2026-11-15", "09:00"), end: sgtToUtc("2026-11-15", "17:00") };
    expect(periodsOverlap(held, nextDay)).toBe(false);
  });
});

describe("DR3 — Singapore time conversion", () => {
  it("converts SGT (UTC+8) to UTC", () => {
    expect(sgtToUtc("2026-11-14", "09:00").toISOString()).toBe("2026-11-14T01:00:00.000Z");
    expect(sgtToUtc("2026-11-14", "00:30").toISOString()).toBe("2026-11-13T16:30:00.000Z");
  });

  it("round-trips back to SGT date and time", () => {
    expect(utcToSgt(new Date("2026-11-13T16:30:00.000Z"))).toEqual({ date: "2026-11-14", time: "00:30" });
  });
});

describe("DR4/DR5 — status mapping", () => {
  it("maps DB statuses to API statuses", () => {
    expect(dbStatusToApi("requested")).toBe("PENDING");
    expect(dbStatusToApi("approved")).toBe("APPROVED");
    expect(dbStatusToApi("tentative")).toBe("APPROVED");
    expect(dbStatusToApi("confirmed")).toBe("APPROVED");
    expect(dbStatusToApi("rejected")).toBe("REJECTED");
    expect(dbStatusToApi("withdrawn")).toBe("WITHDRAWN");
  });

  it("returns undefined for a status outside this feature (cancelled)", () => {
    expect(dbStatusToApi("cancelled")).toBeUndefined();
  });

  it("holds the slot only for requested, tentative, approved and confirmed", () => {
    expect([...HOLDING_DB_STATUSES].sort()).toEqual(["approved", "confirmed", "requested", "tentative"]);
    expect(isHoldingDbStatus("rejected")).toBe(false);
    expect(isHoldingDbStatus("withdrawn")).toBe(false);
  });
});

describe("SCRUM-32 32-S3 — canRequestVenue (DR9 + implementation decision)", () => {
  it.each(["approved", "planning", "awaiting_arrangements"])("%s can request", (status) => {
    expect(canRequestVenue(status)).toBe(true);
  });

  it.each(["draft", "submitted", "under_review", "returned", "confirmed", "completed", "cancelled", "rejected"])(
    "%s cannot request",
    (status) => {
      expect(canRequestVenue(status)).toBe(false);
    },
  );

  it("rejects unknown values", () => {
    expect(canRequestVenue("nonsense")).toBe(false);
  });
});

describe("SCRUM-32 32-S5 — parseVenueBookingInput", () => {
  const now = new Date("2026-10-01T00:00:00.000Z");
  const valid = { venueId: "venue-1", date: "2026-11-14", startTime: "09:00", endTime: "17:00" };

  it("accepts a valid request and returns UTC instants", () => {
    const result = parseVenueBookingInput(valid, now);
    expect(result).toEqual({
      ok: true,
      data: {
        venueId: "venue-1",
        date: "2026-11-14",
        startTime: "09:00",
        endTime: "17:00",
        start: new Date("2026-11-14T01:00:00.000Z"),
        end: new Date("2026-11-14T09:00:00.000Z"),
      },
    });
  });

  it("rejects an end before the start", () => {
    const result = parseVenueBookingInput({ ...valid, startTime: "17:00", endTime: "09:00" }, now);
    expect(result).toMatchObject({ ok: false, fieldErrors: { endTime: expect.any(String) } });
  });

  it("rejects an end equal to the start", () => {
    const result = parseVenueBookingInput({ ...valid, startTime: "09:00", endTime: "09:00" }, now);
    expect(result).toMatchObject({ ok: false, fieldErrors: { endTime: expect.any(String) } });
  });

  it("rejects a start in the past", () => {
    const result = parseVenueBookingInput({ ...valid, date: "2026-09-30" }, now);
    expect(result).toMatchObject({ ok: false, fieldErrors: { startTime: expect.any(String) } });
  });

  it("rejects a missing venue", () => {
    const result = parseVenueBookingInput({ ...valid, venueId: "" }, now);
    expect(result).toMatchObject({ ok: false, fieldErrors: { venueId: expect.any(String) } });
    const missing = parseVenueBookingInput({ date: valid.date, startTime: "09:00", endTime: "17:00" }, now);
    expect(missing).toMatchObject({ ok: false, fieldErrors: { venueId: expect.any(String) } });
  });

  it("rejects malformed dates and times", () => {
    const result = parseVenueBookingInput({ ...valid, date: "14/11/2026", startTime: "9am", endTime: "25:00" }, now);
    expect(result).toMatchObject({
      ok: false,
      fieldErrors: { date: expect.any(String), startTime: expect.any(String), endTime: expect.any(String) },
    });
  });

  it("rejects a non-object body", () => {
    expect(parseVenueBookingInput(undefined, now)).toMatchObject({ ok: false });
  });
});

describe("SCRUM-38/AC8 — SLOT_IN_PAST message (38-S8)", () => {
  it("38-S8 has a standard message so the API and the UI say the same thing", () => {
    expect(VENUE_BOOKING_MESSAGES.SLOT_IN_PAST).toBe("The requested time has already passed.");
  });
});

describe("SCRUM-39/AC2 — parseRejectionInput (39-S2)", () => {
  it("39-S2 accepts a reason and stores it trimmed", () => {
    expect(parseRejectionInput({ reason: "  Room under renovation until 2026-12-01 \n" })).toEqual({
      ok: true,
      data: { reason: "Room under renovation until 2026-12-01" },
    });
  });

  it.each([
    ["1 character", "x"],
    ["500 characters", "x".repeat(500)],
    ["500 characters once trimmed", `  ${"x".repeat(500)}  `],
  ])("39-S2 accepts %s", (_name, reason) => {
    expect(parseRejectionInput({ reason })).toMatchObject({ ok: true });
  });

  it.each([
    ["empty", ""],
    ["only spaces", "   \t "],
    ["501 characters", "x".repeat(501)],
  ])("39-S2 refuses %s, keyed by reason", (_name, reason) => {
    expect(parseRejectionInput({ reason })).toEqual({ ok: false, fieldErrors: { reason: expect.any(String) } });
  });

  it.each([undefined, null, "text", { reason: 5 }, {}])("39-S2 refuses a missing or non-string reason (%j)", (body) => {
    expect(parseRejectionInput(body)).toEqual({ ok: false, fieldErrors: { reason: expect.any(String) } });
  });

  it("gives different messages for missing and too long", () => {
    expect(parseRejectionInput({ reason: "" })).toMatchObject({ fieldErrors: { reason: "Enter a reason for the rejection." } });
    expect(parseRejectionInput({ reason: "x".repeat(501) })).toMatchObject({
      fieldErrors: { reason: "The reason must be 500 characters or fewer." },
    });
  });

  it("strips unknown keys, so an optional suggestion can be added later (SCRUM-40 seam)", () => {
    expect(parseRejectionInput({ reason: "No", suggestion: { venueId: "v" }, extra: 1 })).toEqual({
      ok: true,
      data: { reason: "No" },
    });
  });
});
