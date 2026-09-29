import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Pretend loading helpers (tested in get-venues.test.ts), so this test is only about the page itself
const { getVenues } = vi.hoisted(() => ({ getVenues: vi.fn() }));
vi.mock("@/lib/getVenues", () => ({ getVenues }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ replace: vi.fn() }) }));

import VenuesPage from "@/app/venues/page";

// ---------------------------------------------------------------------------
// SCRUM-29 — Venue catalogue page route (/venues)
// ---------------------------------------------------------------------------
describe("SCRUM-29 — Venue catalogue page (/venues)", () => {
  // AC1 (Scenario 1): opening the catalogue shows the venues
  // we previously had test cases for fetch, and display, both separate. this test case is to see if in frontend, we can fetch then display
  it("shows the venue catalogue", async () => {
    getVenues.mockResolvedValue({ venues: [{ id: "v1", name: "Orchid Hall", address: "Level 3, East Wing", max_capacity: 150 }] });

    render(await VenuesPage());

    expect(screen.getByRole("heading", { name: "Venue catalogue" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Orchid Hall" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /back to dashboard/i }).getAttribute("href")).toBe("/dashboard");
  });
  // end of AC1

  // AC4 + AC6 + AC7 (Scenarios 4, 6, 7): a user who isn't allowed sees the "not allowed" message instead of the catalogue
  // if a user is not allowed to see the venue catalogue list, the backend will output denied. we want to carry this denied information onto the frontend to tell user that he or she is denied
  it("shows the 'not allowed' message instead of the catalogue", async () => {
    getVenues.mockResolvedValue({ error: "You are not allowed to view the venue catalogue." });

    render(await VenuesPage());

    expect(screen.getByRole("alert").textContent).toBe("You are not allowed to view the venue catalogue.");
    expect(screen.queryByRole("table")).toBeNull();
  });
  // end of AC4 + AC6 + AC7
});
// end of SCRUM-29
