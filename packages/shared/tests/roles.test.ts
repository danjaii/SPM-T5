import { describe, it, expect } from "vitest";
import { canReviewEvents, isInternalRole, isLead, ROLES, type Role } from "../src/roles";

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

// ---------------------------------------------------------------------------
// SCRUM-75 — Event Coordinator Lead role (docs/specs/event-coordinator-lead-role.md)
// ---------------------------------------------------------------------------
describe("SCRUM-75 Event Coordinator Lead role", () => {
  // AC1: the Lead is its own role, separate from the Event Coordinator and every other role
  it("SCRUM-75/AC1 has an Event Coordinator Lead role in the shared role list", () => {
    expect(ROLES as readonly string[]).toContain("event_coordinator_lead");
  });

  it.each(ROLES)("SCRUM-75/AC1 only the Lead role is a Lead (%s)", (role) => {
    expect(isLead(role)).toBe(role === "event_coordinator_lead");
  });

  it("SCRUM-75/AC1 a Lead is not an Event Coordinator: it gets none of the coordinator's review rights", () => {
    expect(canReviewEvents("event_coordinator_lead")).toBe(false);
  });

  it.each([undefined, null, "", "lead", "Event Coordinator Lead"])("SCRUM-75/AC7 anything that is not the Lead role is not a Lead (%s)", (value) => {
    expect(isLead(value)).toBe(false);
  });
  // end of AC1
});
// end of SCRUM-75
