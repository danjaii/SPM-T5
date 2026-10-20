import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusStepper } from "@/components/event/StatusStepper";
import { STEPPER_STAGES, buildSteps } from "@/lib/eventStepper";
import { EVENT_STATUS_DISPLAY } from "@/lib/status";
import { EVENT_STATUSES } from "@spm-t5/shared";

const stepper = (status: string, hasCoordinator = false, previousStatus?: string | null) => {
  render(<StatusStepper status={status} hasCoordinator={hasCoordinator} previousStatus={previousStatus} />);
  return within(screen.getByRole("list", { name: "Event progress" })).getAllByRole("listitem");
};
const states = (status: string, hasCoordinator = false, previousStatus?: string | null) => buildSteps(status, hasCoordinator, previousStatus).map((s) => s.state);

describe("SCRUM-127/AC1 stepper stages", () => {
  it("shows the eight stages in order", () => {
    const items = stepper("planning");
    expect(items.map((li) => li.textContent?.replace(/ \((done|current|stopped here)\)/, "").replace(/^\d+/, ""))).toEqual([...STEPPER_STAGES]);
  });

  it("highlights the current step and marks earlier ones done, in text as well as style", () => {
    const items = stepper("planning");
    expect(items[4]!.getAttribute("aria-current")).toBe("step");
    expect(items[4]!.textContent).toContain("(current)");
    expect(items[0]!.textContent).toContain("(done)");
    expect(items[3]!.textContent).toContain("(done)");
    expect(items[5]!.textContent).not.toMatch(/done|current/);
  });

  it.each([
    ["draft", false, 0], ["submitted", false, 1], ["submitted", true, 2], ["under_review", true, 3], ["returned", true, 3],
    ["planning", true, 4], ["awaiting_arrangements", true, 5], ["confirmed", true, 6], ["completed", true, 7],
  ])("puts %s (coordinator: %s) on step %i", (status, hasCoordinator, index) => {
    expect(states(status, hasCoordinator).indexOf("current")).toBe(index);
  });

  it("shows an approved event as review finished and planning not started", () => {
    expect(states("approved", true)).toEqual(["done", "done", "done", "done", "upcoming", "upcoming", "upcoming", "upcoming"]);
  });
});

describe("SCRUM-127/AC2 returned, rejected and cancelled", () => {
  it("shows Changes requested as a badge on Under review for a returned event", () => {
    const items = stepper("returned", true);
    expect(within(items[3]!).getByText("Changes requested")).toBeTruthy();
    expect(within(items[3]!).getByTestId("status-icon")).toBeTruthy();
    expect(items[3]!.getAttribute("aria-current")).toBe("step");
  });

  it("shows a rejected event's badge on Under review", () => {
    const items = stepper("rejected", true, "under_review");
    expect(within(items[3]!).getByText("Rejected")).toBeTruthy();
    expect(items[3]!.textContent).toContain("(stopped here)");
  });

  it.each([["draft", 0], ["planning", 4], ["awaiting_arrangements", 5], ["confirmed", 6]])("puts a cancelled event's badge on the step it was at (%s)", (previous, index) => {
    const items = stepper("cancelled", true, previous);
    expect(within(items[index]!).getByText("Cancelled")).toBeTruthy();
    expect(items.filter((li) => li.textContent?.includes("Cancelled"))).toHaveLength(1);
  });

  it("falls back to Under review for a rejection and Submitted for a cancellation with no history", () => {
    expect(states("rejected").indexOf("stopped")).toBe(3);
    expect(states("cancelled").indexOf("stopped")).toBe(1);
  });

  it("leaves earlier steps done and later ones upcoming around the stop", () => {
    expect(states("cancelled", true, "planning")).toEqual(["done", "done", "done", "done", "stopped", "upcoming", "upcoming", "upcoming"]);
  });
});

describe("SCRUM-127/AC1,AC3 status mapping", () => {
  it("gives every event status a stage or a stop, and an icon-and-label display", () => {
    for (const status of EVENT_STATUSES) {
      expect(EVENT_STATUS_DISPLAY[status].label).toBeTruthy();
      const found = states(status, true, "submitted").some((s) => s !== "upcoming");
      expect(found, status).toBe(true);
    }
  });

  it("shows no highlighted step for a status the stepper does not know", () => {
    expect(states("mystery")).toEqual(Array(8).fill("upcoming"));
  });
});
