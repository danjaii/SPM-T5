import { describe, expect, it } from "vitest";
import { CLOSED_EVENT_STATUSES, EVENT_STATUSES, canDecideEvent, canStartReview, isClosedEventStatus } from "../src/eventStatus";

describe("SCRUM-24/AC1, AC2 which requests can be approved or rejected", () => {
  it.each(["submitted", "under_review"])("allows a decision on %s", (status) => {
    expect(canDecideEvent(status)).toBe(true);
  });

  it("refuses every other status", () => {
    const others = EVENT_STATUSES.filter((s) => s !== "submitted" && s !== "under_review");
    for (const status of others) expect(canDecideEvent(status)).toBe(false);
  });
});

describe("SCRUM-45/AC3 which requests can start review", () => {
  it("allows only submitted requests", () => {
    expect(EVENT_STATUSES.filter(canStartReview)).toEqual(["submitted"]);
  });
});

// ---------------------------------------------------------------------------
// SCRUM-77 — "closed" events (docs/specs/event-coordinator-lead-role.md, Definitions). Decided with the PO: completed,
// cancelled and rejected are final. Every other status, including draft and returned, is non-closed. This is the one
// definition app code and tests use; migration 21's is_closed_event_status() is pinned to it by leadQueue.test.ts.
// ---------------------------------------------------------------------------
describe("SCRUM-77 closed event statuses", () => {
  it("SCRUM-77/AC5 completed, cancelled and rejected are the closed statuses", () => {
    expect([...CLOSED_EVENT_STATUSES].sort()).toEqual(["cancelled", "completed", "rejected"]);
  });

  it.each(EVENT_STATUSES)("SCRUM-77/AC5 says whether %s is closed", (status) => {
    expect(isClosedEventStatus(status)).toBe(["completed", "cancelled", "rejected"].includes(status));
  });
});
