import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EVENT_TABS, EventPageSkeleton, stepIndex } from "@/components/event/EventPageSkeleton";

const page = (status: string, attention?: Parameters<typeof EventPageSkeleton>[0]["attention"]) =>
  render(
    <EventPageSkeleton name="Tech Summit" status={status} activeTab="venues" basePath="/events/e1" attention={attention}>
      <p>tab body</p>
    </EventPageSkeleton>,
  );

describe("SCRUM-121/AC1 event page skeleton", () => {
  it("shows the header with the event's status as an icon-and-label badge, and the body", () => {
    page("planning");
    expect(screen.getByRole("heading", { name: "Tech Summit" })).toBeTruthy();
    expect(screen.getByTestId("status-icon")).toBeTruthy();
    expect(screen.getByText("tab body")).toBeTruthy();
  });

  it("has the six tabs, linking to the page and marking the active one", () => {
    page("approved");
    const tabs = within(screen.getByRole("navigation", { name: "Event sections" })).getAllByRole("link");
    expect(tabs.map((t) => t.textContent)).toEqual(["Overview", "Venues", "Equipment", "Safety", "Registrations", "Changes & history"]);
    expect(tabs.map((t) => t.getAttribute("href"))).toEqual(EVENT_TABS.map((t) => `/events/e1?tab=${t.id}`));
    expect(tabs.filter((t) => t.getAttribute("aria-current") === "page").map((t) => t.textContent)).toEqual(["Venues"]);
  });

  it("marks the stepper's done and current steps in text, not by colour alone", () => {
    page("planning");
    const steps = within(screen.getByRole("list", { name: "Event progress" })).getAllByRole("listitem");
    expect(steps).toHaveLength(6);
    expect(steps[0]!.textContent).toContain("(done)");
    expect(steps[2]!.textContent).toContain("(done)");
    expect(steps[3]!.textContent).toContain("(current)");
    expect(steps[3]!.getAttribute("aria-current")).toBe("step");
    expect(steps[4]!.textContent).not.toMatch(/done|current/);
  });

  it.each([
    ["draft", -1], ["submitted", 0], ["under_review", 1], ["returned", 1], ["approved", 2],
    ["planning", 3], ["awaiting_arrangements", 3], ["confirmed", 4], ["completed", 5], ["cancelled", -1], ["rejected", -1],
  ])("puts %s at step %i", (status, index) => {
    expect(stepIndex(status)).toBe(index);
  });

  it("shows the needs-attention banner with its action only when there is something to do", () => {
    const { unmount } = page("submitted", { message: "Reply by 20 Oct", action: { label: "Reply", href: "/events/e1/reply" } });
    expect(screen.getByRole("status").textContent).toContain("Reply by 20 Oct");
    expect(screen.getByRole("link", { name: "Reply" }).getAttribute("href")).toBe("/events/e1/reply");
    unmount();
    page("submitted");
    expect(screen.queryByRole("status")).toBeNull();
  });
});
