import { describe, expect, it } from "vitest";
import { REGISTRATION_CAPACITY_MAX, parseRegistrationSettings } from "../src/registrationSettings";

// SCRUM-185/AC4 (docs/specs/registration-settings-while-replanning.md): the coordinator's registration settings, validated the way
// the event request form does (SCRUM-49), shared by event-service and apps/web.
const START = "2031-11-14T01:00:00.000Z";
const GOOD = { registration_capacity: 40, registration_opens_at: "2031-10-01T01:00:00.000Z", registration_closes_at: "2031-11-13T01:00:00.000Z" };

describe("SCRUM-185/AC4 185-S4b parseRegistrationSettings accepts good settings", () => {
  it("185-S4b: returns the capacity as a whole number and both times as UTC instants", () => {
    expect(parseRegistrationSettings(GOOD, START)).toEqual({ ok: true, data: GOOD });
  });

  it("185-S4b: accepts a capacity typed as digits, and times with an offset", () => {
    const result = parseRegistrationSettings(
      { registration_capacity: "40", registration_opens_at: "2031-10-01T09:00:00+08:00", registration_closes_at: "2031-11-13T09:00:00+08:00" },
      START,
    );
    expect(result).toEqual({ ok: true, data: GOOD });
  });

  it("185-S4b: allows times in the past, which is how a coordinator closes registration early", () => {
    const past = { registration_capacity: 10, registration_opens_at: "2020-01-01T00:00:00.000Z", registration_closes_at: "2020-02-01T00:00:00.000Z" };
    expect(parseRegistrationSettings(past, START).ok).toBe(true);
  });

  it("185-S4b: a closing time exactly at the event's start is allowed", () => {
    expect(parseRegistrationSettings({ ...GOOD, registration_closes_at: START }, START).ok).toBe(true);
  });

  it("185-S4b: with no known start there is nothing to compare the closing time with", () => {
    expect(parseRegistrationSettings({ ...GOOD, registration_closes_at: "2040-01-01T00:00:00.000Z" }, null).ok).toBe(true);
  });

  it("185-S4b: accepts the start as a Date", () => {
    expect(parseRegistrationSettings(GOOD, new Date(START)).ok).toBe(true);
  });

  it("185-S4b: the largest capacity is allowed", () => {
    expect(parseRegistrationSettings({ ...GOOD, registration_capacity: REGISTRATION_CAPACITY_MAX }, START).ok).toBe(true);
  });
});

describe("SCRUM-185/AC4 185-S4d parseRegistrationSettings refuses bad settings, one message per field", () => {
  const fieldErrors = (body: unknown) => {
    const result = parseRegistrationSettings(body, START);
    if (result.ok) throw new Error("expected a refusal");
    return result.fieldErrors;
  };

  it.each([
    ["missing", undefined, "Enter the registration capacity."],
    ["blank", "  ", "Enter the registration capacity."],
    ["not a number", "many", "Enter a whole number of 1 or more."],
    ["zero", 0, "Enter a whole number of 1 or more."],
    ["negative", -3, "Enter a whole number of 1 or more."],
    ["fractional", 2.5, "Enter a whole number of 1 or more."],
    ["too large", REGISTRATION_CAPACITY_MAX + 1, `The capacity can't be more than ${REGISTRATION_CAPACITY_MAX}.`],
  ])("185-S4d: a capacity that is %s", (_label, value, message) => {
    expect(fieldErrors({ ...GOOD, registration_capacity: value })).toEqual({ registration_capacity: message });
  });

  it.each([
    ["registration_opens_at", "opening", undefined, "Enter the registration opening date and time."],
    ["registration_opens_at", "opening", "soon", "Enter a valid opening date and time."],
    ["registration_closes_at", "closing", undefined, "Enter the registration closing date and time."],
    ["registration_closes_at", "closing", "2031-02-31T00:00:00Z", "Enter a valid closing date and time."],
  ])("185-S4d: %s that is %s and wrong", (field, _label, value, message) => {
    expect(fieldErrors({ ...GOOD, [field]: value })).toEqual({ [field]: message });
  });

  it("185-S4d: a closing time that is not after the opening time", () => {
    expect(fieldErrors({ ...GOOD, registration_closes_at: GOOD.registration_opens_at })).toEqual({ registration_closes_at: "Registration must close after it opens." });
    expect(fieldErrors({ ...GOOD, registration_closes_at: "2031-09-01T00:00:00.000Z" })).toEqual({ registration_closes_at: "Registration must close after it opens." });
  });

  it("185-S4d: a closing time after the event starts", () => {
    expect(fieldErrors({ ...GOOD, registration_closes_at: "2031-11-14T01:00:00.001Z" })).toEqual({ registration_closes_at: "Registration must close by the event start." });
  });

  it("185-S4d: every bad field is reported at once", () => {
    expect(fieldErrors({ registration_capacity: 0, registration_opens_at: "x", registration_closes_at: "y" })).toEqual({
      registration_capacity: "Enter a whole number of 1 or more.",
      registration_opens_at: "Enter a valid opening date and time.",
      registration_closes_at: "Enter a valid closing date and time.",
    });
  });

  it.each([null, undefined, 5, "text", [1, 2]])("185-S4d: a body that is %j is refused as a whole", (body) => {
    expect(fieldErrors(body)).toEqual({ body: "Send the settings as an object." });
  });

  it("185-S4d: a time that is not text is not a valid time", () => {
    expect(fieldErrors({ ...GOOD, registration_opens_at: 1_700_000_000_000 })).toEqual({ registration_opens_at: "Enter a valid opening date and time." });
  });

  it("185-S4d: a capacity that is not a number or a string is refused", () => {
    expect(fieldErrors({ ...GOOD, registration_capacity: true })).toEqual({ registration_capacity: "Enter a whole number of 1 or more." });
  });

  it("185-S4d: a time that is a real instant but is not written as a date first is still understood", () => {
    const result = parseRegistrationSettings({ ...GOOD, registration_opens_at: "Oct 1 2031 01:00:00 UTC" }, START);
    expect(result).toEqual({ ok: true, data: GOOD });
  });

  it("185-S4d: an event start that is not a date is not compared with", () => {
    expect(parseRegistrationSettings({ ...GOOD, registration_closes_at: "2040-01-01T00:00:00.000Z" }, "garbage").ok).toBe(true);
  });

  it("185-S4d: fields that are not settings are dropped", () => {
    const result = parseRegistrationSettings({ ...GOOD, status: "cancelled", name: "x" }, START);
    expect(result).toEqual({ ok: true, data: GOOD });
  });
});

// Cases mutation testing found no test for (SCRUM-187/AC3, docs/testing/mutation-testing.md).
describe("SCRUM-185/AC4 185-S4b the smallest capacity", () => {
  it("185-S4b: a capacity of 1 is allowed", () => {
    expect(parseRegistrationSettings({ ...GOOD, registration_capacity: 1 }, START).ok).toBe(true);
  });
});

// More cases mutation testing found no test for (SCRUM-187/AC3, docs/testing/mutation-testing.md).
describe("SCRUM-185/AC4 185-S4d settings that are empty, or only partly valid", () => {
  it.each([["null", null], ["empty", ""]])("185-S4d: %s times are asked for", (_label, value) => {
    expect(parseRegistrationSettings({ ...GOOD, registration_opens_at: value, registration_closes_at: value }, START)).toEqual({
      ok: false,
      fieldErrors: {
        registration_opens_at: "Enter the registration opening date and time.",
        registration_closes_at: "Enter the registration closing date and time.",
      },
    });
  });

  it("185-S4d: a null capacity is asked for", () => {
    expect(parseRegistrationSettings({ ...GOOD, registration_capacity: null }, START)).toEqual({
      ok: false,
      fieldErrors: { registration_capacity: "Enter the registration capacity." },
    });
  });

  it("185-S4d: a bad opening time is not reported again against a closing time that is fine by itself", () => {
    const body = { ...GOOD, registration_opens_at: "soon", registration_closes_at: "2031-12-01T00:00:00.000Z" };
    expect(parseRegistrationSettings(body, START)).toEqual({
      ok: false,
      fieldErrors: { registration_opens_at: "Enter a valid opening date and time." },
    });
  });
});
