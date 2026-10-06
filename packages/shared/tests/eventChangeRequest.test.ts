import { describe, expect, it } from "vitest";
import { EVENT_STATUSES, canRequestChange, parseEventChangeRequestInput, sgtToUtc } from "../src";

const NOW = new Date("2026-10-06T02:00:00.000Z"); // 10:00 on 2026-10-06 in Singapore
const current = {
  expected_attendance: 100,
  preferred_start_datetime: sgtToUtc("2026-11-14", "09:00").toISOString(),
  preferred_end_datetime: sgtToUtc("2026-11-14", "17:00").toISOString(),
  equipment_requirements_notes: "Two projectors",
};
const parse = (body: unknown) => parseEventChangeRequestInput(body, current, NOW);
const errorsOf = (body: unknown) => {
  const result = parse(body);
  if (result.ok) throw new Error("expected a refusal");
  return result.fieldErrors;
};

describe("SCRUM-66/AC1 canRequestChange allows a submitted event", () => {
  it.each(["submitted", "under_review", "returned", "approved", "planning", "awaiting_arrangements", "confirmed"])(
    "allows %s",
    (status) => expect(canRequestChange(status)).toBe(true),
  );
});

describe("SCRUM-66/AC2 and AC3 canRequestChange refuses draft, cancelled, rejected and completed", () => {
  it.each(["draft", "cancelled", "rejected", "completed"])("refuses %s", (status) =>
    expect(canRequestChange(status)).toBe(false),
  );

  it("refuses an unknown status, and every status is either allowed or one of the four", () => {
    expect(canRequestChange("nonsense")).toBe(false);
    expect(EVENT_STATUSES.filter((s) => !canRequestChange(s)).sort()).toEqual(["cancelled", "completed", "draft", "rejected"]);
  });
});

describe("SCRUM-66/AC4 no detail changed", () => {
  it("reports no changes for an empty body", () => {
    expect(parse({})).toEqual({ ok: false, noChanges: true, fieldErrors: {} });
  });

  it("reports no changes when every field equals the current event", () => {
    const result = parse({
      expectedAttendance: 100,
      date: "2026-11-14",
      endDate: "2026-11-14",
      startTime: "09:00",
      endTime: "17:00",
      equipmentRequirements: "  Two projectors ",
      venueRequirements: "",
    });
    expect(result).toEqual({ ok: false, noChanges: true, fieldErrors: {} });
  });
});

describe("SCRUM-66/AC5 expected attendance must be a positive whole number", () => {
  it.each([0, -5, 2.5, "abc", "", "1.5", "-3", Number.NaN, Infinity, true])("refuses %s", (value) => {
    expect(errorsOf({ expectedAttendance: value }).expectedAttendance).toMatch(/positive whole number/);
  });

  it.each([150, "150"])("accepts %s", (value) => {
    const result = parse({ expectedAttendance: value });
    expect(result.ok && result.data.proposed_changes.expected_attendance).toEqual({ from: 100, to: 150 });
  });
});

describe("SCRUM-66/AC6 a valid request produces only the proposed differences", () => {
  it("returns just the changed fields and an automatic description", () => {
    const result = parse({ expectedAttendance: 120, startTime: "10:00", date: "2026-11-14", endTime: "17:00" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.data.proposed_changes).sort()).toEqual(["expected_attendance", "preferred_start_datetime"]);
    expect(result.data.proposed_changes.preferred_start_datetime?.to).toBe(sgtToUtc("2026-11-14", "10:00").toISOString());
    expect(result.data.change_description).toBe("Changed: expected attendance, start time");
  });

  it("uses the organiser's reason as the description when given", () => {
    const result = parse({ expectedAttendance: 120, reason: "  More sign-ups  " });
    expect(result.ok && result.data.change_description).toBe("More sign-ups");
  });
});

describe("SCRUM-66/AC8 editable fields", () => {
  it("accepts changed venue and equipment requirements", () => {
    const result = parse({ venueRequirements: "Step-free access", equipmentRequirements: "Three projectors" });
    expect(result.ok && result.data.proposed_changes).toEqual({
      venue_requirements: { from: null, to: "Step-free access" },
      equipment_requirements_notes: { from: "Two projectors", to: "Three projectors" },
    });
  });

  it("accepts a changed date, moving the end with it", () => {
    const result = parse({ date: "2026-12-01", startTime: "09:00", endTime: "17:00" });
    expect(result.ok && result.data.proposed_changes.preferred_end_datetime?.to).toBe(sgtToUtc("2026-12-01", "17:00").toISOString());
  });

  it("refuses requirements text over 2000 characters", () => {
    expect(errorsOf({ venueRequirements: "x".repeat(2001) }).venueRequirements).toMatch(/2000/);
  });
});

describe("SCRUM-66/AC9 a past date is not allowed", () => {
  it("refuses yesterday", () => {
    expect(errorsOf({ date: "2026-10-05", startTime: "09:00", endTime: "17:00" }).date).toMatch(/past/);
  });

  it("refuses an earlier time today", () => {
    expect(errorsOf({ date: "2026-10-06", startTime: "08:00", endTime: "17:00" }).startTime).toMatch(/past/);
  });

  it("allows a later time today", () => {
    expect(parse({ date: "2026-10-06", startTime: "11:00", endTime: "17:00" }).ok).toBe(true);
  });

  it("refuses a malformed date", () => {
    expect(errorsOf({ date: "14/11/2026" }).date).toMatch(/YYYY-MM-DD/);
  });
});

describe("SCRUM-66/AC10 end time before start time is not allowed", () => {
  it("refuses an end before the start", () => {
    expect(errorsOf({ startTime: "15:00", endTime: "10:00" }).endTime).toMatch(/after the start/);
  });

  it("refuses an end equal to the start", () => {
    expect(errorsOf({ startTime: "10:00", endTime: "10:00" }).endTime).toMatch(/after the start/);
  });

  it("refuses a start moved past the existing end", () => {
    expect(errorsOf({ startTime: "18:00" }).endTime).toMatch(/after the start/);
  });

  it("asks for the missing parts when the event has no times yet", () => {
    const result = parseEventChangeRequestInput(
      { date: "2026-11-20" },
      { ...current, preferred_start_datetime: null, preferred_end_datetime: null },
      NOW,
    );
    expect(!result.ok && result.fieldErrors).toMatchObject({ startTime: "Enter a start time.", endTime: "Enter an end time." });
  });
});
