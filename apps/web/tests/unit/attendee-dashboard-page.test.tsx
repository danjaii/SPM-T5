import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Pretend loading helper (tested in its own file), so this test is only about the page itself
const { getUpcomingEvents } = vi.hoisted(() => ({ getUpcomingEvents: vi.fn() }));
vi.mock("@/lib/getUpcomingEvents", () => ({ getUpcomingEvents }));

import AttendeeDashboard from "@/app/dashboard/attendee/page";

// ---------------------------------------------------------------------------
// SCRUM-71 — The List of events on the attendee's home page (/dashboard/attendee)
// ---------------------------------------------------------------------------
describe("SCRUM-71 — Attendee dashboard page", () => {
  // AC1: the page shows the upcoming events as cards (SCRUM-139/AC1: it is the "Browse events" page)
  it("SCRUM-71/AC1, SCRUM-139/AC1 shows Browse events with a card for each upcoming event", async () => {
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

    expect(screen.getByRole("heading", { level: 1, name: "Browse events" })).toBeTruthy();
    const card = screen.getByRole("article");
    expect(within(card).getByRole("heading", { name: "Tech Summit" })).toBeTruthy();
  });
  // end of AC1

  // AC11: if the list couldn't be loaded, say so (not "No upcoming events"); SCRUM-139/AC11: as a designed error state
  it("SCRUM-71/AC11, SCRUM-139/AC11 shows why the List of events couldn't be loaded", async () => {
    getUpcomingEvents.mockResolvedValue({ error: "We couldn't load upcoming events. Please try again." });

    render(await AttendeeDashboard());

    expect(screen.getByRole("alert").textContent).toBe("We couldn't load upcoming events. Please try again.");
    expect(screen.queryByText("No upcoming events")).toBeNull();
  });
  // end of AC11

  // SCRUM-139/AC11: no upcoming events is a designed empty state, not a blank page
  it("SCRUM-139/AC11 says so when there are no upcoming events", async () => {
    getUpcomingEvents.mockResolvedValue({ events: [] });

    render(await AttendeeDashboard());

    expect(screen.getByText("No upcoming events")).toBeTruthy();
  });
});
// end of SCRUM-71
