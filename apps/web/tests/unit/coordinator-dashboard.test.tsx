import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn() }) }));

const { getCoordinatorDashboard } = vi.hoisted(() => ({ getCoordinatorDashboard: vi.fn() }));
vi.mock("@/lib/coordinatorDashboardServer", () => ({ getCoordinatorDashboard }));

import EventCoordinatorDashboard from "@/app/dashboard/event_coordinator/page";
import { bookingPeek, eventPeek, groupBookingsByStatus, groupEventsByStatus, returnedReason } from "@/lib/coordinatorDashboard";
import type { VenueBookingListItem } from "@/lib/venueBookings";

const booking = (over: Partial<VenueBookingListItem> = {}): VenueBookingListItem => ({
  id: "b1", eventId: "e1", eventName: "Tech Summit", venueId: "v1", venueName: "Orchid Hall", date: "2026-11-20",
  startTime: "09:00", endTime: "17:00", status: "APPROVED", decidedAt: null, submittedAt: "2026-10-01T00:00:00Z", flags: [], ...over,
});
const bufferFlag = {
  id: "f1", kind: "buffer_conflict" as const, label: "Buffer conflict", createdAt: "2026-10-20T00:00:00Z",
  otherPeriod: { date: "2026-11-20", startTime: "17:00", endTime: "19:00" },
};
const event = (id: string, status: string, more: object = {}) => ({ id, name: `Event ${id}`, status, ...more });

async function renderPage(data: object) {
  getCoordinatorDashboard.mockResolvedValue(data);
  render(await EventCoordinatorDashboard());
}

describe("SCRUM-179/AC1 status tabs that wrap", () => {
  // jsdom has no layout, so this guards the class; tests/e2e/coordinator-dashboard-tabs.spec.ts measures the real positions.
  it("SCRUM-179/AC1 lets the tab list grow with its rows, rather than keeping the shared fixed height", async () => {
    await renderPage({ events: [event("a", "planning")], bookings: [], returned: [] });
    const classes = screen.getByRole("tablist").className.split(/\s+/);
    expect(classes).toContain("group-data-horizontal/tabs:h-auto");
    expect(classes).not.toContain("group-data-horizontal/tabs:h-8");
  });
});

describe("SCRUM-160/AC1 events by status", () => {
  it("groups assigned events by status, in lifecycle order, leaving out empty statuses", () => {
    const groups = groupEventsByStatus([event("a", "planning"), event("b", "submitted"), event("c", "planning")]);
    expect(groups.map((g) => [g.status, g.items.length])).toEqual([["submitted", 1], ["planning", 2]]);
  });

  it("gives each status a tab with an icon, a label and a count, and links to the event requests tab", async () => {
    await renderPage({ events: [event("a", "planning"), event("b", "planning")], bookings: [], returned: [] });
    const tab = screen.getByRole("tab", { name: /Planning/ });
    expect(within(tab).getByText("2")).toBeTruthy();
    expect(tab.querySelector("svg")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View event requests" }).getAttribute("href")).toBe("/events/review");
  });

  it("shows a peek of each event in the open tab and opens the event from its row", async () => {
    await renderPage({
      events: [event("e1", "approved", { preferred_start_datetime: "2026-12-12T11:00:00Z", preferred_end_datetime: "2026-12-12T13:00:00Z", expected_attendance: 80, organiser_name: "Ann Lee" })],
      bookings: [], returned: [],
    });
    const row = screen.getByRole("link", { name: /Event e1/ });
    expect(row.getAttribute("href")).toBe("/events/e1");
    expect(within(row).getByText("Sat, 12 Dec 2026, 7:00 PM – 9:00 PM · 80 expected · Organiser: Ann Lee")).toBeTruthy();
  });

  it("switches tabs to show the events of another status", async () => {
    await renderPage({ events: [event("a", "submitted"), event("b", "planning")], bookings: [], returned: [] });
    expect(screen.queryByRole("link", { name: /Event b/ })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /Planning/ }));
    expect(screen.getByRole("link", { name: /Event b/ })).toBeTruthy();
  });

  it("leaves out peek details the event does not have", () => {
    expect(eventPeek(event("x", "draft", { expected_attendance: 0 }))).toEqual(["0 expected"]);
  });

  it("says so when no events are assigned, and shows Unavailable, not 0, when they could not be loaded", async () => {
    await renderPage({ events: [], bookings: [], returned: [] });
    expect(screen.getByText("No events are assigned to you yet.")).toBeTruthy();
  });

  it("shows Unavailable when the events could not be loaded", async () => {
    await renderPage({ events: undefined, bookings: [], returned: undefined });
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(screen.queryByText("No events are assigned to you yet.")).toBeNull();
  });
});

describe("SCRUM-160/AC2 flagged bookings under Needs your action", () => {
  it("lists a flagged booking with its reason and a link, and not an unflagged one", async () => {
    await renderPage({
      events: [],
      bookings: [booking({ flags: [bufferFlag] }), booking({ id: "b2", eventName: "Quiet Gala" })],
      returned: [],
    });
    const section = screen.getByText("Needs your action").closest("section") as HTMLElement;
    expect(within(section).getByText("Tech Summit · Orchid Hall")).toBeTruthy();
    expect(within(section).getByText(/Buffer conflict: another booking at this venue/)).toBeTruthy();
    expect(within(section).getByRole("link", { name: /View booking for Tech Summit/ }).getAttribute("href")).toBe("/venue-bookings/b1");
    expect(within(section).queryByText(/Quiet Gala/)).toBeNull();
  });

  it("says nothing needs action when nothing is flagged or returned", async () => {
    await renderPage({ events: [], bookings: [booking()], returned: [] });
    expect(screen.getByText(/Nothing needs your action right now/)).toBeTruthy();
  });

  it("does not claim nothing needs action when both sources failed", async () => {
    await renderPage({ events: undefined, bookings: undefined, returned: undefined });
    expect(screen.queryByText(/Nothing needs your action right now/)).toBeNull();
  });
});

describe("SCRUM-160/AC3 events returned to Planning", () => {
  it("lists a returned event with the reason and a link to it", async () => {
    await renderPage({
      events: [event("e9", "planning")], bookings: [],
      returned: [{ id: "e9", name: "Expo", reason: "The Safety Officer wants changes: add exits" }],
    });
    expect(screen.getByText("Returned to Planning")).toBeTruthy();
    expect(screen.getByText("The Safety Officer wants changes: add exits")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Expo" }).getAttribute("href")).toBe("/events/e9");
  });

  it("gives the Safety Officer's open request for changes as the reason", () => {
    expect(returnedReason({
      safetyDecisions: [{ decision: "changes_requested", reason: "Add exits" }, { decision: "approved", reason: null }],
      venueBookingsSentBack: 0, equipmentRequestsSentBack: 0,
    })).toBe("The Safety Officer wants changes: Add exits");
  });

  it("ignores a decision an important change revoked and falls back to the sent-back arrangements", () => {
    expect(returnedReason({
      safetyDecisions: [{ decision: "changes_requested", reason: "Old", revoked_at: "2026-10-01T00:00:00Z" }],
      venueBookingsSentBack: 2, equipmentRequestsSentBack: 1,
    })).toBe("The event details changed, so 2 venue bookings and 1 equipment request must be reviewed again.");
  });

  it("gives no reason when nothing sent the event back", () => {
    expect(returnedReason({ safetyDecisions: null, venueBookingsSentBack: 0, equipmentRequestsSentBack: 0 })).toBeNull();
  });
});

describe("SCRUM-160/AC4 venue booking request statuses", () => {
  it("groups bookings by status and skips one without a known status", () => {
    const groups = groupBookingsByStatus([booking(), booking({ id: "x" }), booking({ id: "y", status: "PENDING" }), booking({ id: "z", status: undefined })]);
    expect(groups.map((g) => [g.status, g.items.length])).toEqual([["APPROVED", 2], ["PENDING", 1]]);
  });

  it("gives each status a tab with an icon and a label, and links to My venue bookings", async () => {
    await renderPage({ events: [], bookings: [booking({ status: "PENDING" })], returned: [] });
    const tab = screen.getByRole("tab", { name: /Pending/ });
    expect(tab.querySelector("svg")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View my venue bookings" }).getAttribute("href")).toBe("/venue-bookings");
  });

  it("shows the venue, day and hours of each request", async () => {
    await renderPage({ events: [], bookings: [booking({ status: "PENDING" })], returned: [] });
    const row = screen.getByRole("link", { name: /Tech Summit/ });
    expect(row.getAttribute("href")).toBe("/venue-bookings/b1");
    expect(within(row).getByText("Orchid Hall · Fri, 20 Nov 2026 · 09:00–17:00")).toBeTruthy();
    expect(bookingPeek(booking())[0]).toBe("Orchid Hall");
  });

  it("shows Unavailable for the venue requests when they could not be loaded, and the events still show", async () => {
    await renderPage({ events: [event("a", "planning")], bookings: undefined, returned: [] });
    expect(screen.getAllByText("Unavailable")).toHaveLength(1);
    expect(screen.getByRole("tab", { name: /Planning/ })).toBeTruthy();
  });
});
