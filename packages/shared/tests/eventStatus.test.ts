import { describe, expect, it } from "vitest";
import { EVENT_STATUSES, canDecideEvent, canStartReview } from "../src/eventStatus";

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
