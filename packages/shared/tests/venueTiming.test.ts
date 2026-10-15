import { describe, expect, it } from "vitest";
import { canEditVenueTiming, parseVenueTimingInput } from "../src/venueTiming";

describe("SCRUM-101/AC1 parseVenueTimingInput accepts whole minutes (101-S1)", () => {
  it("101-S1: reads numbers and numeric strings", () => {
    expect(parseVenueTimingInput({ setupMinutes: 30, turnaroundMinutes: 45 })).toEqual({
      ok: true,
      data: { setupMinutes: 30, turnaroundMinutes: 45 },
    });
    expect(parseVenueTimingInput({ setupMinutes: " 30 ", turnaroundMinutes: "45" })).toMatchObject({
      ok: true,
      data: { setupMinutes: 30, turnaroundMinutes: 45 },
    });
  });

  it("101-S1: zero is allowed", () => {
    expect(parseVenueTimingInput({ setupMinutes: "0", turnaroundMinutes: 0 })).toMatchObject({ ok: true });
  });
});

describe("SCRUM-101/AC3 parseVenueTimingInput rejects invalid values (101-S3)", () => {
  const errorsOf = (body: unknown) => {
    const r = parseVenueTimingInput(body);
    return r.ok ? undefined : r.fieldErrors;
  };

  it("101-S3: rejects a negative value", () => {
    expect(errorsOf({ setupMinutes: -15, turnaroundMinutes: 45 })).toEqual({
      setupMinutes: "Setup time must be a whole number of minutes, 0 or more.",
    });
  });

  it("101-S3: rejects a value that is not a whole number", () => {
    expect(errorsOf({ setupMinutes: 30, turnaroundMinutes: "12.5" })).toEqual({
      turnaroundMinutes: "Turnaround time must be a whole number of minutes, 0 or more.",
    });
  });

  it("101-S3: rejects text, blank and missing values, reporting both fields together", () => {
    expect(Object.keys(errorsOf({ setupMinutes: "abc", turnaroundMinutes: "" })!)).toEqual(["setupMinutes", "turnaroundMinutes"]);
    expect(Object.keys(errorsOf({})!)).toEqual(["setupMinutes", "turnaroundMinutes"]);
    expect(Object.keys(errorsOf(null)!)).toEqual(["setupMinutes", "turnaroundMinutes"]);
  });

  it("101-S3: rejects more than a day", () => {
    expect(errorsOf({ setupMinutes: 1441, turnaroundMinutes: 0 })).toHaveProperty("setupMinutes");
    expect(parseVenueTimingInput({ setupMinutes: 1440, turnaroundMinutes: 0 }).ok).toBe(true);
  });
});

describe("SCRUM-101/AC4 canEditVenueTiming (101-S4)", () => {
  it("101-S4: only venue staff may edit", () => {
    expect(canEditVenueTiming("venue_staff")).toBe(true);
    expect(canEditVenueTiming("event_coordinator")).toBe(false);
    expect(canEditVenueTiming("event_organiser")).toBe(false);
  });
});
