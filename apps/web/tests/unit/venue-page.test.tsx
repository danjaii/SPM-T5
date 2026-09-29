import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Pretend loading helper (tested in get-venues.test.ts), so this test is only about the page itself
const { getVenue } = vi.hoisted(() => ({ getVenue: vi.fn() }));
vi.mock("@/lib/getVenues", () => ({ getVenue }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ replace: vi.fn() }) }));

import VenuePage from "@/app/venues/[id]/page";

const open = async (id: string) => render(await VenuePage({ params: Promise.resolve({ id }) }));

// ---------------------------------------------------------------------------
// SCRUM-29 — Venue detail page route (/venues/[id])
// ---------------------------------------------------------------------------
describe("SCRUM-29 — Venue detail page (/venues/[id])", () => {
  // AC2 (Scenario 2): opening a venue fetches that venue, then displays its details
  // we previously had test cases for fetch, and display, both separate. this test case is to see if in frontend, we can fetch then display
  // this is for venue details; the similar one for the venue list is in venues-page.test.tsx
  it("shows the venue that was clicked", async () => {
    getVenue.mockResolvedValue({
      venue: {
        id: "orchid", name: "Orchid Hall", address: "Level 3, East Wing", description: null, max_capacity: 150,
        operating_hours_start: null, operating_hours_end: null, is_accessible: true, accessibility_notes: null,
        layouts: [], facilities: [],
      },
    });

    await open("orchid");

    expect(getVenue).toHaveBeenCalledWith("orchid");
    expect(screen.getByRole("heading", { name: "Orchid Hall" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /back to venue catalogue/i }).getAttribute("href")).toBe("/venues");
  });
  // end of AC2

  // AC4 + AC6 + AC7 (Scenarios 4, 6, 7), plus a venue that doesn't exist: show the error message (e.g. "not allowed" or "Venue not found") instead of the details
  // the similar one for the venue list is in venues-page.test.tsx
  it("shows the 'not allowed' or 'not found' message instead of the details", async () => {
    getVenue.mockResolvedValue({ error: "Venue not found." });

    await open("no-such-venue");

    expect(screen.getByRole("alert").textContent).toBe("Venue not found.");
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });
  // end of AC4 + AC6 + AC7
});
// end of SCRUM-29
