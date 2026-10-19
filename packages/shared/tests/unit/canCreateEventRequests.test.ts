import { describe, expect, it } from "vitest";
import { canCreateEventRequests } from "../../src/roles";

// SCRUM-49/AC7: only event organisers create event requests
describe("SCRUM-49/AC7 canCreateEventRequests", () => {
  it("allows event organisers", () => {
    expect(canCreateEventRequests("event_organiser")).toBe(true);
  });

  it.each([
      "event_coordinator",
      "event_coordinator_lead",
      "venue_staff",
      "technical_support_staff",
      "safety_officer",
      "attendee",
    ] as const)(
    "refuses %s",
    (role) => {
      expect(canCreateEventRequests(role)).toBe(false);
    },
  );
});
