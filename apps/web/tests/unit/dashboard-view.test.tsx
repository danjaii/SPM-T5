import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DashboardView, type DashboardData } from "@/components/DashboardView";

const data: DashboardData = {
  user: { fullName: "Rachel Tan", email: "rachel@example.com", role: "event_coordinator" },
  sections: [
    {
      title: "Events I coordinate",
      columns: [{ key: "name", label: "Event" }, { key: "status", label: "Status", linkKey: "statusHref" }],
      rows: [{ name: "Tech Summit", status: "under review", statusHref: "/events/evt-1" }],
    },
    {
      title: "My venue booking requests",
      columns: [{ key: "event", label: "Event" }, { key: "status", label: "Status" }],
      rows: [{ event: "Tech Summit", status: "requested" }],
    },
  ],
};

describe("Dashboard tables", () => {
  // SCRUM-8 UI: a coordinator reaches the edit-status page by clicking an event's status
  it("shows a value as a link when its column is marked as a link", () => {
    render(<DashboardView data={data} />);

    expect(screen.getByRole("link", { name: "under review" }).getAttribute("href")).toBe("/events/evt-1");
  });

  it("leaves every other value as plain text", () => {
    render(<DashboardView data={data} />);

    expect(screen.getByText("requested").closest("a")).toBeNull();
    expect(document.querySelectorAll("td a")).toHaveLength(1); // only one link inside the tables
  });

  // SCRUM-29 AC3 + AC4: coordinators and venue staff reach the venue catalogue from their dashboard; nobody else sees the link
  it.each([
    ["event_coordinator", true],
    ["venue_staff", true],
    ["event_organiser", false],
    ["attendee", false],
    ["technical_support_staff", false],
  ])("for a %s, shows the 'Venue catalogue' link: %s", (role, shown) => {
    render(<DashboardView data={{ ...data, user: { ...data.user, role } }} />);

    const link = screen.queryByRole("link", { name: "Venue catalogue" });
    if (shown) expect(link?.getAttribute("href")).toBe("/venues");
    else expect(link).toBeNull();
  });
});
