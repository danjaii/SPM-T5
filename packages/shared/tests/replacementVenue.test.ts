import { describe, expect, it } from "vitest";
import {
  VENUE_BOOKING_ERROR_CODES,
  VENUE_BOOKING_MESSAGES,
  VENUE_BOOKING_STATUSES,
  canRequestReplacement,
  canRequestVenue,
  dbStatusToApi,
  isHoldingDbStatus,
} from "../src/venueBooking";
import { canFindReplacement } from "../src/venueBookingFlags";

// SCRUM-107 (docs/specs/replacement-venue.md): the shared rules behind "Find replacement".

describe("SCRUM-107/AC3 the REPLACED status (107-S3)", () => {
  it("107-S3: the database value replaced is the API status REPLACED, and a replaced booking does not hold its venue", () => {
    expect(VENUE_BOOKING_STATUSES).toContain("REPLACED");
    expect(dbStatusToApi("replaced")).toBe("REPLACED");
    expect(isHoldingDbStatus("replaced")).toBe(false);
  });
});

describe("SCRUM-107/AC2 which events may have a replacement (decision 3, 107-S2)", () => {
  it("107-S2: a Confirmed event may, though it cannot raise an ordinary request", () => {
    expect(canRequestVenue("confirmed")).toBe(false);
    expect(canRequestReplacement("confirmed")).toBe(true);
  });

  it.each(["approved", "planning", "awaiting_arrangements"])("107-S2: a %s event may", (status) => {
    expect(canRequestReplacement(status)).toBe(true);
  });

  it.each(["completed", "cancelled", "rejected"])("107-S2: a %s event may not", (status) => {
    expect(canRequestReplacement(status)).toBe(false);
  });
});

describe("SCRUM-107 refusals (107-S4, 107-S5, 107-S6)", () => {
  it("107-S6: NOT_FLAGGED, REPLACEMENT_PENDING and REPLACEMENT_REJECTED are known codes with their messages", () => {
    for (const code of ["NOT_FLAGGED", "REPLACEMENT_PENDING", "REPLACEMENT_REJECTED"] as const) {
      expect(VENUE_BOOKING_ERROR_CODES).toContain(code);
      expect(VENUE_BOOKING_MESSAGES[code].length).toBeGreaterThan(10);
    }
    expect(VENUE_BOOKING_MESSAGES.NOT_FLAGGED).toBe("Only a booking flagged as unavailable can be replaced.");
    expect(VENUE_BOOKING_MESSAGES.REPLACEMENT_PENDING).toBe("This booking already has a replacement request waiting for a decision.");
  });
});

describe("SCRUM-107/AC5, AC6 canFindReplacement (107-S5, 107-S6)", () => {
  const ok = { isAssignedCoordinator: true, holding: true, flags: [{ kind: "venue_unavailable" as const }], hasPendingReplacement: false };

  it("107-S1: offered for the assigned coordinator on a holding booking flagged as unavailable", () => {
    expect(canFindReplacement(ok)).toBe(true);
  });

  it("107-S5: not while a replacement waits", () => {
    expect(canFindReplacement({ ...ok, hasPendingReplacement: true })).toBe(false);
  });

  it("107-S6: not without the flag, with only a buffer-conflict flag, for someone else, or on a booking that does not hold", () => {
    expect(canFindReplacement({ ...ok, flags: [] })).toBe(false);
    expect(canFindReplacement({ ...ok, flags: [{ kind: "buffer_conflict" }] })).toBe(false);
    expect(canFindReplacement({ ...ok, isAssignedCoordinator: false })).toBe(false);
    expect(canFindReplacement({ ...ok, holding: false })).toBe(false);
  });
});
