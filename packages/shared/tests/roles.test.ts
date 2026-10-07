import { describe, it, expect } from "vitest";
import { canReviewEvents, isInternalRole, ROLES, type Role } from "../src/roles";

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
