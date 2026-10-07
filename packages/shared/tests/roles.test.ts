import { describe, it, expect } from "vitest";
import { canReviewEvents, isInternalRole, responsibilitiesFor, ROLES, type Role } from "../src/roles";

describe("canReviewEvents", () => {
  it("only allows event coordinators to review", () => {
    expect(canReviewEvents("event_coordinator")).toBe(true);
    expect(canReviewEvents("attendee")).toBe(false);
  });
});

// SCRUM-69 (docs/specs/user-profile.md): the internal roles are the staff who work inside ConnectSphere, as in the roles table in CLAUDE.md.
describe("SCRUM-69 isInternalRole", () => {
  // The customer's week 7 changes add two internal roles: the Event Coordinator Lead and the Safety Officer.
  const INTERNAL = ["event_coordinator", "event_coordinator_lead", "venue_staff", "technical_support_staff", "safety_officer"];

  // Every role comes from the shared ROLES list, so a role added later makes this test ask the question about it too.
  it.each(ROLES)("69-S1: says whether %s is an internal role", (role) => {
    expect(isInternalRole(role)).toBe(INTERNAL.includes(role));
  });

  // The two new roles must exist in the shared role list, and be internal.
  it.each(["event_coordinator_lead", "safety_officer"])("69-S1: %s is a role, and an internal one", (role) => {
    expect(ROLES as readonly string[]).toContain(role);
    expect(isInternalRole(role as Role)).toBe(true);
  });
  // end of isInternalRole
});

// SCRUM-69: what each internal role is responsible for, as the profile page lists it. The wording follows the "Main Responsibility"
// table and the event planning process in the Week 1 Customer Briefing, and the customer's week 7 changes (the Lead now assigns
// coordinators; the Safety Officer checks safety after the venue and technical arrangements are confirmed).
describe("SCRUM-69 responsibilitiesFor", () => {
  it.each([
    [
      "event_coordinator",
      [
        "Act as the main internal point of contact for the events assigned to them",
        "Review event requests, ask for clarification or amendments, and approve or reject them",
        "Search for venues and submit venue booking requests",
        "Monitor the outstanding arrangements and confirm the event",
        "Review the changes an Event Organiser requests",
      ],
    ],
    [
      "event_coordinator_lead",
      [
        "Oversee the incoming event requests waiting to be assigned",
        "Review basic event information and assign a suitable Event Coordinator",
        "Reassign events where necessary",
        "View all coordinator assignments and the active events under their supervision",
      ],
    ],
    [
      "venue_staff",
      [
        "Maintain the venue catalogue and the layouts each venue supports",
        "Mark venues unavailable (maintenance, renovation, safety or other operational reasons)",
        "Approve or reject venue booking requests, with a reason or an alternative",
        "Prepare venues for events",
      ],
    ],
    [
      "technical_support_staff",
      [
        "Maintain the equipment catalogue and its operational status",
        "Check whether enough suitable equipment is available for an event's date and time",
        "Reserve equipment for events",
        "Provide technical support for events, where assigned",
      ],
    ],
    [
      "safety_officer",
      [
        "Review the operational safety of planned events once the venue and technical arrangements are confirmed",
        "Consider attendance, venue capacity and layout, emergency access, accessibility, equipment placement, crowd movement and venue restrictions",
        "Approve the event, reject the safety arrangement, or request changes",
      ],
    ],
  ])("69-S2: lists the responsibilities of a %s", (role, expected) => {
    expect(responsibilitiesFor(role as Role)).toEqual(expected);
  });

  // Event Organisers and Attendees are external: they have no list of responsibilities to show.
  it.each(["event_organiser", "attendee"])("69-S3: lists no responsibilities for a %s", (role) => {
    expect(responsibilitiesFor(role as Role)).toEqual([]);
  });
  // end of internal responsibilities
});
