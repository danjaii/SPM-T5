import { describe, it, expect } from "vitest";
import { canReviewEvents } from "../src/roles";

describe("canReviewEvents", () => {
  it("only allows event coordinators to review", () => {
    expect(canReviewEvents("event_coordinator")).toBe(true);
    expect(canReviewEvents("attendee")).toBe(false);
  });
});
