import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AWAITING_OUTCOME, EventReviewOutcome } from "@/components/EventReviewOutcome";
import type { ReviewDecision } from "@/lib/events";

const APPROVED: ReviewDecision = { outcome: "approved", decided_at: "2026-09-02T03:00:00Z", reason: null, decided_by_name: "Rachel Tan" };
const REJECTED: ReviewDecision = { outcome: "rejected", decided_at: "2026-09-02T03:00:00Z", reason: "Venue too small.", decided_by_name: "Rachel Tan" };

describe("SCRUM-44 — review outcome card", () => {
  it("AC1, AC4: shows an approval with when (Singapore time) and by whom", () => {
    render(<EventReviewOutcome decision={APPROVED} showAwaiting />);

    expect(screen.getByText("Approved").getAttribute("data-tone")).toBe("success");
    expect(screen.getByText(/2 Sept? 2026, 11:00 am · by Rachel Tan/)).toBeTruthy();
    expect(screen.queryByText("Reason for rejection")).toBeNull();
  });

  it("AC2, AC3: shows a rejection and the coordinator's reason", () => {
    render(<EventReviewOutcome decision={REJECTED} showAwaiting />);

    expect(screen.getByText("Rejected").getAttribute("data-tone")).toBe("danger");
    expect(screen.getByRole("heading", { name: "Reason for rejection" })).toBeTruthy();
    expect(screen.getByText("Venue too small.")).toBeTruthy();
  });

  it("AC4: labels an approval's optional reason as comments", () => {
    render(<EventReviewOutcome decision={{ ...APPROVED, reason: "Please confirm catering by Friday." }} showAwaiting={false} />);

    expect(screen.getByRole("heading", { name: "Coordinator's comments" })).toBeTruthy();
    expect(screen.getByText("Please confirm catering by Friday.")).toBeTruthy();
  });

  it("AC4: leaves out the name when the decider is unknown", () => {
    render(<EventReviewOutcome decision={{ ...APPROVED, decided_by_name: null }} showAwaiting={false} />);

    expect(screen.queryByText(/· by/)).toBeNull();
  });

  it("AC5: says the request is still being reviewed, without an Approved or Rejected badge", () => {
    render(<EventReviewOutcome decision={null} showAwaiting />);

    expect(screen.getByRole("status").textContent).toBe(AWAITING_OUTCOME);
    expect(screen.queryByText("Approved")).toBeNull();
    expect(screen.queryByText("Rejected")).toBeNull();
  });

  it("renders nothing when there's no decision and no note to show", () => {
    const { container } = render(<EventReviewOutcome decision={null} showAwaiting={false} />);

    expect(container.innerHTML).toBe("");
  });
});
