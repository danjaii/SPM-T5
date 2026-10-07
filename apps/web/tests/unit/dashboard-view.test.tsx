import { ROLES } from "@spm-t5/shared";
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

  // SCRUM-29 AC3 + AC4 + AC6 + AC7: coordinators and venue staff reach the venue catalogue from their dashboard; nobody else sees the link
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

  // SCRUM-18 (18-S13): only Technical Support Staff see the link to the equipment availability check.
  // Every role comes from the shared ROLES list, so a role added later is checked too.
  it.each(ROLES)("SCRUM-18: for a %s, shows the 'Check equipment availability' link only if Technical Support Staff", (role) => {
    render(<DashboardView data={{ ...data, user: { ...data.user, role } }} />);

    const link = screen.queryByRole("link", { name: "Check equipment availability" });
    if (role === "technical_support_staff") expect(link?.getAttribute("href")).toBe("/equipment-availability");
    else expect(link).toBeNull();
  });
  // if role is technical support staff, we can see the link. Else, no
  // end of SCRUM-18 dashboard link

  // SCRUM-65: only event coordinators see the 'Search venues' link.
  it.each(ROLES)("SCRUM-65: for a %s, shows the 'Search venues' link only if Event Coordinator", (role) => {
    render(<DashboardView data={{ ...data, user: { ...data.user, role } }} />);

    const link = screen.queryByRole("link", { name: "Search venues" });
    if (role === "event_coordinator") expect(link?.getAttribute("href")).toBe("/venues/search");
    else expect(link).toBeNull();
  });

  // we want to test that if the person is technical support staff, they can see the link to reserve equipment

  // SCRUM-19: only Technical Support Staff see the link to reserve equipment.
  // Every role comes from the shared ROLES list, so a role added later is checked too.
  it.each(ROLES)("SCRUM-19: for a %s, shows the 'Reserve equipment' link only if Technical Support Staff", (role) => {
    render(<DashboardView data={{ ...data, user: { ...data.user, role } }} />);

    const link = screen.queryByRole("link", { name: "Reserve equipment" });
    if (role === "technical_support_staff") expect(link?.getAttribute("href")).toBe("/equipment-reservation");
    else expect(link).toBeNull();
  });
  // end of SCRUM-19 dashboard link
});
