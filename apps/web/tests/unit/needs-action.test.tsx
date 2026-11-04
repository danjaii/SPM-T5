import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Role } from "@spm-t5/shared";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn() }) }));

import { NeedsAction } from "@/components/shell/NeedsAction";
import { ShellContext } from "@/components/shell/ShellContext";
import type { QueueCounts } from "@/lib/nav";

const inShell = (role: Role, counts: QueueCounts) =>
  render(
    <ShellContext.Provider value={{ user: { fullName: "A", role }, counts, refreshCounts: () => {} }}>
      <NeedsAction />
    </ShellContext.Provider>,
  );

describe("SCRUM-121/AC2 needs your action", () => {
  it("lists what is waiting, linked to its queue, with an icon-and-label badge", () => {
    inShell("event_coordinator_lead", { leadQueue: 1 });
    expect(screen.getByRole("heading", { name: "Needs your action" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "1 unassigned event request waiting for a coordinator" }).getAttribute("href")).toBe("/lead/queue");
    expect(screen.getByText("Action needed")).toBeTruthy();
    expect(screen.getByTestId("status-icon")).toBeTruthy();
  });

  it.each([
    ["venue_staff", { bookingQueue: 2 }, "2 venue booking requests to decide", "/booking-queue"],
    ["technical_support_staff", { equipmentQueue: 5 }, "5 equipment requests to review", "/equipment-requests"],
    ["safety_officer", { safetyQueue: 3 }, "3 events waiting for a safety check", "/safety-checks"],
  ] as const)("%s: shows the queue's wording and link", (role, counts, text, href) => {
    inShell(role, counts);
    expect(screen.getByRole("link", { name: text }).getAttribute("href")).toBe(href);
  });

  it("says so when the queue is empty", () => {
    inShell("venue_staff", { bookingQueue: 0 });
    expect(screen.getByText("Nothing needs your action right now.")).toBeTruthy();
  });

  it("shows nothing when the queue's count could not be loaded, rather than claiming nothing is waiting", () => {
    const { container } = inShell("venue_staff", {});
    expect(container.textContent).toBe("");
  });

  it("shows nothing for a role without a queue, or outside the shell", () => {
    const { container, unmount } = inShell("attendee", {});
    expect(container.textContent).toBe("");
    unmount();
    const outside = render(<NeedsAction />);
    expect(outside.container.textContent).toBe("");
  });
});
