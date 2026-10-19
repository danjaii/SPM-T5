import { describe, it, expect } from "vitest";
import {
  canRequestVenue,
  dbStatusToApi,
  exceedsCapacity,
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

  // SCRUM-102 made `cancelled` a status of this feature
  it("SCRUM-102 maps cancelled to CANCELLED, and an unknown status to undefined", () => {
    expect(dbStatusToApi("cancelled")).toBe("CANCELLED");
    expect(dbStatusToApi("nope")).toBeUndefined();
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

// ----------------------------------------------------------------------------
// SCRUM-98/AC2 each booking has its own expected attendance and venue requirements
// ----------------------------------------------------------------------------

describe("SCRUM-98/AC2 parseVenueBookingInput: the booking's own attendance and requirements (98-S6, 98-S7, 98-S12)", () => {
  const now = new Date("2026-10-01T00:00:00.000Z");
  const valid = { venueId: "venue-1", date: "2026-11-14", startTime: "09:00", endTime: "17:00" };

  it("98-S6 keeps the attendance and the requirements typed for this booking, trimmed", () => {
    const result = parseVenueBookingInput({ ...valid, expectedAttendance: 80, venueRequirements: "  Banquet, stage  " }, now);
    expect(result).toMatchObject({ ok: true, data: { expectedAttendance: 80, venueRequirements: "Banquet, stage" } });
  });

  // left out, null or blank all mean "use the event's" (the service fills them in)
  it.each([
    ["left out", {}],
    ["null", { expectedAttendance: null, venueRequirements: null }],
    ["blank", { venueRequirements: "   " }],
  ])("98-S7 %s: no attendance or requirements of its own", (_name, extra) => {
    const result = parseVenueBookingInput({ ...valid, ...extra }, now);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.expectedAttendance).toBeUndefined();
      expect(result.data.venueRequirements).toBeUndefined();
    }
  });

  it.each([
    ["0", 0],
    ["a negative number", -5],
    ["a fraction", 2.5],
    ["text", "abc"],
  ])("98-S12 refuses %s as the attendance, keyed by expectedAttendance", (_name, expectedAttendance) => {
    expect(parseVenueBookingInput({ ...valid, expectedAttendance }, now)).toEqual({
      ok: false,
      fieldErrors: { expectedAttendance: "Enter the expected attendance as a whole number of 1 or more." },
    });
  });

  it("98-S12 refuses requirements longer than 500 characters, keyed by venueRequirements", () => {
    expect(parseVenueBookingInput({ ...valid, venueRequirements: "x".repeat(501) }, now)).toEqual({
      ok: false,
      fieldErrors: { venueRequirements: "The venue requirements must be 500 characters or fewer." },
    });
    expect(parseVenueBookingInput({ ...valid, venueRequirements: "x".repeat(500) }, now).ok).toBe(true);
  });
});

describe("SCRUM-98/AC2 exceedsCapacity: the warning, not a refusal (98-S10, 98-S11)", () => {
  it.each([
    ["98-S10", 200, 150, true],
    ["98-S10", 151, 150, true],
    ["98-S11", 150, 150, false], // exactly full is fine
    ["98-S11", 100, 150, false],
  ])("%s attendance %i at a venue for %i: %s", (_id, attendance, capacity, expected) => {
    expect(exceedsCapacity(attendance, capacity)).toBe(expected);
  });

  // with no attendance, or no capacity on record, there is nothing to warn about
  it.each([
    [null, 150],
    [200, null],
    [null, null],
  ])("98-S11 attendance %s at a venue for %s: false", (attendance, capacity) => {
    expect(exceedsCapacity(attendance, capacity)).toBe(false);
  });
});
