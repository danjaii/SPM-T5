import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Pretend loading helpers (tested in get-venues.test.ts), so this test is only about the page itself
const { getVenues, getVenueSearchOptions, getEvent } = vi.hoisted(() => ({ getVenues: vi.fn(), getVenueSearchOptions: vi.fn(), getEvent: vi.fn() }));
vi.mock("@/lib/getVenues", () => ({ getVenues }));
vi.mock("@/lib/venueSearchServer", () => ({ getVenueSearchOptions }));
vi.mock("@/lib/getEvent", () => ({ getEvent }));
vi.mock("@/lib/venueSearch", () => ({ searchVenues: vi.fn(async () => ({ ok: true, data: { venues: [] } })) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ replace: vi.fn() }) }));

import VenuesPage from "@/app/venues/page";

// ---------------------------------------------------------------------------
// SCRUM-29 — Venue catalogue page route (/venues)
// ---------------------------------------------------------------------------
describe("SCRUM-29 — Venue catalogue page (/venues)", () => {
  // AC1 (Scenario 1): opening the catalogue shows the venues
  // we previously had test cases for fetch, and display, both separate. this test case is to see if in frontend, we can fetch then display
  it("shows the venue catalogue", async () => {
    getVenueSearchOptions.mockResolvedValue({ error: "no" });
    getVenues.mockResolvedValue({ venues: [{ id: "v1", name: "Orchid Hall", address: "Level 3, East Wing", max_capacity: 150 }] });

    render(await VenuesPage({}));

    expect(screen.getByRole("heading", { name: "Venue catalogue" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Orchid Hall" })).toBeTruthy();
  });
  // end of AC1

  // AC4 + AC6 + AC7 (Scenarios 4, 6, 7): a user who isn't allowed sees the "not allowed" message instead of the catalogue
  // if a user is not allowed to see the venue catalogue list, the backend will output denied. we want to carry this denied information onto the frontend to tell user that he or she is denied
  it("shows the 'not allowed' message instead of the catalogue", async () => {
    getVenues.mockResolvedValue({ error: "You are not allowed to view the venue catalogue." });

    render(await VenuesPage({}));

    expect(screen.getByRole("alert").textContent).toBe("You are not allowed to view the venue catalogue.");
    expect(screen.queryByRole("list")).toBeNull();
  });
  // end of AC4 + AC6 + AC7

  // SCRUM-131/AC1: opening the catalogue from an event pre-fills the filters with that event
  it("SCRUM-131/AC1 opens with the event's filters when given an event", async () => {
    getVenues.mockResolvedValue({ venues: [{ id: "v1", name: "Orchid Hall", address: "Level 3", max_capacity: 150 }] });
    getVenueSearchOptions.mockResolvedValue({ options: { layouts: [], facilities: [] } });
    getEvent.mockResolvedValue({
      event: {
        id: "e1",
        name: "Annual Tech Summit",
        preferred_start_datetime: "2099-11-14T01:00:00Z",
        preferred_end_datetime: "2099-11-14T09:00:00Z",
        expected_attendance: 60,
        venue_requirements: "Projector",
      },
    });

    render(await VenuesPage({ searchParams: Promise.resolve({ eventId: "e1" }) }));

    expect(getEvent).toHaveBeenCalledWith("e1");
    expect(screen.getByText("Filters are pre-filled from Annual Tech Summit")).toBeTruthy();
    expect((screen.getByLabelText("People (optional)") as HTMLInputElement).value).toBe("60");
  });
});
// end of SCRUM-29
