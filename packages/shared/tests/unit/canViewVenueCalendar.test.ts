import { describe, expect, it } from "vitest";
import { canViewVenueCalendar } from "../../src/roles";

// SCRUM-84/AC8: the venue availability calendar is for coordinators, venue staff and technical support only
describe("SCRUM-84/AC8 canViewVenueCalendar", () => {
  it.each(["event_coordinator", "venue_staff", "technical_support_staff"] as const)("allows %s", (role) => {
    expect(canViewVenueCalendar(role)).toBe(true);
  });

  it.each(["event_organiser", "attendee", "event_coordinator_lead", "safety_officer"] as const)("refuses %s", (role) => {
    expect(canViewVenueCalendar(role)).toBe(false);
  });
});
