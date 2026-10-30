// The old top bar (AppHeader) is found by its Log out button: the new sidebar shell is outside these pages, and
// PageFrame's own <header> would also count as a "banner".
// SCRUM-159 — the Event Organiser's pages in the new design: the same words and features, inside the shared app shell

import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sgtToUtc } from "@spm-t5/shared";

const { getDashboard, getMyEventRequests, getEvent, getChangeRequests } = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  getMyEventRequests: vi.fn(),
  getEvent: vi.fn(),
  getChangeRequests: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/dashboard", () => ({ getDashboard }));
vi.mock("@/lib/myEventRequestsServer", () => ({ getMyEventRequests }));
vi.mock("@/lib/getEvent", () => ({
  getEvent,
  getChangeRequests,
  getEventOutcome: async () => null,
  getEventChangeHistory: async () => null,
  getEventSafetyDecisions: async () => null,
}));
vi.mock("@/lib/venueBookingsServer", () => ({ getEventVenueBookings: async () => null }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }) }));

import EventOrganiserDashboard from "@/app/dashboard/event_organiser/page";
import EventPage from "@/app/events/[id]/page";
import MyEventRequestsPage from "@/app/my-event-requests/page";

const DASHBOARD = {
  user: { fullName: "Jason Chua", email: "jason@example.com", role: "event_organiser" },
  sections: [
    {
      title: "My event requests",
      columns: [
        { key: "name", label: "Event", linkKey: "eventHref" },
        { key: "status", label: "Status", linkKey: "eventHref", statusKey: "statusKey" },
        { key: "start", label: "Preferred start" },
        { key: "attendance", label: "Expected attendance" },
      ],
      rows: [{ name: "Tech Summit", status: "under review", statusKey: "under_review", eventHref: "/events/evt-1", start: "2031-11-14 09:00", attendance: 250 }],
    },
  ],
};

const REQUEST = {
  id: "evt-1",
  name: "Tech Summit",
  status: "under_review",
  preferred_start_datetime: "2031-11-20T01:00:00Z",
  expected_attendance: 250,
  submitted_at: "2026-10-01T02:00:00Z",
};

beforeEach(() => {
  getDashboard.mockReset();
  getMyEventRequests.mockReset();
  getEvent.mockReset();
});

describe("SCRUM-159/AC1 the organiser's home dashboard in the new design", () => {
  it("SCRUM-159/AC1 sits in the shared app shell, without the old top bar, under the same title and line", async () => {
    getDashboard.mockResolvedValue(DASHBOARD);

    render(await EventOrganiserDashboard());

    expect(screen.queryByRole("button", { name: "Log out" })).toBeNull(); // the old top bar's, not the shell's
    expect(screen.getByRole("heading", { level: 1, name: "Event Organiser dashboard" })).toBeTruthy();
    expect(screen.getByText("Signed in as Jason Chua")).toBeTruthy();
  });

  it("SCRUM-159/AC1 shows My event requests as a card table, its status as a badge with an icon, and the whole row opens the event", async () => {
    getDashboard.mockResolvedValue(DASHBOARD);

    render(await EventOrganiserDashboard());

    const card = screen.getByRole("heading", { level: 2, name: "My event requests" }).closest("[data-slot='card']") as HTMLElement;
    expect(card).toBeTruthy();
    const row = within(card).getByRole("row", { name: /Tech Summit/ });
    expect(within(row).getByText("Under Review").closest("[data-tone]")).toBeTruthy();
    expect(within(row).getByRole("link", { name: "Tech Summit" }).getAttribute("href")).toBe("/events/evt-1");
    expect(row.className).toContain("cursor-pointer");
  });

  it("SCRUM-159/AC1 keeps the link to the full list of event requests", async () => {
    getDashboard.mockResolvedValue(DASHBOARD);

    render(await EventOrganiserDashboard());

    expect(screen.getByRole("link", { name: "My event requests" }).getAttribute("href")).toBe("/my-event-requests");
  });

  it("SCRUM-159/AC1 drops the old row of links the sidebar already gives (My profile, Event registrations)", async () => {
    getDashboard.mockResolvedValue(DASHBOARD);

    render(await EventOrganiserDashboard());

    const main = screen.getByRole("main");
    expect(within(main).queryByRole("link", { name: "My profile" })).toBeNull();
    expect(within(main).queryByRole("link", { name: "Event registrations" })).toBeNull();
  });

  it("SCRUM-159/AC1 says Nothing to show yet in a designed empty state when there are no requests", async () => {
    getDashboard.mockResolvedValue({ ...DASHBOARD, sections: [{ ...DASHBOARD.sections[0], rows: [] }] });

    render(await EventOrganiserDashboard());

    expect(screen.getByText("Nothing to show yet.").closest("[data-state='empty']")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("SCRUM-159/AC2 My event requests in the new design", () => {
  it("SCRUM-159/AC2 sits in the shared app shell, keeps its title and back link, and lists the requests in a card table", async () => {
    getMyEventRequests.mockResolvedValue({ requests: [REQUEST] });

    render(await MyEventRequestsPage());

    expect(screen.queryByRole("button", { name: "Log out" })).toBeNull(); // the old top bar's, not the shell's
    expect(screen.getByRole("heading", { level: 1, name: "My event requests" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "← Back to dashboard" }).getAttribute("href")).toBe("/dashboard");
    expect(screen.getByRole("table").closest("[data-slot='card']")).toBeTruthy();
  });

  it("SCRUM-159/AC2 opens a request from anywhere on its row (SCRUM-151)", async () => {
    getMyEventRequests.mockResolvedValue({ requests: [REQUEST] });

    render(await MyEventRequestsPage());

    expect(screen.getByRole("row", { name: /Tech Summit/ }).className).toContain("cursor-pointer");
  });

  it("SCRUM-159/AC2 shows the same message in a designed empty state when there are none", async () => {
    getMyEventRequests.mockResolvedValue({ requests: [] });

    render(await MyEventRequestsPage());

    expect(screen.getByText("You have not created any event requests yet.").closest("[data-state='empty']")).toBeTruthy();
  });

  it("SCRUM-159/AC2 shows a refusal as the new error message, with an icon", async () => {
    getMyEventRequests.mockResolvedValue({ error: "You are not allowed to view event requests created by organisers." });

    render(await MyEventRequestsPage());

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("You are not allowed to view event requests created by organisers.");
    expect(alert.querySelector("svg")).toBeTruthy();
  });
});

describe("SCRUM-159/AC3 the event page has the sidebar only", () => {
  it("SCRUM-159/AC3 no longer shows the old top bar above the event, for organisers and coordinators alike", async () => {
    getEvent.mockResolvedValue({
      event: {
        id: "evt-1",
        name: "Tech Summit",
        status: "submitted",
        canChangeStatus: false,
        canReview: false,
        point_of_contact_name: null,
        isOrganiser: true,
        canRequestChange: true,
        purpose: null,
        preferred_start_datetime: sgtToUtc("2031-11-14", "09:00").toISOString(),
        preferred_end_datetime: sgtToUtc("2031-11-14", "17:00").toISOString(),
        expected_attendance: 100,
        preferred_layout_name: null,
        accessibility_requirements: null,
        equipment_requirements_notes: null,
        submitted_at: "2026-10-01T02:00:00Z",
        organiser_name: "Jason Chua",
      },
    });

    render(await EventPage({ params: Promise.resolve({ id: "evt-1" }), searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { level: 1, name: "Tech Summit" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Log out" })).toBeNull(); // the old top bar's, not the shell's
    expect(screen.getByRole("link", { name: "← Back to dashboard" })).toBeTruthy();
  });
});
