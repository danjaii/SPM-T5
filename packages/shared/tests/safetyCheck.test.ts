import { describe, expect, it } from "vitest";
import { canProceedToPreparation, safetyDecisionProblem } from "../src/safetyCheck";

// SCRUM-99 (docs/specs/operational-safety-check.md): the Operational Safety Check rules shared by apps/web and event-service.

describe("SCRUM-99/AC4 choose a review outcome", () => {
  it.each([
    ["approved", undefined],
    ["rejected", undefined],
    ["changes_requested", undefined],
    ["maybe", "Choose Approve, Reject or Request Changes."],
    [undefined, "Choose Approve, Reject or Request Changes."],
  ])("SCRUM-99/AC4 decision %s gives problem %s", (decision, problem) => {
    expect(safetyDecisionProblem({ decision, reason: "Fire exits checked." })).toBe(problem);
  });
});

describe("SCRUM-99/AC6 reject an event", () => {
  it.each([undefined, "", "   "])("SCRUM-99/AC6 refuses a rejection whose reason is %j", (reason) => {
    expect(safetyDecisionProblem({ decision: "rejected", reason })).toBe("Give a reason for rejecting this event.");
  });
});

// Spec decision: Request Changes must say what to change; Approve comments are optional.
describe("SCRUM-99/AC4 + AC8 comments on the other outcomes", () => {
  it("SCRUM-99/AC4 refuses Request Changes without a comment", () => {
    expect(safetyDecisionProblem({ decision: "changes_requested", reason: " " })).toBe("Say what needs to change.");
  });

  it("SCRUM-99/AC5 accepts Approve without a comment", () => {
    expect(safetyDecisionProblem({ decision: "approved", reason: undefined })).toBeUndefined();
  });
});

describe("SCRUM-99/AC5 + AC7 only a Safety Approved event proceeds to preparation", () => {
  it.each([
    ["approved", true],
    ["rejected", false],
    ["changes_requested", false],
    [null, false], // no safety check yet
  ])("SCRUM-99/AC7 latest decision %s lets the event proceed: %s", (latest, proceeds) => {
    expect(canProceedToPreparation(latest)).toBe(proceeds);
  });
});
