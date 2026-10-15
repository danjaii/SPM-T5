import { describe, expect, it } from "vitest";
import { sgtToUtc } from "../src/venueBooking";
import {
  SELECTABLE_UNAVAILABILITY_REASONS,
  UNAVAILABILITY_REASON_LABELS,
  UNAVAILABILITY_REASONS,
  canMarkVenueUnavailable,
  formatShortSgt,
  isSelectableUnavailabilityReason,
  isUnavailabilityReason,
  parseUnavailabilityInput,
  unavailabilityReasonLabel,
  unavailableMessage,
} from "../src/venueUnavailability";

const valid = {
  startDate: "2026-11-14",
  startTime: "08:00",
  endDate: "2026-11-16",
  endTime: "18:00",
  reason: "maintenance",
};

const errorsOf = (body: unknown) => {
  const r = parseUnavailabilityInput(body);
  return r.ok ? undefined : r.fieldErrors;
};

describe("SCRUM-105/AC1 parseUnavailabilityInput accepts a valid period (105-S1)", () => {
  it("105-S1: reads the Jira example in Singapore time and returns UTC instants", () => {
    const r = parseUnavailabilityInput(valid);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.start).toEqual(sgtToUtc("2026-11-14", "08:00"));
    expect(r.data.end).toEqual(sgtToUtc("2026-11-16", "18:00"));
    expect(r.data.start.toISOString()).toBe("2026-11-14T00:00:00.000Z");
    expect(r.data.reason).toBe("maintenance");
    expect(r.data.notes).toBeUndefined();
  });

  it("105-S1: notes are trimmed and kept; blank notes are left out", () => {
    const withNotes = parseUnavailabilityInput({ ...valid, notes: "  Chiller replaced  " });
    expect(withNotes).toMatchObject({ ok: true, data: { notes: "Chiller replaced" } });
    const blank = parseUnavailabilityInput({ ...valid, notes: "   " });
    expect(blank.ok && blank.data.notes).toBeUndefined();
    expect(parseUnavailabilityInput({ ...valid, notes: null }).ok).toBe(true);
  });

  it("105-S1: every selectable reason is accepted", () => {
    for (const reason of SELECTABLE_UNAVAILABILITY_REASONS) {
      expect(parseUnavailabilityInput({ ...valid, reason, notes: "n" }).ok).toBe(true);
    }
  });

  it("105-S1: a period that starts in the past is allowed", () => {
    expect(parseUnavailabilityInput({ ...valid, startDate: "2020-01-01", endDate: "2020-01-02" }).ok).toBe(true);
  });
});

describe("SCRUM-105/AC2 a reason is required (105-S2)", () => {
  it("105-S2: missing, null and blank reasons are refused with a message on reason", () => {
    const { reason: _omitted, ...withoutReason } = valid;
    expect(errorsOf(withoutReason)).toEqual({ reason: "Choose a reason." });
    expect(errorsOf({ ...valid, reason: null })).toEqual({ reason: "Choose a reason." });
    expect(errorsOf({ ...valid, reason: "  " })).toEqual({ reason: "Choose a reason." });
  });

  it("105-S2: internal_activity and unknown values cannot be chosen", () => {
    expect(errorsOf({ ...valid, reason: "internal_activity" })).toEqual({ reason: "Choose one of the listed reasons." });
    expect(errorsOf({ ...valid, reason: "party" })).toEqual({ reason: "Choose one of the listed reasons." });
    expect(errorsOf({ ...valid, reason: 3 })).toEqual({ reason: "Choose one of the listed reasons." });
  });

  it("105-S2: other needs notes [PROPOSED]", () => {
    expect(errorsOf({ ...valid, reason: "other" })).toEqual({ notes: "Enter notes describing the reason." });
    expect(errorsOf({ ...valid, reason: "other", notes: "  " })).toEqual({ notes: "Enter notes describing the reason." });
    expect(parseUnavailabilityInput({ ...valid, reason: "other", notes: "Filming" }).ok).toBe(true);
  });

  it("105-S2: notes over 500 characters are refused", () => {
    expect(errorsOf({ ...valid, notes: "x".repeat(501) })).toHaveProperty("notes");
    expect(parseUnavailabilityInput({ ...valid, notes: "x".repeat(500) }).ok).toBe(true);
    expect(errorsOf({ ...valid, notes: 5 })).toHaveProperty("notes");
  });

  it("105-S2: a reason problem is reported together with the other problems", () => {
    expect(Object.keys(errorsOf({ startDate: "x" })!).sort()).toEqual(["endDate", "endTime", "reason", "startDate", "startTime"]);
  });
});

describe("SCRUM-105/AC3 the end must follow the start (105-S3)", () => {
  it("105-S3: an end equal to the start is refused", () => {
    expect(errorsOf({ ...valid, endDate: "2026-11-14", endTime: "08:00" })).toEqual({ endTime: "The end must be after the start." });
  });

  it("105-S3: an end before the start is refused, also across days", () => {
    expect(errorsOf({ ...valid, endDate: "2026-11-13" })).toEqual({ endTime: "The end must be after the start." });
    expect(errorsOf({ ...valid, endDate: "2026-11-14", endTime: "07:59" })).toEqual({ endTime: "The end must be after the start." });
  });

  it("105-S3: one minute later is accepted, and so is a period over midnight", () => {
    expect(parseUnavailabilityInput({ ...valid, endDate: "2026-11-14", endTime: "08:01" }).ok).toBe(true);
    expect(parseUnavailabilityInput({ ...valid, startTime: "23:00", endDate: "2026-11-15", endTime: "01:00" }).ok).toBe(true);
  });

  it("105-S3: malformed and impossible dates and times are refused field by field", () => {
    expect(errorsOf({ ...valid, startDate: "14/11/2026" })).toEqual({ startDate: "Enter the start date as YYYY-MM-DD." });
    expect(errorsOf({ ...valid, endTime: "25:00" })).toEqual({ endTime: "Enter the end time as HH:MM." });
    expect(errorsOf({ ...valid, startDate: "2026-02-31" })).toEqual({ startDate: "Enter a valid start date." });
    expect(errorsOf({ ...valid, endDate: "2026-02-31" })).toEqual({ endDate: "Enter a valid end date." });
  });

  it("105-S3: a body that is not an object reports every field", () => {
    expect(Object.keys(errorsOf(null)!).sort()).toEqual(["endDate", "endTime", "reason", "startDate", "startTime"]);
    expect(Object.keys(errorsOf("nope")!).sort()).toEqual(["endDate", "endTime", "reason", "startDate", "startTime"]);
  });
});

describe("SCRUM-105/AC4 formatShortSgt and unavailableMessage (105-S4)", () => {
  it("105-S4: 14 Nov 08:00 and 16 Nov 18:00, the Jira example", () => {
    expect(formatShortSgt(sgtToUtc("2026-11-14", "08:00"))).toBe("14 Nov 08:00");
    expect(formatShortSgt(sgtToUtc("2026-11-16", "18:00"))).toBe("16 Nov 18:00");
    expect(unavailableMessage("Orchid Hall", sgtToUtc("2026-11-14", "08:00"), sgtToUtc("2026-11-16", "18:00"))).toBe(
      "Orchid Hall is unavailable from 14 Nov 08:00 to 16 Nov 18:00",
    );
  });

  it("105-S4: the day has no leading zero and the time is Singapore time (UTC+8)", () => {
    expect(formatShortSgt(new Date("2026-12-01T16:30:00Z"))).toBe("2 Dec 00:30");
    expect(formatShortSgt(new Date("2026-01-09T03:05:00Z"))).toBe("9 Jan 11:05");
  });

  it("105-S4: the message never carries the reason or notes", () => {
    const message = unavailableMessage("Orchid Hall", sgtToUtc("2026-11-14", "08:00"), sgtToUtc("2026-11-16", "18:00"));
    for (const label of Object.values(UNAVAILABILITY_REASON_LABELS)) expect(message).not.toContain(label);
  });
});

describe("SCRUM-105/AC1 reasons and labels (105-S1)", () => {
  it("105-S1: five selectable reasons in the Jira order, plus internal_activity that is only readable", () => {
    expect(SELECTABLE_UNAVAILABILITY_REASONS).toEqual(["maintenance", "equipment_failure", "renovation", "safety", "other"]);
    expect(UNAVAILABILITY_REASONS).toEqual([...SELECTABLE_UNAVAILABILITY_REASONS, "internal_activity"]);
    expect(isSelectableUnavailabilityReason("internal_activity")).toBe(false);
    expect(isUnavailabilityReason("internal_activity")).toBe(true);
    expect(isUnavailabilityReason("nope")).toBe(false);
    expect(isSelectableUnavailabilityReason(undefined)).toBe(false);
  });

  it("105-S1: labels, with safety shown as Safety concern", () => {
    expect(UNAVAILABILITY_REASON_LABELS).toEqual({
      maintenance: "Maintenance",
      equipment_failure: "Equipment failure",
      renovation: "Renovation",
      safety: "Safety concern",
      other: "Other",
      internal_activity: "Internal activity",
    });
    expect(unavailabilityReasonLabel("safety")).toBe("Safety concern");
    expect(unavailabilityReasonLabel("nope")).toBeUndefined();
  });
});

describe("SCRUM-105/AC6 canMarkVenueUnavailable (105-S6)", () => {
  it("105-S6: only venue staff", () => {
    expect(canMarkVenueUnavailable("venue_staff")).toBe(true);
    expect(canMarkVenueUnavailable("event_coordinator")).toBe(false);
    expect(canMarkVenueUnavailable("event_organiser")).toBe(false);
    expect(canMarkVenueUnavailable(undefined)).toBe(false);
  });
});
