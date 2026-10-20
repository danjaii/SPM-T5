import { ROLES } from "@spm-t5/shared";
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// the real notification bell (tests/setup.ts stubs it for page tests), answering with 2 unread
vi.unmock("@/components/NotificationBell");
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ unreadCount: 2 }) }));
});
afterEach(() => vi.unstubAllGlobals());

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

  // SCRUM-66/AC1: an organiser opens an event (and its change request form) by clicking its name or status
  it("SCRUM-66/AC1 links an organiser's event name and status to the event page", () => {
    const organiser: DashboardData = {
      user: { fullName: "Jason Chua", email: "jason@example.com", role: "event_organiser" },
      sections: [{
        title: "My event requests",
        columns: [
          { key: "name", label: "Event", linkKey: "eventHref" },
          { key: "status", label: "Status", linkKey: "eventHref" },
        ],
        rows: [{ name: "Tech Summit", status: "submitted", eventHref: "/events/evt-9" }],
      }],
    };
    render(<DashboardView data={organiser} />);

    expect(screen.getByRole("link", { name: "Tech Summit" }).getAttribute("href")).toBe("/events/evt-9");
    expect(screen.getByRole("link", { name: "submitted" }).getAttribute("href")).toBe("/events/evt-9");
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

  // SCRUM-87/AC7: only Technical Support Staff see the link to the equipment request queue.
  it.each(ROLES)("SCRUM-87/AC7: for a %s, shows the 'Equipment requests' link only if Technical Support Staff", (role) => {
    render(<DashboardView data={{ ...data, user: { ...data.user, role } }} />);

    const link = screen.queryByRole("link", { name: "Equipment requests" });
    if (role === "technical_support_staff") expect(link?.getAttribute("href")).toBe("/equipment-requests");
    else expect(link).toBeNull();
  });
  // end of SCRUM-19 dashboard link

  // SCRUM-68: every signed-in user has a profile, so every role gets the link to it.
  // Every role comes from the shared ROLES list, so a role added later is checked too.

  // make a link for user to go into their profile 
  it.each(ROLES)("SCRUM-68: for a %s, shows a 'My profile' link to /profile", (role) => {
    render(<DashboardView data={{ ...data, user: { ...data.user, role } }} />);

    expect(screen.getByRole("link", { name: "My profile" }).getAttribute("href")).toBe("/profile");
  });
  // end of SCRUM-68 dashboard link
});

// ---------------------------------------------------------------------------
// SCRUM-74 — Reaching the registration information page
// ---------------------------------------------------------------------------
describe("SCRUM-74 — Event registrations link", () => {
  /** A dashboard with no tables, for a user with `role`. */
  const dashboardFor = (role: string): DashboardData => ({
    user: { fullName: "Jason Chua", email: "jason@example.com", role },
    sections: [],
  });

  // AC2: an organiser reaches the registrations of the events they manage from their dashboard
  it("SCRUM-74/AC2 links an organiser to the event registrations page", () => {
    render(<DashboardView data={dashboardFor("event_organiser")} />);

    expect(screen.getByRole("link", { name: "Event registrations" }).getAttribute("href")).toBe("/registrations-overview");
  });

  // AC2: a coordinator has the same access as an organiser, so the same link
  it("SCRUM-74/AC2 links a coordinator to the event registrations page", () => {
    render(<DashboardView data={dashboardFor("event_coordinator")} />);

    expect(screen.getByRole("link", { name: "Event registrations" }).getAttribute("href")).toBe("/registrations-overview");
  });
  // end of AC2

  // AC1: registration information is only for organisers and coordinators, so nobody else gets the link
  it("SCRUM-74/AC1 doesn't link an attendee to the event registrations page", () => {
    render(<DashboardView data={dashboardFor("attendee")} />);

    expect(screen.queryByRole("link", { name: "Event registrations" })).toBeNull();
  });
  // end of AC1
});
// end of SCRUM-74

// ---------------------------------------------------------------------------
// SCRUM-99 — the Safety Officer reaches the events waiting for a safety check
// ---------------------------------------------------------------------------
describe("SCRUM-99/AC2 Waiting for safety check link", () => {
  it("SCRUM-99/AC2 links a Safety Officer to the events waiting for a safety check", () => {
    render(<DashboardView data={{ ...data, user: { ...data.user, role: "safety_officer" } }} />);

    expect(screen.getByRole("link", { name: "Waiting for safety check" }).getAttribute("href")).toBe("/safety-checks");
  });

  it.each(ROLES.filter((role) => role !== "safety_officer"))("SCRUM-99/AC2 does not offer the link to a %s", (role) => {
    render(<DashboardView data={{ ...data, user: { ...data.user, role } }} />);

    expect(screen.queryByRole("link", { name: "Waiting for safety check" })).toBeNull();
  });
});

describe("SCRUM-47/AC11 the dashboard's notification bell", () => {
  it("is in the header beside the role, in place of the old Notifications link", async () => {
    const { container } = render(<DashboardView data={data} />);

    const header = container.querySelector("header")!;
    expect(await within(header).findByRole("button", { name: "Notifications, 2 unread" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /^Notifications/ })).toBeNull();
  });
});

describe("SCRUM-127/AC3 event status badge in dashboard lists", () => {
  it("shows an event's status as a StatusBadge with an icon, in its link", () => {
    render(
      <DashboardView
        data={{
          ...data,
          sections: [{
            title: "Events I coordinate",
            columns: [{ key: "name", label: "Event" }, { key: "status", label: "Status", linkKey: "statusHref", statusKey: "statusKey" }],
            rows: [{ name: "Tech Summit", status: "under review", statusKey: "under_review", statusHref: "/events/evt-1" }],
          }],
        }}
      />,
    );
    const link = screen.getByRole("link", { name: "Under Review" });
    expect(link.getAttribute("href")).toBe("/events/evt-1");
    expect(within(link).getByTestId("status-icon")).toBeTruthy();
  });
});
