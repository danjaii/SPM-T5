import { describe, expect, it } from "vitest";
import { NOTIFICATION_TYPES } from "../src/notifications";
import {
  ACKNOWLEDGEABLE_NOTIFICATION_TYPES,
  TECHNICAL_ASSIGNMENT_MESSAGES,
  TECHNICAL_ASSIGNMENT_STATUS_LABELS,
  parseTechnicalAssignmentCancel,
  parseTechnicalAssignmentInput,
  technicalAssignmentStatus,
} from "../src/technicalAssignment";

// ----------------------------------------------------------------------------
// SCRUM-20 (docs/specs/technical-assignment-notifications.md): the rules the assign form and equipment-service share.
// Test setup: an assignment on Thu 21 Jan 2027, 08:00 to 17:00 Singapore time (00:00 to 09:00 UTC).
// ----------------------------------------------------------------------------

const valid = {
  staffId: "tech-1",
  venueBookingId: "vb-1",
  startDate: "2027-01-21",
  startTime: "08:00",
  endDate: "2027-01-21",
  endTime: "17:00",
  note: "  Livestream desk  ",
};

describe("SCRUM-20/AC1 the assign form's fields (20-S12)", () => {
  it("20-S12: a complete form gives the staff member, venue booking, UTC start and end, and the trimmed note", () => {
    expect(parseTechnicalAssignmentInput(valid, { requireStaff: true })).toEqual({
      ok: true,
      data: {
        staffId: "tech-1",
        venueBookingId: "vb-1",
        start: "2027-01-21T00:00:00.000Z",
        end: "2027-01-21T09:00:00.000Z",
        note: "Livestream desk",
      },
    });
  });

  it("20-S12: an empty note is saved as none", () => {
    const parsed = parseTechnicalAssignmentInput({ ...valid, note: "   " }, { requireStaff: true });
    expect(parsed.ok && parsed.data.note).toBeNull();
  });

  it("20-S12: every missing field is reported at once", () => {
    expect(parseTechnicalAssignmentInput({}, { requireStaff: true })).toEqual({
      ok: false,
      fieldErrors: {
        staffId: TECHNICAL_ASSIGNMENT_MESSAGES.staffMissing,
        venueBookingId: TECHNICAL_ASSIGNMENT_MESSAGES.venueBookingMissing,
        startDate: TECHNICAL_ASSIGNMENT_MESSAGES.dateMissing,
        startTime: TECHNICAL_ASSIGNMENT_MESSAGES.timeMissing,
        endDate: TECHNICAL_ASSIGNMENT_MESSAGES.dateMissing,
        endTime: TECHNICAL_ASSIGNMENT_MESSAGES.timeMissing,
      },
    });
  });

  it("20-S4: changing an assignment does not ask for the staff member again, and ignores one sent", () => {
    const parsed = parseTechnicalAssignmentInput({ ...valid, staffId: undefined }, { requireStaff: false });
    expect(parsed.ok && parsed.data.staffId).toBeUndefined();
    const ignored = parseTechnicalAssignmentInput(valid, { requireStaff: false });
    expect(ignored.ok && ignored.data.staffId).toBeUndefined();
  });

  it("20-S2: the end must be after the start", () => {
    for (const endTime of ["08:00", "07:59"]) {
      expect(parseTechnicalAssignmentInput({ ...valid, endTime }, { requireStaff: true })).toEqual({
        ok: false,
        fieldErrors: { endTime: TECHNICAL_ASSIGNMENT_MESSAGES.endBeforeStart },
      });
    }
  });

  it("20-S12: badly written dates and times, and a note over 500 characters, are refused", () => {
    const parsed = parseTechnicalAssignmentInput(
      { ...valid, startDate: "21/01/2027", endTime: "5pm", note: "x".repeat(501) },
      { requireStaff: true },
    );
    expect(parsed).toEqual({
      ok: false,
      fieldErrors: {
        startDate: TECHNICAL_ASSIGNMENT_MESSAGES.dateMissing,
        endTime: TECHNICAL_ASSIGNMENT_MESSAGES.timeMissing,
        note: TECHNICAL_ASSIGNMENT_MESSAGES.noteTooLong,
      },
    });
  });

  it("20-S12: a body that is not an object is refused like an empty one", () => {
    const parsed = parseTechnicalAssignmentInput(null, { requireStaff: false });
    expect(parsed.ok).toBe(false);
  });
});

describe("SCRUM-20/AC3 the cancellation reason (20-S6)", () => {
  it("20-S6: a reason is required, trimmed, and at most 500 characters", () => {
    expect(parseTechnicalAssignmentCancel({ reason: "  Event moved online " })).toEqual({ ok: true, reason: "Event moved online" });
    expect(parseTechnicalAssignmentCancel({ reason: "   " })).toEqual({ ok: false, error: TECHNICAL_ASSIGNMENT_MESSAGES.reasonMissing });
    expect(parseTechnicalAssignmentCancel(undefined)).toEqual({ ok: false, error: TECHNICAL_ASSIGNMENT_MESSAGES.reasonMissing });
    expect(parseTechnicalAssignmentCancel({ reason: "x".repeat(501) })).toEqual({
      ok: false,
      error: TECHNICAL_ASSIGNMENT_MESSAGES.reasonTooLong,
    });
  });
});

describe("SCRUM-20/AC5 an assignment's status (20-S10)", () => {
  it("20-S10: Cancelled wins, then Acknowledged, else Assigned, each with its label", () => {
    expect(technicalAssignmentStatus({ cancelledAt: "2026-10-16T00:00:00Z", acknowledgedAt: "2026-10-15T00:00:00Z" })).toBe("CANCELLED");
    expect(technicalAssignmentStatus({ cancelledAt: null, acknowledgedAt: "2026-10-15T00:00:00Z" })).toBe("ACKNOWLEDGED");
    expect(technicalAssignmentStatus({ cancelledAt: null, acknowledgedAt: null })).toBe("ASSIGNED");
    expect(TECHNICAL_ASSIGNMENT_STATUS_LABELS).toEqual({ ASSIGNED: "Assigned", ACKNOWLEDGED: "Acknowledged", CANCELLED: "Cancelled" });
  });
});

describe("SCRUM-20/AC4 the notification types (20-S11)", () => {
  it("20-S11: the three assignment types are known, and only assigned and changed can be acknowledged", () => {
    expect(NOTIFICATION_TYPES).toEqual(
      expect.arrayContaining(["technical_assignment_assigned", "technical_assignment_changed", "technical_assignment_cancelled"]),
    );
    expect(ACKNOWLEDGEABLE_NOTIFICATION_TYPES).toEqual(["technical_assignment_assigned", "technical_assignment_changed"]);
  });
});
