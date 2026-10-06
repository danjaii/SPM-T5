import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Pretend loading helpers (tested in their own files), so this test is only about the page itself
const { getDashboard, getUpcomingEvents } = vi.hoisted(() => ({ getDashboard: vi.fn(), getUpcomingEvents: vi.fn() }));
vi.mock("@/lib/dashboard", () => ({ getDashboard }));
vi.mock("@/lib/getUpcomingEvents", () => ({ getUpcomingEvents }));

import AttendeeDashboard from "@/app/dashboard/attendee/page";

/** What auth-service sends for an attendee's dashboard (the List of events comes from event-service instead). */
const dashboard = {
  user: { fullName: "Alicia Fernandez", email: "alicia@example.com", role: "attendee" },
  sections: [{ title: "My registrations & tickets", columns: [{ key: "event", label: "Event" }], rows: [] }],
};

// ---------------------------------------------------------------------------
// SCRUM-71 — The List of events on the attendee dashboard (/dashboard/attendee)
// ---------------------------------------------------------------------------
describe("SCRUM-71 — Attendee dashboard page", () => {
  // AC1: the dashboard has a "List of events" section showing the upcoming events as cards
  it("SCRUM-71/AC1 shows the List of events with a card for each upcoming event", async () => {
    getDashboard.mockResolvedValue(dashboard);
    getUpcomingEvents.mockResolvedValue({
      events: [
        {
          id: "evt-1",
          name: "Tech Summit",
          start_at: "2026-12-12T11:00:00Z",
          end_at: "2026-12-12T13:00:00Z",
          venue: { name: "Orchid Hall", address: "Level 3, East Wing" },
        },
      ],
    });

    render(await AttendeeDashboard());

    const heading = screen.getByRole("heading", { name: "List of events" });
    const section = heading.closest("section")!;
    expect(within(section).getByRole("article")).toBeTruthy();
    expect(within(section).getByRole("heading", { name: "Tech Summit" })).toBeTruthy();
  });
  // end of AC1

  // AC11: if the list couldn't be loaded, say so (not "No upcoming events"); the rest of the dashboard still shows
  it("SCRUM-71/AC11 shows why the List of events couldn't be loaded, and keeps the rest of the dashboard", async () => {
    getDashboard.mockResolvedValue(dashboard);
    getUpcomingEvents.mockResolvedValue({ error: "We couldn't load upcoming events. Please try again." });

    render(await AttendeeDashboard());

    const section = screen.getByRole("heading", { name: "List of events" }).closest("section")!;
    expect(within(section).getByRole("alert").textContent).toBe("We couldn't load upcoming events. Please try again.");
    expect(within(section).queryByText("No upcoming events")).toBeNull();
    expect(screen.getByRole("heading", { name: "My registrations & tickets" })).toBeTruthy();
  });
  // end of AC11
});
// end of SCRUM-71

describe("SCRUM-83 — Attendee dashboard page", () => {
  // AC15: the attendee reaches their "My registrations" page from the dashboard
  it("SCRUM-83/AC15 links to the attendee's My registrations page", async () => {
    getDashboard.mockResolvedValue(dashboard);
    getUpcomingEvents.mockResolvedValue({ events: [] });

    render(await AttendeeDashboard());

    expect(screen.getByRole("link", { name: "My registrations" }).getAttribute("href")).toBe("/registrations");
  });
  // end of AC15
});
// end of SCRUM-83
