// The old top bar (AppHeader) is found by its Log out button: the new sidebar shell is outside these pages, and
// PageFrame's own <header> would also count as a "banner".
// SCRUM-159 — the Event Organiser's pages in the new design: the same words and features, inside the shared app shell

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sgtToUtc } from "@spm-t5/shared";

const { getMyEventRequests, getEvent, getChangeRequests } = vi.hoisted(() => ({
  getMyEventRequests: vi.fn(),
  getEvent: vi.fn(),
  getChangeRequests: vi.fn().mockResolvedValue([]),
}));
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

import EventPage from "@/app/events/[id]/page";
import MyEventRequestsPage from "@/app/my-event-requests/page";

const REQUEST = {
  id: "evt-1",
  name: "Tech Summit",
  status: "under_review",
  preferred_start_datetime: "2031-11-20T01:00:00Z",
  expected_attendance: 250,
  submitted_at: "2026-10-01T02:00:00Z",
};

beforeEach(() => {
  getMyEventRequests.mockReset();
  getEvent.mockReset();
});


describe("SCRUM-159/AC2 My event requests in the new design", () => {
  it("SCRUM-159/AC2 SCRUM-186/AC2 sits in the shared app shell, keeps its title, has no back link, and lists the requests in a card table", async () => {
    getMyEventRequests.mockResolvedValue({ requests: [REQUEST] });

    render(await MyEventRequestsPage());

    expect(screen.queryByRole("button", { name: "Log out" })).toBeNull(); // the old top bar's, not the shell's
    expect(screen.getByRole("heading", { level: 1, name: "My event requests" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /back to/i })).toBeNull();
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
    expect(screen.getByRole("link", { name: "Back to Home" })).toBeTruthy();
  });
});
