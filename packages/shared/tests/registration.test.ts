import { describe, expect, it } from "vitest";
import { receivesEventUpdates, validateVipEmail } from "../src/registration";

// ----------------------------------------------------------------------------
// SCRUM-73 — Withdraw from an event: who gets an event's updates and reminders. notification-service doesn't send
// any yet; this is the rule it uses to pick an event's recipients when it does
// ----------------------------------------------------------------------------

describe("SCRUM-73/AC7 event updates and reminders", () => {
  // AC7: after withdrawing, the attendee must not receive any further updates or reminders for that registration
  it("SCRUM-73/AC7 sends no event updates or reminders for a Withdrawn registration", () => {
    expect(receivesEventUpdates("withdrawn")).toBe(false);
  });

  // AC7: only the withdrawn registration stops them: an active (Pending or Confirmed) one still gets them
  it("SCRUM-73/AC7 sends event updates and reminders for a Pending or Confirmed registration", () => {
    expect(receivesEventUpdates("pending")).toBe(true);
    expect(receivesEventUpdates("confirmed")).toBe(true);
  });
});

// More cases mutation testing found no test for (SCRUM-187/AC3, docs/testing/mutation-testing.md).
describe("SCRUM-170 validateVipEmail", () => {
  it("SCRUM-170: a bad email gets the same message as the registration form", () => {
    expect(validateVipEmail("not an email")).toEqual({ ok: false, error: "Enter a valid email address." });
  });
});
