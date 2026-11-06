import { describe, expect, it } from "vitest";
import { canRequestVenueBookings } from "../../src/roles";

// SCRUM-130: the venue calendar's New booking is for Event Coordinators, who request venues for the events assigned to them (SCRUM-32)
describe("SCRUM-130 canRequestVenueBookings", () => {
  it("allows event_coordinator", () => {
    expect(canRequestVenueBookings("event_coordinator")).toBe(true);
  });

  it.each(["venue_staff", "technical_support_staff", "event_coordinator_lead", "event_organiser", "attendee", "safety_officer"] as const)("refuses %s", (role) => {
    expect(canRequestVenueBookings(role)).toBe(false);
  });
});
