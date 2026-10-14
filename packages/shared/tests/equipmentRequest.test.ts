import { describe, expect, it } from "vitest";
import {
  canRequestEquipment,
  EQUIPMENT_READINESS_LABELS,
  EQUIPMENT_REQUEST_LOCKED_EVENT_STATUSES,
  EQUIPMENT_REQUEST_MESSAGES,
  EQUIPMENT_REQUEST_REASON_MAX_LENGTH,
  EQUIPMENT_REQUEST_REVIEW_DB_STATUS,
  EQUIPMENT_REQUEST_REVIEW_MESSAGES,
  EQUIPMENT_REQUEST_STATUS_LABELS,
  EQUIPMENT_REQUEST_STATUSES,
  equipmentOptionLabel,
  equipmentReadiness,
  equipmentRequestStatusOf,
  isWaitingEquipmentRequest,
  parseEquipmentRequestReviewInput,
  isRequestableEquipment,
  isRequestableVenueBooking,
  parseEquipmentRequestInput,
} from "../src/equipmentRequest";

// A request with every field filled in; each test changes only the field it is about.
const valid = { equipmentId: "eq-mic", quantity: "4", venueBookingId: "vb-1", notes: "Two on stage" };

describe("SCRUM-86/AC1 a complete request is accepted", () => {
  it("returns the cleaned-up request, quantity as a number", () => {
    expect(parseEquipmentRequestInput(valid)).toEqual({
      ok: true,
      data: { equipmentId: "eq-mic", quantity: 4, venueBookingId: "vb-1", notes: "Two on stage" },
    });
  });

  it("technical notes are optional: blank notes are saved as none", () => {
    for (const notes of [undefined, "", "   "]) {
      const parsed = parseEquipmentRequestInput({ ...valid, notes });
      expect(parsed).toEqual({ ok: true, data: expect.objectContaining({ notes: null }) });
    }
  });

  it("trims spaces and accepts the quantity as a number too", () => {
    const parsed = parseEquipmentRequestInput({ ...valid, equipmentId: " eq-mic ", quantity: 12 });
    expect(parsed).toEqual({ ok: true, data: expect.objectContaining({ equipmentId: "eq-mic", quantity: 12 }) });
  });
});

describe("SCRUM-86/AC4 missing information", () => {
  it.each([
    ["equipmentId", EQUIPMENT_REQUEST_MESSAGES.equipmentMissing],
    ["quantity", EQUIPMENT_REQUEST_MESSAGES.quantityMissing],
    ["venueBookingId", EQUIPMENT_REQUEST_MESSAGES.venueMissing],
  ])("an empty %s is refused with its own message", (field, message) => {
    for (const empty of [undefined, null, "", "  "]) {
      expect(parseEquipmentRequestInput({ ...valid, [field]: empty })).toEqual({ ok: false, fieldErrors: { [field]: message } });
    }
  });

  it("reports every empty field at once, so all of them can be highlighted", () => {
    expect(parseEquipmentRequestInput({ notes: "kept" })).toEqual({
      ok: false,
      fieldErrors: {
        equipmentId: EQUIPMENT_REQUEST_MESSAGES.equipmentMissing,
        quantity: EQUIPMENT_REQUEST_MESSAGES.quantityMissing,
        venueBookingId: EQUIPMENT_REQUEST_MESSAGES.venueMissing,
      },
    });
  });

  it("treats a missing body as all fields empty", () => {
    expect(parseEquipmentRequestInput(undefined)).toMatchObject({ ok: false });
  });
});

describe("SCRUM-86/AC5 wrong quantity", () => {
  it("uses the spec's exact wording", () => {
    expect(EQUIPMENT_REQUEST_MESSAGES.quantityInvalid).toBe("Quantity must be a whole number of 1 or more");
  });

  it.each(["0", "-1", "-5", "1.5", "2.0", "abc", "3a", "1e3", 0, -2, 2.5, "9999999999"])("%s is refused", (quantity) => {
    expect(parseEquipmentRequestInput({ ...valid, quantity })).toEqual({
      ok: false,
      fieldErrors: { quantity: EQUIPMENT_REQUEST_MESSAGES.quantityInvalid },
    });
  });

  it.each([["1", 1], ["007", 7], ["999999999", 999999999]])("%s is accepted", (quantity, expected) => {
    expect(parseEquipmentRequestInput({ ...valid, quantity })).toEqual({
      ok: true,
      data: expect.objectContaining({ quantity: expected }),
    });
  });
});

describe("SCRUM-86/AC6 finished events (decision: Completed, Cancelled or Rejected)", () => {
  it("the locked statuses are exactly these three", () => {
    expect([...EQUIPMENT_REQUEST_LOCKED_EVENT_STATUSES].sort()).toEqual(["cancelled", "completed", "rejected"]);
  });

  it.each(["completed", "cancelled", "rejected"])("no requests for a %s event", (status) => {
    expect(canRequestEquipment(status)).toBe(false);
  });

  it.each(["submitted", "under_review", "approved", "planning", "awaiting_arrangements", "confirmed"])(
    "requests allowed for a %s event",
    (status) => {
      expect(canRequestEquipment(status)).toBe(true);
    },
  );
});

describe("SCRUM-86 venue and item choices (open question 1 and the item decision)", () => {
  it("open question 1: if a venue were not required, a request without one would be accepted", () => {
    expect(parseEquipmentRequestInput({ ...valid, venueBookingId: "" }, { venueRequired: false })).toEqual({
      ok: true,
      data: expect.objectContaining({ venueBookingId: null }),
    });
  });

  it("only bookings the venue pages show as Approved can be picked (legacy tentative and confirmed rows too)", () => {
    for (const status of ["approved", "tentative", "confirmed"]) expect(isRequestableVenueBooking(status)).toBe(true);
    for (const status of ["requested", "rejected", "cancelled", "withdrawn"]) {
      expect(isRequestableVenueBooking(status)).toBe(false);
    }
  });

  it("every item except a retired one can be requested", () => {
    for (const status of ["available", "damaged", "under_maintenance"]) expect(isRequestableEquipment(status)).toBe(true);
    expect(isRequestableEquipment("retired")).toBe(false);
  });

  it("an item is listed under its type, or by name alone when it has none", () => {
    expect(equipmentOptionLabel({ type: "Audio", name: "Wireless Microphone Set" })).toBe("Audio: Wireless Microphone Set");
    expect(equipmentOptionLabel({ type: null, name: "Extension Cable" })).toBe("Extension Cable");
  });
});

describe("SCRUM-86/AC2,AC3 each request shows its own status", () => {
  it.each([
    ["requested", "Submitted"],
    ["approved", "Arranged"],
    ["reserved", "Arranged"],
    ["rejected", "Cannot Fulfil"],
  ])("a %s row shows as %s", (dbStatus, label) => {
    expect(EQUIPMENT_REQUEST_STATUS_LABELS[equipmentRequestStatusOf(dbStatus)!]).toBe(label);
  });

  it("a cancelled row is not shown", () => {
    expect(equipmentRequestStatusOf("cancelled")).toBeUndefined();
  });
});

describe("SCRUM-87/AC4, AC5 parseEquipmentRequestReviewInput", () => {
  it.each(["UNDER_REVIEW", "ARRANGED"] as const)("accepts %s, dropping any reason", (status) => {
    expect(parseEquipmentRequestReviewInput({ status, reason: "not needed" })).toEqual({ ok: true, data: { status, reason: null } });
  });

  it("accepts Cannot Fulfil with a trimmed reason", () => {
    expect(parseEquipmentRequestReviewInput({ status: " CANNOT_FULFIL ", reason: "  All out on loan " })).toEqual({
      ok: true,
      data: { status: "CANNOT_FULFIL", reason: "All out on loan" },
    });
  });

  it.each([undefined, null, "", "SUBMITTED", "arranged"])("refuses the status %j", (status) => {
    expect(parseEquipmentRequestReviewInput({ status })).toEqual({
      ok: false,
      fieldErrors: { status: EQUIPMENT_REQUEST_REVIEW_MESSAGES.statusMissing },
    });
  });

  it("AC5: Cannot Fulfil without a reason asks for one", () => {
    for (const reason of [undefined, "", "   "]) {
      expect(parseEquipmentRequestReviewInput({ status: "CANNOT_FULFIL", reason })).toEqual({
        ok: false,
        fieldErrors: { reason: EQUIPMENT_REQUEST_REVIEW_MESSAGES.reasonMissing },
      });
    }
  });

  it("refuses a reason over the limit, and an empty body", () => {
    const tooLong = "x".repeat(EQUIPMENT_REQUEST_REASON_MAX_LENGTH + 1);
    expect(parseEquipmentRequestReviewInput({ status: "CANNOT_FULFIL", reason: tooLong })).toEqual({
      ok: false,
      fieldErrors: { reason: EQUIPMENT_REQUEST_REVIEW_MESSAGES.reasonTooLong },
    });
    expect(parseEquipmentRequestReviewInput(undefined)).toMatchObject({ ok: false, fieldErrors: { status: expect.any(String) } });
  });

  it("each choice saves the DB status review_equipment_request() accepts", () => {
    expect(EQUIPMENT_REQUEST_REVIEW_DB_STATUS).toEqual({ UNDER_REVIEW: "under_review", ARRANGED: "approved", CANNOT_FULFIL: "rejected" });
    for (const [status, db] of Object.entries(EQUIPMENT_REQUEST_REVIEW_DB_STATUS)) {
      expect(equipmentRequestStatusOf(db)).toBe(status);
    }
  });
});

describe("SCRUM-87/AC1, AC4 waiting requests", () => {
  it("Submitted and Under Review are waiting; Arranged and Cannot Fulfil are not", () => {
    expect(EQUIPMENT_REQUEST_STATUSES.filter(isWaitingEquipmentRequest)).toEqual(["SUBMITTED", "UNDER_REVIEW"]);
  });
});

describe("SCRUM-87/AC6 equipmentReadiness", () => {
  it("Complete when every request is Arranged", () => {
    expect(equipmentReadiness(["ARRANGED", "ARRANGED"])).toBe("COMPLETE");
  });

  it.each(["SUBMITTED", "UNDER_REVIEW", "CANNOT_FULFIL"] as const)("Incomplete when any request is %s", (status) => {
    expect(equipmentReadiness(["ARRANGED", status])).toBe("INCOMPLETE");
  });

  it("nothing to say when there are no requests", () => {
    expect(equipmentReadiness([])).toBeNull();
    expect(EQUIPMENT_READINESS_LABELS).toEqual({ COMPLETE: "Complete", INCOMPLETE: "Incomplete" });
  });
});
