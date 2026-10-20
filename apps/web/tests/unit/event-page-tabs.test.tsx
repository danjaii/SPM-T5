import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EVENT_TABS, EventTabs, tabFrom } from "@/components/event/EventTabs";
import { EventSection, Unavailable } from "@/components/event/EventSection";
import { InlineMessage } from "@/components/event/InlineMessage";
import { EventStatusPanel } from "@/components/EventStatusPanel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const event = { id: "evt-1", name: "Tech Summit", status: "under_review", canChangeStatus: true, canReview: true, point_of_contact_name: "Priya Nair" };

describe("SCRUM-127/AC1 event page tabs", () => {
  it.each([[undefined, "overview"], ["venues", "venues"], ["changes", "changes"], ["nonsense", "overview"]])("?tab=%s opens %s", (value, tab) => {
    expect(tabFrom(value)).toBe(tab);
  });

  it("links each tab to the page with its ?tab and marks the open one", () => {
    render(<EventTabs basePath="/events/evt-1" activeTab="equipment" />);
    const links = within(screen.getByRole("navigation", { name: "Event sections" })).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(EVENT_TABS.map((t) => `/events/evt-1?tab=${t.id}`));
    expect(links.filter((l) => l.getAttribute("aria-current") === "page").map((l) => l.textContent)).toEqual(["Equipment"]);
  });

  it("shows the title with its status badge, the stepper and the tabs above the tab's content", () => {
    render(<EventStatusPanel event={event} activeTab="venues" meta="Organiser Grace Lim · 450 expected"><p>tab body</p></EventStatusPanel>);
    expect(screen.getByRole("heading", { level: 1, name: "Tech Summit" })).toBeTruthy();
    expect(screen.getByText("Organiser Grace Lim · 450 expected")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Event progress" })).getAllByRole("listitem")).toHaveLength(8);
    expect(screen.getByText("tab body")).toBeTruthy();
  });

  it("keeps the decision and Change status on the overview only", () => {
    const { unmount } = render(<EventStatusPanel event={event} activeTab="overview" />);
    expect(screen.getByRole("heading", { name: "Decision" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Change status" })).toBeTruthy();
    unmount();
    render(<EventStatusPanel event={event} activeTab="venues" />);
    expect(screen.queryByRole("heading", { name: "Decision" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Change status" })).toBeNull();
  });
});

describe("SCRUM-127/AC10 event page blocks", () => {
  it("names a section by its heading and says so when a tab is not available to the viewer", () => {
    render(<><EventSection id="a" title="Request details"><p>x</p></EventSection><Unavailable id="b" title="Venue bookings" /></>);
    expect(screen.getByRole("region", { name: "Request details" })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Venue bookings" })).getByText("This is not available to you for this event.")).toBeTruthy();
  });

  it("shows an error or result with an icon and text, announced at once for an error", () => {
    const { container } = render(<><InlineMessage kind="error">Failed</InlineMessage><InlineMessage kind="ok">Saved</InlineMessage></>);
    expect(screen.getByRole("alert").textContent).toBe("Failed");
    expect(screen.getByRole("status").textContent).toBe("Saved");
    expect(container.querySelectorAll("svg")).toHaveLength(2);
  });
});
